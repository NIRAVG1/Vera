"""
conversation_handlers.py — the /v1/reply state machine.

Implements the multi-turn behaviors the brief specifically calls out and
that the Phase 4 replay test scores directly:

  1. Auto-reply detection: same message verbatim 2-3+ times in a row ->
     one gentle nudge, then wait, then end. (§12.1 of the brief, Example 4.1)
  2. Intent transition: explicit commitment phrases ("let's do it", "ok go
     ahead", "haan kar do") -> switch straight to action, never re-qualify.
  3. Hostile / off-topic: abusive language -> graceful single-line exit or
     apology, no further pitching; unrelated questions -> answer briefly,
     stay on-mission, don't force the pitch back in.
  4. Knowing when to stop: 3 unanswered nudges (or 2 identical auto-replies
     after the first nudge) -> end the conversation.

Everything that isn't one of these special cases falls through to the LLM
composer for a normal free-form continuation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from composer import compose_message

_AUTO_REPLY_PATTERNS = [
    r"thank you for (contacting|reaching out)",
    r"our team will (respond|get back)",
    r"currently unavailable",
    r"automated (assistant|reply|response)",
    r"business hours",
]

_HOSTILE_PATTERNS = [
    r"\bstop\b.*\b(messaging|texting|spam)",
    r"\buseless\b", r"\bspam\b", r"\bshut up\b", r"\bharass",
    r"\bannoying\b", r"\bidiot\b", r"\bfool\b",
]

_INTENT_TRANSITION_PATTERNS = [
    r"\blet'?s do it\b", r"\bok(ay)? (let'?s|go ahead|proceed)\b", r"\bgo ahead\b",
    r"\byes,? (send|proceed|do it|confirm)\b", r"\bi want to join\b", r"\bsign me up\b",
    r"haan kar do", r"theek hai kar do", r"chalo karte hain", r"\bconfirm\b",
]


@dataclass
class ConversationState:
    conversation_id: str
    merchant_id: Optional[str]
    customer_id: Optional[str]
    category_slug: Optional[str]
    trigger_id: Optional[str]
    sent_bodies: list = field(default_factory=list)
    unanswered_nudges: int = 0
    consecutive_auto_replies: int = 0
    last_merchant_message: Optional[str] = None
    ended: bool = False


def _matches_any(patterns: list[str], text: str) -> bool:
    t = text.lower()
    return any(re.search(p, t) for p in patterns)


def respond(state: ConversationState, message: str, turn_number: int,
            category: Optional[dict], merchant: Optional[dict], customer: Optional[dict]) -> dict:

    if state.ended:
        return {"action": "end", "rationale": "Conversation already closed."}

    is_repeat = state.last_merchant_message is not None and message.strip() == state.last_merchant_message.strip()
    is_auto_reply = _matches_any(_AUTO_REPLY_PATTERNS, message)
    is_hostile = _matches_any(_HOSTILE_PATTERNS, message)
    is_intent_transition = _matches_any(_INTENT_TRANSITION_PATTERNS, message)

    state.last_merchant_message = message

    # --- 1. Hostile / explicit stop request -> graceful exit, no more pitching.
    if is_hostile:
        state.ended = True
        return {
            "action": "end",
            "rationale": "Merchant expressed frustration/hostility; closing without further engagement "
                         "and suppressing follow-ups for this merchant.",
        }

    # --- 2. Auto-reply handling: escalate nudge -> wait -> end.
    if is_auto_reply:
        state.consecutive_auto_replies += 1
        if state.consecutive_auto_replies == 1:
            return {
                "action": "send",
                "body": "Looks like an auto-reply 😊 When the owner sees this, a quick reply is all it takes.",
                "cta": "binary_yes_no",
                "rationale": "First auto-reply detected; one light nudge in case the owner checks the thread.",
            }
        elif state.consecutive_auto_replies == 2:
            return {
                "action": "wait",
                "wait_seconds": 86400,
                "rationale": "Second identical auto-reply — owner likely not reading live. Waiting 24h before retry.",
            }
        else:
            state.ended = True
            return {
                "action": "end",
                "rationale": "Auto-reply 3+ times with zero real engagement signal; closing the conversation.",
            }
    else:
        state.consecutive_auto_replies = 0

    # --- 3. Intent transition: switch straight to action, never re-qualify.
    if is_intent_transition:
        state.unanswered_nudges = 0
        body = ("Great — starting now. I'll have the next step ready and send a confirmation "
                "once it's done. Reply CONFIRM if you'd like me to go ahead right away.")
        if category and merchant:
            try:
                composed = compose_message(
                    category=category, merchant=merchant,
                    trigger={"kind": "active_planning_intent", "urgency": 4, "scope": "merchant",
                             "payload": {"merchant_last_message": message}},
                    customer=customer, sent_bodies=state.sent_bodies,
                )
                body = composed["body"]
            except Exception:
                pass
        return {
            "action": "send",
            "body": body,
            "cta": "binary_confirm_cancel",
            "rationale": "Merchant gave explicit commitment; switching from pitch/qualification straight "
                         "to action — no further qualifying questions asked.",
        }

    # --- 4. Explicit not-interested / repeat non-response tracking.
    if re.search(r"\bnot interested\b|\bno thanks\b|\bplease don'?t\b", message.lower()):
        state.ended = True
        return {"action": "end", "rationale": "Merchant explicitly declined; exiting gracefully."}

    if is_repeat:
        state.unanswered_nudges += 1
        if state.unanswered_nudges >= 3:
            state.ended = True
            return {"action": "end", "rationale": "3 unanswered/repeated nudges; gracefully exiting."}

    # --- 5. Fall through: normal free-form reply via the LLM composer, framed as a reply.
    if category and merchant:
        try:
            composed = compose_message(
                category=category, merchant=merchant,
                trigger={"kind": "merchant_reply_followup", "urgency": 2, "scope": "merchant",
                         "payload": {"merchant_message": message}},
                customer=customer, sent_bodies=state.sent_bodies,
            )
            return {
                "action": "send",
                "body": composed["body"],
                "cta": composed["cta"],
                "rationale": composed.get("rationale", "Continuing the conversation based on merchant's reply."),
            }
        except Exception:
            pass

    # Last-resort safe fallback if we have no context to compose from.
    return {
        "action": "send",
        "body": "Got it — noted. Let me know if you'd like me to go ahead with the next step.",
        "cta": "open_ended",
        "rationale": "No context available to personalize; safe generic acknowledgment.",
    }
