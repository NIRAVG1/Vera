"""
Vera Challenge — bot.py

A merchant-engagement bot implementing the 5-endpoint contract from
challenge-testing-brief.md, and the compose() contract from challenge-brief.md.

Architecture
------------
- FastAPI app holding an in-memory, versioned context store (category /
  merchant / customer / trigger), keyed exactly as the harness pushes them.
- composer.py: pure-function LLM composition, routed by trigger.kind.
- conversation_handlers.py: multi-turn reply logic (auto-reply detection,
  intent-transition, hostile handling, graceful exit, suppression).
- validators.py: post-LLM checks (URL ban, CTA shape, language match,
  anti-repetition) with a single re-prompt on failure.

Run:
    pip install fastapi uvicorn openai python-dotenv
    # Set GROQ_API_KEY in .env (already done) or export it manually.
    uvicorn bot:app --host 0.0.0.0 --port 8080
"""

from __future__ import annotations

import time
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

# Load .env so GROQ_API_KEY is available without manual exports
try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass  # python-dotenv not installed; rely on shell environment

from fastapi import FastAPI
from pydantic import BaseModel

from composer import compose_message
from conversation_handlers import ConversationState, respond as handle_reply
from store import ContextStore

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("vera_bot")

app = FastAPI(title="Vera Challenge Bot")
START = time.time()
store = ContextStore()

# conversation_id -> ConversationState
conversations: dict[str, ConversationState] = {}

TEAM_META = {
    "team_name": "Solo Submission",
    "team_members": ["Candidate"],
    "model": os.environ.get("GROQ_MODEL", "qwen/qwen3.8-27b"),
    "approach": (
        "Single LLM composer routed by trigger.kind (research_digest, recall_due, "
        "perf_dip/spike, renewal_due, dormant_with_vera, festival_upcoming, "
        "curious_ask_due, generic fallback). Category voice + peer stats + "
        "merchant signals + trigger payload are assembled into one structured "
        "prompt per send, temperature=0. Post-LLM validator strips URLs, enforces "
        "single-CTA shape, and re-prompts once on schema failure. Multi-turn replies "
        "run through a separate state machine that detects verbatim-repeat "
        "auto-replies, explicit intent-transition phrases, and hostility before "
        "falling back to the LLM for free-form replies."
    ),
    "contact_email": "candidate@example.com",
    "version": "1.0.0",
    "submitted_at": datetime.now(timezone.utc).isoformat(),
}


# ---------------------------------------------------------------------------
# GET /
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"status": "Vera Bot is running", "docs": "/docs", "health": "/v1/healthz"}


# ---------------------------------------------------------------------------
# GET /v1/healthz
# ---------------------------------------------------------------------------

@app.get("/v1/healthz")
async def healthz():
    return {
        "status": "ok",
        "uptime_seconds": int(time.time() - START),
        "contexts_loaded": store.counts(),
    }


# ---------------------------------------------------------------------------
# GET /v1/debug
# ---------------------------------------------------------------------------

