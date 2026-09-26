#!/usr/bin/env python3
"""
generate_submission.py — produce submission.jsonl from dataset/test_pairs.json.

Usage:
    export ANTHROPIC_API_KEY=...
    python3 generate_submission.py --dataset ./dataset --out submission.jsonl

Calls the same compose_message() the live bot uses (via composer.py), so
the submission file and the bot's live behavior never drift apart.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from composer import compose_message


def load_dataset(dataset_dir: Path):
    categories, merchants, customers, triggers = {}, {}, {}, {}
    for f in (dataset_dir / "categories").glob("*.json"):
        d = json.load(open(f))
        categories[d["slug"]] = d
    for f in (dataset_dir / "merchants").glob("*.json"):
        d = json.load(open(f))
        merchants[d["merchant_id"]] = d
    for f in (dataset_dir / "customers").glob("*.json"):
        d = json.load(open(f))
        customers[d["customer_id"]] = d
    for f in (dataset_dir / "triggers").glob("*.json"):
        d = json.load(open(f))
        triggers[d["id"]] = d
    return categories, merchants, customers, triggers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="./dataset")
    ap.add_argument("--out", default="submission.jsonl")
    args = ap.parse_args()

    dataset_dir = Path(args.dataset)
    categories, merchants, customers, triggers = load_dataset(dataset_dir)

    pairs = json.load(open(dataset_dir / "test_pairs.json"))["pairs"]

    with open(args.out, "w", encoding="utf-8") as out:
        for pair in pairs:
            test_id = pair["test_id"]
            trigger = triggers.get(pair["trigger_id"])
            merchant = merchants.get(pair["merchant_id"])
            customer = customers.get(pair.get("customer_id")) if pair.get("customer_id") else None

            if not trigger or not merchant:
                print(f"SKIP {test_id}: missing trigger or merchant")
                continue

            category = categories.get(merchant.get("category_slug"))
            if not category:
                print(f"SKIP {test_id}: missing category {merchant.get('category_slug')}")
                continue

            composed = compose_message(category=category, merchant=merchant, trigger=trigger, customer=customer)

            line = {
                "test_id": test_id,
                "body": composed["body"],
                "cta": composed["cta"],
                "send_as": composed["send_as"],
                "suppression_key": trigger.get("suppression_key", ""),
                "rationale": composed["rationale"],
            }
            out.write(json.dumps(line, ensure_ascii=False) + "\n")
            print(f"{test_id}: {line['body'][:70]}...")

    print(f"\nWrote {args.out}")


if __name__ == "__main__":
    main()
