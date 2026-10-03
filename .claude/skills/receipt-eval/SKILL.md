---
name: receipt-eval
description: Evaluate receipt-scan accuracy (AI extraction + alias/fuzzy matching) against real labelled receipts in fixtures/receipts, and compare providers or prompt versions. Use after changing the extraction prompt, JSON schema, provider/model, normalization or matching logic.
---

# Receipt eval

## Fixtures
`fixtures/receipts/<id>/`
- `image.jpg` — real receipt photo (gitignored if the user prefers; ask before committing photos)
- `expected.json` — hand-checked ground truth:
  ```json
  { "chain": "Esselunga", "vat_number": "...", "date": "2026-10-01", "total_cents": 2345,
    "lines": [{ "raw_text": "BAN.CHIQ.", "price_cents": 189, "discount_cents": 0, "product": "Banane Chiquita" }] }
  ```
  Optional per line: `packages` (packages bought on that printed line, default 1; a "2 PZ x 1,99" row above it → 2) and
  `pieces` (pieces in each package, only when printed: "UOVA 6P" → 6). Repeated printed lines stay separate lines here;
  the eval checks the merged review lines (`merged`) apart.
Aim for 5–10 receipts covering different chains, discounts, weighed items and multi-quantity lines.

## Run
`docker compose exec dev npm run eval:receipts [--provider gemini|workers-ai] [--model <id>] [--no-ai-match]`
(script in `scripts/eval-receipts.ts`; it calls the same service code the Worker uses, with real API keys from `.dev.vars`).

The script must respect the free-tier quotas: run sequentially, and warn if the run would exceed ~half the daily quota.

## Metrics (per receipt and overall)
- Store/chain correct, date correct, total correct
- Line recall/precision (matched by price + fuzzy raw_text)
- Price exact-match rate, discount attached to the right line
- Product match accuracy: alias / fuzzy-only / fuzzy+AI
- Sum check: Σ lines − discounts == printed total
- Latency and number of AI calls

## Report
Write results to `fixtures/receipts/results/<date>-<provider>-<model>.json` and show a comparison table vs the previous result file. A change that lowers any key metric must be called out explicitly, not hidden.