@app.get("/v1/debug")
async def debug():
    import os
    groq_key = os.environ.get("GROQ_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    groq_model = os.environ.get("GROQ_MODEL", "not set")
    llm_base_url = os.environ.get("LLM_BASE_URL", "auto-detected")

    from composer import _get_client
    client = _get_client()

    llm_test = None
    llm_error = None
    if client is not None:
        try:
            resp = client.chat.completions.create(
                model=groq_model,
                max_tokens=10,
                temperature=0,
                messages=[{"role": "user", "content": "Say hi"}],
            )
            llm_test = resp.choices[0].message.content
        except Exception as e:
            llm_error = f"{type(e).__name__}: {getattr(e, 'body', str(e))}"

    return {
        "GROQ_API_KEY_set": bool(groq_key),
        "GROQ_API_KEY_preview": groq_key[:6] + "..." if groq_key else "MISSING",
        "GEMINI_API_KEY_set": bool(gemini_key),
        "GEMINI_API_KEY_preview": gemini_key[:6] + "..." if gemini_key else "MISSING",
        "GROQ_MODEL": groq_model,
        "LLM_BASE_URL": llm_base_url,
        "llm_client_initialized": client is not None,
        "llm_test_response": llm_test,
        "llm_error": llm_error,
    }


# ---------------------------------------------------------------------------
# GET /v1/metadata
# ---------------------------------------------------------------------------

@app.get("/v1/metadata")
async def metadata():
    return TEAM_META


# ---------------------------------------------------------------------------
# POST /v1/context
# ---------------------------------------------------------------------------

class CtxBody(BaseModel):
    scope: str
    context_id: str
    version: int
    payload: dict[str, Any]
    delivered_at: str


@app.post("/v1/context")
async def push_context(body: CtxBody):
    if body.scope not in ("category", "merchant", "customer", "trigger"):
        return {"accepted": False, "reason": "invalid_scope", "details": f"unknown scope {body.scope!r}"}

    result = store.put(body.scope, body.context_id, body.version, body.payload)
    if not result.accepted:
        return {"accepted": False, "reason": "stale_version", "current_version": result.current_version}

    return {
        "accepted": True,
        "ack_id": f"ack_{body.context_id}_v{body.version}",
        "stored_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# POST /v1/tick
# ---------------------------------------------------------------------------

class TickBody(BaseModel):
    now: str
    available_triggers: list[str] = []


@app.post("/v1/tick")
async def tick(body: TickBody):
    actions = []

    for trg_id in body.available_triggers:
        if len(actions) >= 20:  # cap is on actions returned, not triggers considered
            break

        trg = store.get("trigger", trg_id)
        if not trg:
            continue

        merchant_id = trg.get("merchant_id")
        merchant = store.get("merchant", merchant_id) if merchant_id else None
        if not merchant:
            continue

        category_slug = merchant.get("category_slug")
        category = store.get("category", category_slug) if category_slug else None
        if not category:
            continue

        customer_id = trg.get("customer_id")
        customer = store.get("customer", customer_id) if customer_id else None

        suppression_key = trg.get("suppression_key", trg_id)
        if store.is_suppressed(merchant_id, suppression_key):
            continue

        conversation_id = f"conv_{merchant_id}_{trg_id}"
        if conversation_id in conversations:
            # already have a live conversation for this (merchant, trigger) —
            # don't start a duplicate; only /v1/reply should continue it.
            continue

        try:
            composed = compose_message(
                category=category,
                merchant=merchant,
                trigger=trg,
                customer=customer,
            )
        except Exception as e:  # never let a bad LLM call kill the tick
            log.exception("compose failed for %s/%s: %s", merchant_id, trg_id, e)
            continue

        if not composed or not composed.get("body"):
            continue

        state = ConversationState(
            conversation_id=conversation_id,
            merchant_id=merchant_id,
            customer_id=customer_id,
            category_slug=category_slug,
            trigger_id=trg_id,
            sent_bodies=[composed["body"]],
            unanswered_nudges=0,
        )
        conversations[conversation_id] = state
        store.mark_suppressed(merchant_id, suppression_key)

        actions.append({
            "conversation_id": conversation_id,
            "merchant_id": merchant_id,
            "customer_id": customer_id,
            "send_as": composed.get("send_as", "vera"),
            "trigger_id": trg_id,
            "template_name": composed.get("template_name", "vera_generic_v1"),
            "template_params": composed.get("template_params", []),
            "body": composed["body"],
            "cta": composed.get("cta", "open_ended"),
            "suppression_key": suppression_key,
            "rationale": composed.get("rationale", ""),
        })

    return {"actions": actions}


# ---------------------------------------------------------------------------
# POST /v1/reply
# ---------------------------------------------------------------------------

class ReplyBody(BaseModel):
    conversation_id: str
    merchant_id: Optional[str] = None
    customer_id: Optional[str] = None
    from_role: str
    message: str
    received_at: str
    turn_number: int


@app.post("/v1/reply")
async def reply(body: ReplyBody):
    state = conversations.get(body.conversation_id)
    if state is None:
        # Judge started a fresh replay conversation we didn't initiate via /v1/tick
        # (e.g. Phase 4 replay scenarios). Build a minimal state on the fly.
        merchant = store.get("merchant", body.merchant_id) if body.merchant_id else None
        category_slug = merchant.get("category_slug") if merchant else None
        state = ConversationState(
            conversation_id=body.conversation_id,
            merchant_id=body.merchant_id,
            customer_id=body.customer_id,
            category_slug=category_slug,
            trigger_id=None,
            sent_bodies=[],
            unanswered_nudges=0,
        )
        conversations[body.conversation_id] = state

    category = store.get("category", state.category_slug) if state.category_slug else None
    merchant = store.get("merchant", state.merchant_id) if state.merchant_id else None
    customer = store.get("customer", state.customer_id) if state.customer_id else None

    result = handle_reply(
        state=state,
        message=body.message,
        turn_number=body.turn_number,
        category=category,
        merchant=merchant,
        customer=customer,
    )

    if result.get("action") == "send" and result.get("body"):
        state.sent_bodies.append(result["body"])

    return result


# ---------------------------------------------------------------------------
# POST /v1/teardown (optional)
# ---------------------------------------------------------------------------

@app.post("/v1/teardown")
async def teardown():
    store.clear()
    conversations.clear()
    return {"ok": True}
