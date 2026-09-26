# Vera Challenge Submission

## Approach

One LLM composer (`composer.py`), routed by `trigger.kind`. Every trigger kind maps
to a short "framing" instruction (loss-aversion for `perf_dip`, reassurance for
`seasonal_perf_dip`, reciprocity/curiosity for `research_digest`, multi-choice-slot
for `recall_due`, etc. — see `TRIGGER_FRAMING` in `composer.py`), which is spliced into
one shared prompt template alongside the full category/merchant/customer contexts.
The LLM (Claude, temperature=0) returns `{body, cta, rationale}`; a deterministic
`validators.py` pass then strips any URL (hard-fail per the testing brief), rejects
invalid CTA shapes, checks for repeated bodies in the same conversation, and flags
taboo vocabulary from the category voice profile.

Multi-turn (`conversation_handlers.py`) is a small state machine that runs *before*
falling through to the LLM:
1. **Auto-reply detection** — canned-reply phrase match → nudge once → wait 24h →
   end after a third repeat (matches the brief's Pattern B / Phase-4 scenario exactly).
2. **Intent transition** — explicit commitment phrases ("let's do it", "confirm",
   "haan kar do") route straight to an action-mode message, never back to qualifying.
3. **Hostile handling** — abusive/stop language → graceful `end`, no further pitching.
4. **Knowing when to stop** — 3 unanswered identical nudges → `end`.
Anything else falls through to the LLM composer, framed as a reply-in-context.

The bot server (`bot.py`) implements all 5 required endpoints on top of a versioned,
idempotent in-memory `ContextStore` (`store.py`) and a per-`(merchant, suppression_key)`
dedup table so a trigger only ever produces one live conversation.

## What's here

| File | Purpose |
|---|---|
| `bot.py` | FastAPI app — `/v1/context`, `/v1/tick`, `/v1/reply`, `/v1/healthz`, `/v1/metadata`, optional `/v1/teardown` |
| `store.py` | Versioned, idempotent context store + suppression/dedup |
| `composer.py` | `compose_message()` — prompt assembly + LLM call + kind-routing |
| `validators.py` | Post-LLM checks: URL strip, CTA validation, taboo flag, anti-repeat |
| `conversation_handlers.py` | `/v1/reply` state machine (auto-reply / intent / hostile / stop) |
| `generate_submission.py` | Produces `submission.jsonl` from `dataset/test_pairs.json` by calling the same `compose_message()` the live bot uses |
| `submission.jsonl` | The 30 canonical test-pair outputs |

## Running it

```bash
pip install fastapi uvicorn anthropic
export ANTHROPIC_API_KEY=...
uvicorn bot:app --host 0.0.0.0 --port 8080
```

Then, to regenerate the submission file against the full expanded dataset:

```bash
python3 generate_dataset.py --seed-dir . --out ./dataset   # builds dataset/ from the seeds
python3 generate_submission.py --dataset ./dataset --out submission.jsonl
```

**Important**: `submission.jsonl` in this bundle was generated **without** an
`ANTHROPIC_API_KEY` set, so it's running the deterministic `_fallback_compose()`
template in `composer.py`, not the LLM — most lines read as a generic "quick
update on your account" because the synthetic triggers the generator produces
for slots 24-30 carry a `{"placeholder": true}` payload rather than real
content (only the original 25 seed triggers, e.g. `recall_due`/`perf_dip`, have
real payload data). **Set `ANTHROPIC_API_KEY` and re-run `generate_submission.py`
before actually submitting** — that's the one step needed to get the quality
bar shown in the brief's Appendix A/B examples; every other part of the
pipeline (routing, validation, suppression, multi-turn state machine) has been
tested end-to-end against the real generated dataset and passes.

## Tradeoffs

- **Single shared prompt template + kind-specific framing string**, rather than
  a fully separate prompt per trigger kind. Keeps the system prompt's hard
  rules (no fabrication, no URLs, single CTA, voice/taboo match) in exactly
  one place, at the cost of the framing hints being fairly terse.
- **No retrieval** over the digest — for the 5-category, small-digest dataset
  given, a simple `top_item_id` lookup embedded directly in the prompt is
  cheaper and exactly as accurate as embedding+retrieval would be. This
  wouldn't scale past the current dataset size.
- **Local, rule-based validation instead of a re-prompt-on-failure loop** — a
  second LLM call to fix a bad CTA or a stray taboo word would double latency
  for a rare failure mode; stripping/flagging locally stays well inside the
  30s budget every time. The one failure mode this doesn't fully fix is a
  taboo word left in a well-formed sentence — it's flagged in `rationale` but
  not surgically rewritten, since attempting that without a second LLM pass
  risks a worse sentence.
- **Suppression TTL is a flat 7 days** per `(merchant_id, suppression_key)`
  rather than trigger-kind-aware. Real Vera would presumably vary this
  (a `renewal_due` re-fire cadence differs from a `research_digest`); we
  didn't have per-kind cadence guidance in the dataset to calibrate against.
- **Fallback template composer** exists purely so `/v1/tick` never times out
  or 500s if the LLM call fails — it is intentionally generic and is not the
  intended source of the submitted `submission.jsonl` content.

## What additional context would have helped most

1. **Per-trigger-kind suppression/re-fire cadence** — the dataset gives us
   `suppression_key` but not how long a given kind should stay suppressed
   before re-firing is appropriate again.
2. **A canonical "bad message" bank per category** (beyond the taboo word
   list) — a few worked examples of *wrong* voice per category (e.g. an
   over-promotional dentist message) would sharpen the validator beyond
   simple keyword matching.
3. **Real payload content for the generator's synthetic triggers** (slots
   26-100 in `generate_dataset.py`'s `expand_triggers`) — they currently carry
   `{"placeholder": true}`, so any bot composing off them (rather than the 25
   seed triggers) has nothing specific to anchor on, which caps how
   "specific" a message can be for roughly 3/4 of the trigger pool.
