"""
composer.py — the compose() implementation.

    compose_message(category, merchant, trigger, customer=None) -> dict

Routing: trigger.kind selects a short "framing" instruction (research-digest
framing vs recall-reminder framing vs perf-dip framing, etc.) that's spliced
into one shared prompt template. Everything else (voice, taboos, merchant
signals, offers, language) is assembled identically regardless of kind.

The LLM call is deterministic (temperature=0), served via Groq (OpenAI-compatible
API, using the `openai` SDK pointed at Groq's base_url). If no GROQ_API_KEY is
present, we fall back to a rule-based template composer so the bot never
crashes — this keeps /v1/tick within its 30s budget even in degraded mode.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

from validators import validate_and_fix

_client = None
GROQ_MODEL = os.environ.get("GROQ_MODEL", "qwen/qwen3.8-27b")


def _get_client():
    """Lazily construct the LLM client (OpenAI-compatible). Returns None if unavailable."""
    global _client
    if _client is not None:
        return _client
    api_key = os.environ.get("GROQ_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    # Use Gemini endpoint if GEMINI_API_KEY is set, else fall back to Groq
    base_url = os.environ.get(
        "LLM_BASE_URL",
        "https://generativelanguage.googleapis.com/v1beta/openai/"
        if os.environ.get("GEMINI_API_KEY")
        else "https://api.groq.com/openai/v1"
    )
    try:
        import openai
        _client = openai.OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=25.0,
            max_retries=1,
        )
        return _client
    except Exception as e:
        print(f"[Composer] Error initializing LLM client: {e}")
        return None


# ---------------------------------------------------------------------------
# Trigger-kind routing: short "why now" framing hints for the prompt
# ---------------------------------------------------------------------------

TRIGGER_FRAMING = {
    "research_digest": "Lead with the single most relevant digest item for this merchant's patient/customer profile. Cite the source inline. Curiosity + reciprocity ('I'll pull it for you').",
    "regulation_change": "Compliance framing — state the deadline and what changes, plainly. No hype. Loss aversion is implicit (non-compliance risk), don't overstate it.",
    "cde_opportunity": "Low-urgency FYI framing — a training/CDE opportunity. Light touch, no CTA pressure.",
    "trend_movement": "Local trend framing — cite the specific delta_yoy number and segment. Frame as an opportunity, not an alarm.",
    "category_trend_movement": "Local trend framing — cite the specific delta_yoy number and segment. Frame as an opportunity, not an alarm.",
    "category_seasonal": "Seasonal shelf/service framing — name the specific seasonal shift and the concrete action (what to restock/promote).",
    "festival_upcoming": "Festival lead-time framing — name the festival, the exact days_until, and one concrete prep action for this category.",
    "competitor_opened": "Competitive-intel framing — name the competitor and distance factually, no fear-mongering. Frame as 'worth knowing', not a threat.",
    "perf_dip": "Loss-aversion framing — lead with the specific metric and % drop vs baseline. Offer one concrete next step, not just an alert.",
    "seasonal_perf_dip": "Reassurance framing — this dip is expected/seasonal. Say so explicitly so the merchant doesn't panic, then pivot to what stays useful this window (retention, not acquisition).",
    "perf_spike": "Positive reinforcement framing — name the metric, the % gain, and (if known) the likely driver. Ask if they want to double down on what's working.",
    "milestone_reached": "Celebratory but brief framing — name the exact milestone number and how close they are. Low-friction, no hard CTA needed.",
    "renewal_due": "Direct framing — state days_remaining and plan name plainly. Single binary CTA (renew now / questions first).",
    "winback_eligible": "Win-back framing — acknowledge the lapse/expiry honestly, lead with one concrete number (dip %, days), single low-friction CTA to re-engage.",
    "dormant_with_vera": "Re-engagement framing — light touch, reference the last topic if known, no guilt-tripping. One easy question to restart the thread.",
    "review_theme_emerged": "Review-pattern framing — name the theme, the occurrence count, and the trend direction. Frame as 'here's what I noticed', offer to help address it.",
    "active_planning_intent": "Momentum framing — the merchant already showed intent; respond with concrete specifics (numbers, options) that move planning forward. No re-qualifying.",
    "ipl_match_today": "Timely local-event framing — name the match/teams and why tonight specifically matters for footfall/orders.",
    "supply_alert": "Urgent, factual framing — state the alert plainly (molecule/batches), the concrete next action, no alarmism. This is the highest-urgency kind — be direct and brief.",
    "gbp_unverified": "Straightforward opportunity framing — name the estimated uplift and the concrete verification path.",
    "curious_ask_due": "Ask-the-merchant framing — a single open, specific question about their business this week (compulsion lever #7). No pitch, just genuine curiosity.",
    "recall_due": "Customer-facing recall framing — name time since last visit, the concrete open slots, the price. Multi-choice slot CTA is fine here.",
    "wedding_package_followup": "Customer-facing follow-up framing — reference the wedding date and days remaining, suggest the specific next-step program.",
    "trial_followup": "Customer-facing trial follow-up — reference the trial they took, offer the next concrete session slot.",
    "chronic_refill_due": "Customer-facing refill framing — name the molecule(s) and when stock runs out, confirm delivery to their saved address.",
    "customer_lapsed_soft": "Customer-facing soft win-back — light touch, reference their prior preference, one easy next step.",
    "customer_lapsed_hard": "Customer-facing win-back after longer lapse — acknowledge the gap honestly, lead with what's changed or a concrete incentive, single CTA.",
    "appointment_tomorrow": "Simple confirmation/reminder framing — date, time, one line only.",
}

DEFAULT_FRAMING = "Use the trigger payload's most specific, verifiable detail as the reason for messaging. Keep it short and give one clear next step."


def _framing_for(kind: str) -> str:
    return TRIGGER_FRAMING.get(kind, DEFAULT_FRAMING)


# ---------------------------------------------------------------------------
# CTA / send_as inference
# ---------------------------------------------------------------------------

_ACTION_KINDS = {"renewal_due", "recall_due", "chronic_refill_due", "appointment_tomorrow",
                  "supply_alert", "winback_eligible", "customer_lapsed_hard", "customer_lapsed_soft"}
_INFO_KINDS = {"research_digest", "regulation_change", "cde_opportunity", "trend_movement",
               "category_trend_movement", "milestone_reached", "perf_spike", "seasonal_perf_dip",
               "festival_upcoming", "review_theme_emerged"}


def _default_cta_for(kind: str) -> str:
    if kind == "recall_due":
        return "multi_choice_slot"
    if kind in _ACTION_KINDS:
        return "binary_yes_no"
    if kind in _INFO_KINDS:
        return "open_ended"
    return "open_ended"


def _send_as_for(trigger: dict) -> str:
    return "merchant_on_behalf" if trigger.get("scope") == "customer" else "vera"


# ---------------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are the composition engine for Vera, magicpin's WhatsApp merchant-assistant.
You write ONE outbound WhatsApp message given four structured contexts: category, merchant,
trigger, and (optionally) customer.

Hard rules:
- Never invent a fact, number, source, or competitor name that isn't present in the contexts given.
- Never include a URL.
- Exactly one call-to-action. Prefer a single binary choice (e.g. "Reply YES / STOP") for action
  triggers; no forced CTA for pure-information triggers.
- Match the category's voice (tone, allowed vocabulary, taboo words) exactly — see taboo list.
- Match the merchant's/customer's language preference. If it includes Hindi, write natural
  Hindi-English code-mix (Devanagari not required, Roman Hindi is fine) — don't default to pure English.
- Anchor on the single most specific, verifiable fact available (a number, date, source, or headline).
- No preamble ("I hope you're doing well..."), no re-introduction if conversation_history shows prior turns.
- Keep it to 2-4 sentences. Land the ask in the last sentence.
- Use one or more compulsion levers: specificity, loss aversion, social proof, effort
  externalization, curiosity, reciprocity, asking the merchant a question, or a single binary CTA.
- If send_as is "merchant_on_behalf" (a customer-facing message), speak as the merchant's business,
  not as "Vera" — never mention Vera by name to a customer.

Respond ONLY with a JSON object with exactly these keys:
{
  "body": "<the whatsapp message>",
  "cta": "<one of: binary_yes_no, multi_choice_slot, binary_confirm_cancel, open_ended, none>",
  "rationale": "<1-2 sentences: why this message, what it should achieve>"
}
No markdown fences, no extra text."""


