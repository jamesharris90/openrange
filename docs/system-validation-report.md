# System Validation Report

Generated: 2026-03-18T11:43:00Z
Scope: Real pipeline audit and targeted repair for market, intraday, opportunities, signals, and catalyst paths.

## Constraints Applied

- Real DB and live runtime only.
- No synthetic test fixtures used as validation proof.
- No destructive schema changes performed.
- Runtime ports preserved: backend 3000, Next frontend 3001.

## Final Validation Matrix

| Layer | Check | Result | Evidence |
| --- | --- | --- | --- |
| Backend runtime | key APIs reachable | PASS | /api/market/quotes, /api/market/ohlc, /api/intelligence/opportunities, /api/intelligence/signals, /api/intelligence/catalysts, /api/catalysts/latest, /api/catalyst-reactions/latest all returned 200 |
| Next runtime | proxy APIs reachable | PASS | /api/intelligence/markets, /api/ohlc/intraday, /api/intelligence/opportunities, /api/intelligence/signals, /api/intelligence/catalysts, /api/catalysts/latest, /api/catalyst-reactions/latest all returned 200 |
| Quote data path | DB -> backend -> Next | PASS | backend count=2 for AAPL,SPY; Next count=2 |
| Intraday data path | DB -> backend -> Next | PASS AFTER REPAIR | backend AAPL interval=1m returned 5 bars for limit=5; Next returned 780 bars total for AAPL |
| Opportunities path | trade_setups-backed API | PASS | backend count=6; Next count=6 |
| Signals path | strategy_signals/trade_setups signal contract | PASS | backend count=50; Next count=50 |
| Intelligence catalysts path | news_catalysts feed | PASS | backend count=5; Next returns wrapped payload with data.items length 5 |
| Catalyst intelligence path | catalyst_intelligence feed | PASS | backend count=5; Next count=5 |
| Catalyst reactions path | catalyst_reactions feed | PASS | backend count=5; Next count=5 |

## Database Freshness Snapshot

Captured with server/scripts/collect_pipeline_evidence.js.

- market_quotes: 5959 rows, latest updated_at 2026-03-18T11:40:46.231Z
- intraday_1m: 438357 rows, latest timestamp 2026-03-18T11:39:00.000Z
- daily_ohlc: 2350357 rows, latest date 2026-03-13
- trade_setups: 310 rows, latest updated_at 2026-03-18T11:40:12.446Z
- strategy_signals: 204 rows, latest updated_at 2026-03-18T11:40:10.374Z
- trade_catalysts: 4397 rows, latest created_at 2026-03-16T13:31:10.202Z
- catalyst_signals: 171 rows, latest created_at 2026-03-16T20:10:01.523Z
- news_catalysts: 748 rows, latest updated_at 2026-03-18T11:40:03.142Z
- catalyst_intelligence: 171 rows, latest created_at 2026-03-18T11:40:10.106Z
- catalyst_reactions: 171 rows, latest created_at 2026-03-16T17:30:18.934Z
- opportunities: 0 rows

## Intraday Repair Summary

Issue before repair:

- Intraday endpoint remained up but returned empty data for key symbols (AAPL/SPY and peers) despite non-empty table for other symbols.

Root causes observed during repair cycle:

- Legacy intraday provider path produced 403.
- First migration attempt to stable provider used wrong endpoint shape and produced 404.
- After endpoint correction, inserts failed for decimal volume values cast into bigint.

Changes implemented in server/ingestion/fmp_intraday_ingest.js:

- Added pinned symbols: AAPL, SPY, QQQ, IWM, NVDA, MSFT.
- Moved intraday fetch to shared stable client via fmpFetch.
- Corrected call path to /historical-chart/1min with symbol query param.
- Normalized volume to integer before insert for bigint compatibility.

Post-repair evidence:

- intraday_1m contains 780 bars each for AAPL/SPY/QQQ/IWM/NVDA/MSFT, latest timestamp 2026-03-17T15:59:00.000Z.
- GET /api/market/ohlc?symbol=AAPL&interval=1m&limit=5 returns non-empty real candles.

## Open Gaps And Risks

- opportunities table is empty and not used by primary opportunities endpoint; active path is trade_setups-based.
- Next /api/intelligence/catalysts response shape differs from direct backend contracts, requiring consumers to read data.items.
- Daily OHLC freshness is older than intraday freshness; acceptable for current contract but should be monitored.

## Artifacts Produced

- docs/data-schema-report.json
- docs/data-pipeline-report.json
- docs/system-validation-report.md
- server/scripts/collect_pipeline_evidence.js
