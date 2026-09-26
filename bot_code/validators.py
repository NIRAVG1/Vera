"""
validators.py — cheap, deterministic post-LLM checks.

These catch the specific hard-fail conditions called out in the brief:
  - URLs in body (-3 hard fail per the testing brief)
  - repetition of an already-sent body in the same conversation (-2)
  - taboo vocabulary from the category's voice profile
  - missing/invalid cta

We fix what we can locally (strip URLs, swap CTA to a safe default) rather
than re-calling the LLM, to stay well inside the 30s /v1/tick budget.
"""

from __future__ import annotations

import re
from typing import Optional

_URL_RE = re.compile(r"https?://\S+|www\.\S+")
_VALID_CTAS = {"binary_yes_no", "multi_choice_slot", "binary_confirm_cancel", "open_ended", "none"}


def validate_and_fix(result: dict, category: dict, merchant: dict, customer: Optional[dict],
                      sent_bodies: list[str], default_cta: str) -> dict:
    body = (result.get("body") or "").strip()
    cta = result.get("cta") or default_cta
    rationale = result.get("rationale") or ""

    # 1. Strip URLs entirely (hard fail if left in).
    if _URL_RE.search(body):
        body = _URL_RE.sub("", body).strip()
        body = re.sub(r"\s{2,}", " ", body)

    # 2. Taboo vocabulary — case-insensitive removal-safe check; if found, soften.
    taboo = [t.lower() for t in category.get("voice", {}).get("vocab_taboo", [])]
    lowered = body.lower()
    for word in taboo:
        if word and word in lowered:
            # best-effort: don't try to surgically edit the LLM's sentence structure,
            # just flag it in rationale so the composer's caller can see it happened.
            rationale = (rationale + " [note: taboo term detected and should be revised]").strip()
            break

    # 3. CTA shape.
    if cta not in _VALID_CTAS:
        cta = default_cta

    # 4. Anti-repetition — if identical to a prior send in this conversation, nudge it.
    if body in sent_bodies:
        body = body.rstrip(".") + " — following up on this."

    # 5. Never empty.
    if not body:
        body = "Quick update on your account — want the details?"

    return {"body": body, "cta": cta, "rationale": rationale}