def _truncate(obj: Any, limit: int = 6000) -> str:
    s = json.dumps(obj, ensure_ascii=False, default=str)
    return s if len(s) <= limit else s[:limit] + "...<truncated>"


def _build_user_prompt(category: dict, merchant: dict, trigger: dict, customer: Optional[dict]) -> str:
    kind = trigger.get("kind", "")
    identity = merchant.get("identity", {})
    voice = category.get("voice", {})

    # Resolve the digest item the trigger points at, if any (research_digest / cde_opportunity / etc.)
    payload = trigger.get("payload", {}) or {}
    top_item_id = payload.get("top_item_id") or payload.get("digest_item_id")
    resolved_digest_item = None
    if top_item_id:
        for item in category.get("digest", []):
            if item.get("id") == top_item_id:
                resolved_digest_item = item
                break

    active_offers = [o for o in merchant.get("offers", []) if o.get("status") == "active"]

    lines = [
        f"=== TRIGGER (why we are messaging right now) ===",
        f"kind: {kind}",
        f"urgency (1-5): {trigger.get('urgency')}",
        f"framing instruction: {_framing_for(kind)}",
        f"trigger payload: {_truncate(payload)}",
    ]
    if resolved_digest_item:
        lines.append(f"resolved digest item (use this, don't re-derive): {_truncate(resolved_digest_item)}")

    lines += [
        "",
        "=== CATEGORY CONTEXT ===",
        f"slug: {category.get('slug')}",
        f"voice: tone={voice.get('tone')}, register={voice.get('register')}, code_mix={voice.get('code_mix')}",
        f"vocab_allowed: {voice.get('vocab_allowed', [])}",
        f"vocab_taboo (never use these words/phrases): {voice.get('vocab_taboo', [])}",
        f"peer_stats: {_truncate(category.get('peer_stats', {}))}",
        f"offer_catalog (only reference offers actually active on the merchant, listed below): {_truncate(category.get('offer_catalog', []))}",
        "",
        "=== MERCHANT CONTEXT ===",
        f"name: {identity.get('name')}  owner_first_name: {identity.get('owner_first_name')}",
        f"locality/city: {identity.get('locality')}, {identity.get('city')}",
        f"languages: {identity.get('languages')}",
        f"subscription: {_truncate(merchant.get('subscription', {}))}",
        f"performance (30d): {_truncate(merchant.get('performance', {}))}",
        f"active offers: {_truncate([o.get('title') for o in active_offers])}",
        f"customer_aggregate: {_truncate(merchant.get('customer_aggregate', {}))}",
        f"signals: {merchant.get('signals', [])}",
        f"review_themes: {_truncate(merchant.get('review_themes', []))}",
        f"recent conversation_history (last turns, don't re-introduce yourself if non-empty): {_truncate(merchant.get('conversation_history', [])[-4:])}",
    ]

    if customer:
        c_identity = customer.get("identity", {})
        lines += [
            "",
            "=== CUSTOMER CONTEXT (this message goes to the merchant's customer, not the merchant) ===",
            f"name: {c_identity.get('name')}",
            f"language_pref: {c_identity.get('language_pref')}",
            f"relationship: {_truncate(customer.get('relationship', {}))}",
            f"state: {customer.get('state')}",
            f"preferences: {_truncate(customer.get('preferences', {}))}",
            f"consent scope (only reference topics within this scope): {customer.get('consent', {}).get('scope', [])}",
            "NOTE: send_as must be merchant_on_behalf — write as the merchant's business, never mention Vera.",
        ]

    lines += [
        "",
        f"Suggested cta shape if you have no better fit: {_default_cta_for(kind)}",
        "Compose the single best next WhatsApp message now.",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Fallback (no LLM available) — deterministic template composer
# ---------------------------------------------------------------------------

def _fallback_compose(category: dict, merchant: dict, trigger: dict, customer: Optional[dict]) -> dict:
    identity = merchant.get("identity", {})
    name = identity.get("owner_first_name") or identity.get("name", "there")
    kind = trigger.get("kind", "")
    payload = trigger.get("payload", {}) or {}

    if kind == "research_digest":
        top_item_id = payload.get("top_item_id")
        item = next((d for d in category.get("digest", []) if d.get("id") == top_item_id), None)
        if item:
            body = (f"{name}, {item.get('source', 'a recent industry note')} — {item.get('title', '')}. "
                    f"Want the full summary?")
        else:
            body = f"{name}, there's a new item in this week's category digest worth a look. Want the summary?"
    elif kind == "recall_due" and customer:
        c_name = customer.get("identity", {}).get("name", "there")
        slots = payload.get("available_slots", [])
        slot_text = " or ".join(s.get("label", "") for s in slots[:2]) if slots else "a slot that works for you"
        body = (f"Hi {c_name}, it's time for your next visit — we have {slot_text} open. "
                f"Reply to book.")
    elif kind in ("perf_dip", "seasonal_perf_dip"):
        metric = payload.get("metric", "your numbers")
        pct = payload.get("delta_pct")
        if isinstance(pct, (int, float)):
            body = f"{name}, {metric} dropped {abs(pct)*100:.0f}% this week vs baseline. Want me to look into why?"
        else:
            body = f"{name}, noticed a dip in {metric} this week. Want me to look into why?"
    elif kind == "renewal_due":
        days = payload.get("days_remaining")
        body = f"{name}, your plan renews in {days} days. Want to renew now, or do you have questions first?"
    else:
        body = f"{name}, quick update on your account — want the details?"

    return {
        "body": body,
        "cta": _default_cta_for(kind),
        "rationale": "fallback template composer (no LLM configured)",
    }


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

def compose_message(category: dict, merchant: dict, trigger: dict, customer: Optional[dict] = None,
                     sent_bodies: Optional[list[str]] = None) -> dict:
    kind = trigger.get("kind", "")
    send_as = _send_as_for(trigger)

    client = _get_client()
    if client is None:
        result = _fallback_compose(category, merchant, trigger, customer)
    else:
        user_prompt = _build_user_prompt(category, merchant, trigger, customer)
        result = _call_llm(client, user_prompt)
        if result is None:
            result = _fallback_compose(category, merchant, trigger, customer)

    result = validate_and_fix(
        result,
        category=category,
        merchant=merchant,
        customer=customer,
        sent_bodies=sent_bodies or [],
        default_cta=_default_cta_for(kind),
    )

    identity = merchant.get("identity", {})
    template_params = [identity.get("owner_first_name") or identity.get("name", ""), result["body"]]

    return {
        "body": result["body"],
        "cta": result["cta"],
        "send_as": send_as,
        "template_name": f"vera_{kind or 'generic'}_v1",
        "template_params": template_params,
        "rationale": result.get("rationale", ""),
    }


def _call_llm(client, user_prompt: str) -> Optional[dict]:
    import logging as _logging
    _log = _logging.getLogger("vera_composer")
    try:
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            max_tokens=500,
            temperature=0,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},  # qwen/qwen3.8-27b supports JSON mode
        )
        text = resp.choices[0].message.content or ""
        text = text.strip()
        # Strip markdown code fences if model wraps output
        text = re.sub(r"^```(json)?\s*|```\s*$", "", text, flags=re.MULTILINE).strip()
        # Extract first JSON object if there's surrounding prose
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            text = m.group(0)
        if not text:
            _log.error("[Composer] LLM returned empty content (model=%s)", GROQ_MODEL)
            return None
        data = json.loads(text)
        if "body" not in data:
            _log.warning("[Composer] LLM returned JSON without 'body' key: %s", data)
            return None
        return data
    except Exception as e:
        _log.error("[Composer] LLM call failed: %s | body: %s", type(e).__name__, getattr(e, 'body', str(e)))
        return None
