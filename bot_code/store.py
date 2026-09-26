"""
store.py — versioned, idempotent in-memory context store.

Keyed by (scope, context_id) -> {version, payload}, exactly matching the
semantics in challenge-testing-brief.md §2.1:
  - re-posting the same version is a no-op (stale_version)
  - a higher version replaces the prior version atomically
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class PutResult:
    accepted: bool
    current_version: Optional[int] = None


class ContextStore:
    def __init__(self):
        self._data: dict[tuple[str, str], dict] = {}
        # (merchant_id, suppression_key) -> expiry epoch seconds
        self._suppressed: dict[tuple[str, str], float] = {}

    def put(self, scope: str, context_id: str, version: int, payload: dict[str, Any]) -> PutResult:
        key = (scope, context_id)
        cur = self._data.get(key)
        if cur is not None and cur["version"] >= version:
            return PutResult(accepted=False, current_version=cur["version"])
        self._data[key] = {"version": version, "payload": payload}
        return PutResult(accepted=True)

    def get(self, scope: str, context_id: Optional[str]) -> Optional[dict]:
        if not context_id:
            return None
        entry = self._data.get((scope, context_id))
        return entry["payload"] if entry else None

    def counts(self) -> dict[str, int]:
        counts = {"category": 0, "merchant": 0, "customer": 0, "trigger": 0}
        for (scope, _cid) in self._data.keys():
            counts[scope] = counts.get(scope, 0) + 1
        return counts

    def clear(self):
        self._data.clear()
        self._suppressed.clear()

    # -- suppression / dedup -------------------------------------------------

    def mark_suppressed(self, merchant_id: str, suppression_key: str, ttl_seconds: int = 7 * 24 * 3600):
        self._suppressed[(merchant_id, suppression_key)] = time.time() + ttl_seconds

    def is_suppressed(self, merchant_id: str, suppression_key: str) -> bool:
        expiry = self._suppressed.get((merchant_id, suppression_key))
        return bool(expiry and expiry > time.time())
