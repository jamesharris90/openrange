# Research Validation Matrix

Generated: 2026-04-06T13:39:39.657Z
Base URL: http://127.0.0.1:3018

## Research Endpoints

| Ticker | Status | Time (ms) | Symbol | Decision | Price | Earnings | Fundamentals | Context | Data Confidence |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| AAPL | 200 | 8 | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| MU | 200 | 11790 | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| CRWD | 200 | 4246 | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| SMCI | 200 | 4417 | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| SOFI | 200 | 6910 | PASS | PASS | PASS | PASS | PASS | PASS | PASS |

## Regression Endpoints

| Endpoint | Status | Time (ms) | Result |
| --- | --- | ---: | --- |
| /api/health | 200 | 3006 | PASS |
| /api/screener | 200 | 195 | PASS |
| /api/intelligence/decision/AAPL | 200 | 13778 | PASS |
| /api/intelligence/top-opportunities?limit=5 | 200 | 1582 | PASS |
| /api/market/overview | 200 | 4990 | PASS |
| /api/earnings/calendar?limit=5 | 200 | 5511 | PASS |

## Samples

- AAPL: price=257.35999, next_earnings=2026-05-07, sector=Technology
- MU: price=372.93, next_earnings=2026-06-24, sector=Technology
- CRWD: price=398.712, next_earnings=2026-06-02, sector=Technology
- SMCI: price=23.08, next_earnings=2026-05-05, sector=Technology
- SOFI: price=16.34, next_earnings=n/a, sector=Financial Services
