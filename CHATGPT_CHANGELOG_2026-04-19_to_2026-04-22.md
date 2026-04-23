# OpenRange Change Report

Window covered: 2026-04-19 to 2026-04-22

Purpose: preserve the exact improvements made over the last 4 days so future ChatGPT sessions do not roll back working fixes, data-recovery steps, deployment learnings, or validated runtime behavior.

## High-Value Do-Not-Roll-Back Outcomes

1. Backend deploys for `OpenRange-Backend` must be run from repo root `/Users/jamesharris/Server`, not from `/server`, because the Railway service is configured with `rootDirectory: server`.
2. Frontend deploys for `openrange` must also be run from repo root with `railway up -s openrange -e production`, not from `/trading-os`, because that service is configured with `rootDirectory: trading-os`.
3. Research classification fields are now part of the production `/api/v2/research/:symbol` contract and must not be dropped by route serialization.
4. Missing-news recovery was materially improved with bulk provider backfill; active missing-news count dropped from `4080` to `574` after inserting `24697` recovered articles across `3506` symbols.
5. Scheduled news autofill is no longer limited to `INGEST_SYMBOLS`; it now targets stale active common-stock and penny-stock symbols from `data_coverage.last_news_at`.
6. Earnings gap work is no longer guesswork. FMP `stable/earnings` was audited across the full missing universe and only a narrow subset was suitable for direct repair.
7. The approved targeted earnings slice was refreshed and coverage for that slice improved from `31` missing to `13` missing after backfill and coverage-row refresh.

## 2026-04-22

### Research classification system added and surfaced

1. Added persistent ticker classification storage in `ticker_classifications`.
2. Added migration `server/db/migrations/059_ticker_classifications.sql`.
3. Added service `server/services/tickerClassificationService.js` to derive and normalize:
   - `stock_classification`
   - `stock_classification_label`
   - `stock_classification_reason`
   - `listing_type`
   - `instrument_detail`
   - `instrument_detail_label`
4. Supported broad classification buckets:
   - `COMMON_STOCK`
   - `SPAC_SHELL`
   - `UNITS_WARRANTS_RIGHTS`
   - `PREFERRED_NOTES`
   - `ETF_FUND_TRUST`
   - `PENNY_STOCK`
   - `OTHER`
5. Added finer instrument-detail support for:
   - ADRs
   - REITs
   - ETFs
   - closed-end funds
   - funds
   - trusts
   - units
   - warrants
   - rights
   - preferreds
   - notes
   - SPAC common stock
   - common stock
6. Added classification backfill script `server/scripts/backfillTickerClassifications.js`.
7. Backfilled classifications across the active ticker universe.
8. Extended `server/v2/services/researchService.js` to read and merge classification data into the research payload.
9. Hardened `server/v2/routes/research.js` so seeded/full response paths do not drop classification metadata.
10. Extended `trading-os/src/app/research-v2/[symbol]/page.tsx` to show new Overview values under Country:
    - Classification
    - Instrument Detail
    - Listing Type
11. Updated `trading-os/src/components/research/CatalystPanel.jsx` so no-data catalyst copy explains gaps using ticker classification.
12. Updated `trading-os/src/components/research/ResearchPage.jsx` and the research-v2 page to pass company metadata into the Catalyst panel.

### Classification results validated

1. Production `/api/v2/research/ADAC` now returns:
   - classification: `SPAC / Shell`
   - instrument detail: `SPAC Common`
   - listing type: `COMMON_STOCK`
2. Production `/api/v2/research/AAPL` now returns:
   - classification: `Common Stock`
   - instrument detail: `Common Stock`
   - listing type: `COMMON_STOCK`
3. Production `/api/v2/research/REED` now returns:
   - classification: `Penny Stock`
   - instrument detail: `Common Stock`
   - listing type: `COMMON_STOCK`
   - next earnings date: `2026-06-16`

### Missing-news recovery and scheduled autofill work

1. Ran a bulk provider audit and recovery pass for active tickers with missing news.
2. Added `server/tmp/audit_missing_news_recovery.js` as the recovery and reporting script.
3. Validated FMP as the practical provider for symbol-specific recovery.
4. Inserted `24697` recovered articles.
5. Recovered `3506` symbols.
6. Reduced active missing-news count from `4080` to `574`.
7. Determined that fresh common-stock news was not guaranteed to self-heal under the old scheduler path because `runNewsIngestion()` defaulted to a tiny env list.
8. Fixed that root cause in `server/ingestion/fmp_news_ingest.js`.
9. Scheduled default targeting now uses stale active `COMMON_STOCK` and `PENNY_STOCK` symbols from `data_coverage.last_news_at` instead of `INGEST_SYMBOLS`.
10. Validated the new scheduled targeting path by:
    - resolving stale targets from the database
    - running a minimal scheduled-style ingestion pass
    - confirming inserted fresh FMP news through the corrected path

### Earnings gap audit and repair

1. Added `server/tmp/audit_missing_earnings_fmp.js` to audit the full active missing-earnings universe against `https://financialmodelingprep.com/stable/earnings?symbol={TICKER}`.
2. Fixed the audit script so it loads `/server/.env` explicitly and works regardless of terminal cwd.
3. Prechecked the DB before using the audit:
   - required tables present
   - required columns present
   - row counts captured
4. Audited the full missing-earnings universe:
   - active missing earnings: `805`
   - `FULL_8_PLUS`: `31`
   - `PARTIAL_HISTORY`: `105`
   - `NO_PROVIDER_DATA`: `669`
5. By inferred reason, the audit found:
   - `394` structural no-earnings instruments
   - `275` provider-missing or non-reporting symbols
   - `75` likely recent listings with short history
   - `17` structurally limited instruments with sparse history
   - `13` provider partial-history cases
   - `31` provider-sufficient cases
6. Main conclusion: there was not a safe full-universe earnings backfill, only a narrow safe repair slice.
7. Added `server/tmp/backfill_full8_earnings_slice.js` to precheck, backfill, refresh coverage, and post-validate the approved `31` provider-sufficient symbols.
8. Precheck for the approved slice recorded:
   - `31` target symbols
   - `10` already had `8+` history rows
   - `8` had partial history
   - `13` had zero history
   - all `31` were still missing earnings coverage in `data_coverage`
9. Backfill results for the approved slice:
   - `events_ingested`: `1`
   - `projected_events_ingested`: `16`
   - `history_ingested`: `116`
   - `coverage_rows_updated`: `31`
10. Postcheck result for the approved slice:
    - coverage missing fell from `31` to `13`
11. Production `/api/earnings?symbol=REED` now returns a DB-backed partial earnings payload with next report date `2026-06-16`.

### Deployment and production validation

1. Backend Railway deploy succeeded with deployment ID `bea2d82d-26a8-4155-b83e-3404716ef336`.
2. Frontend Railway deploy initially failed because it was launched from `/trading-os` while the service already expected `rootDirectory: trading-os`.
3. Frontend redeploy from repo root succeeded with deployment ID `bd18529c-1b04-4def-870f-9399c248e53e`.
4. Production endpoint validation was captured in `server/logs/endpoint_validation.json`.
5. Live production checks passed for:
   - `/api/v2/research/ADAC`
   - `/api/v2/research/AAPL`
   - `/api/v2/research/REED`
   - `/api/earnings?symbol=REED`
6. Important deployment lesson recorded:
   - backend deploy from repo root
   - frontend deploy from repo root with `railway up -s openrange -e production`

## 2026-04-21

### Core committed repo changes

1. `ops(migration): universe cleanup to US-listed actives over $2`
   - added `server/migrations/20260421_universe_full_cleanup.md`
2. `docs(fmp): document /stable/ freshness limitation for mid-cap symbols`
   - added `server/docs/FMP_COVERAGE_LIMITATION.md`
3. `ops(migration): record intraday_1m timestamp index for trust queries`
   - added `server/migrations/20260421_intraday_timestamp_index.md`
4. `feat(dashboard): switch briefing to quick look analysis`
5. `fix(dashboard): add live narrative fallback`
6. `fix(dashboard): harden AI briefing generation`
7. `docs(data-trust): document SLA framework and observability endpoints`
   - added `server/docs/DATA_TRUST.md`
8. `fix(screener): enforce live floor in result universe`
9. `fix(screener): exclude penny stocks under $1 from results`
10. `fix(earnings): keep historical calendar windows on db rows`
11. `fix(earnings): join earnings_history for reported actuals on calendar route`
12. `fix(ingestion): use extended-hours batch quotes for live feed`
13. `fix(observability): move trust route onto shared db query layer`
14. `fix(observability): align trust route db config and log failures`
15. `fix(observability): serialize trust queries and source earnings estimates from earnings_events`
16. `feat(observability): add /api/data/trust endpoints for SLA-based data health`
17. `feat(intraday): expand fallback universe to tradeable symbols and raise cycle budget`
18. `feat(data): expand intraday priority, multi-feed news, session-aware quotes`

### Net effect of 2026-04-21 work

1. Dashboard briefing logic was hardened and given better fallbacks.
2. Screener universe quality was tightened, especially around penny-stock filtering and live floor enforcement.
3. Earnings routes became more reliable by joining `earnings_history` and preserving historical window data on calendar responses.
4. Data-trust observability was added and then hardened with better DB behavior and logging.
5. Intraday, news, quotes, and research freshness improved through broader ingestion and session-aware runtime handling.

## 2026-04-20

### Core committed repo changes

1. `fix(beacon): scope nightly cycle universe, add heartbeat + zombie cleanup`
2. `chore(beacon): instrument railway launcher handoff`
3. `fix(beacon): convert nightly worker to long-lived cron scheduler`
4. `chore: remove unused repo-root Dockerfile to prevent Railway service auto-detection`

### Net effect of 2026-04-20 work

1. Beacon nightly processing was converted into a more stable long-lived scheduled worker.
2. Railway launcher handoff behavior was instrumented so startup behavior could be traced.
3. Zombie/nightly worker cleanup and heartbeat handling were added.
4. Repo-level Railway service detection became safer by removing an unused root Dockerfile that could confuse deployment selection.

## 2026-04-19

### Core committed repo changes

1. `feat(beacon): nightly worker + adaptive tuning + outcome evaluation`
   - added backend Beacon worker pieces
   - added Beacon API route
   - added frontend Beacon page and tabs
2. `Extend decision route timeout budget`
3. `Short-circuit top opportunities to stocks in play`
4. `Backfill top opportunities from stocks in play`
5. `Restore internal top opportunities rows`
6. `Harden intelligence decision and opportunities runtime`
7. `Harden data integrity metadata lookup`
8. `Fix stale earnings calendar fallback`
9. `Harden research first-hit runtime`
10. `Harden market overview runtime`
11. `Fix hosted health and integrity timeouts`
12. `Reduce startup load and normalize weekend freshness`
13. `Skip market data jobs while closed`
14. `Harden news and integrity fallbacks`
15. `Stabilize cached news snapshot queries`

### Net effect of 2026-04-19 work

1. Beacon was introduced as a first-class feature with nightly worker support, adaptive tuning, outcome evaluation, API route, and frontend UI.
2. Intelligence decision and top-opportunity runtime behavior was hardened so the system could recover from sparse or degraded internal data.
3. Market overview, research first-hit behavior, and system health/integrity routes became more resilient.
4. Startup load and closed-market scheduling behavior were reduced to prevent unnecessary churn and stale-runtime failures.
5. News snapshot handling and stale earnings fallbacks were stabilized.

## New Files Added During This Window

1. `server/db/migrations/059_ticker_classifications.sql`
2. `server/services/tickerClassificationService.js`
3. `server/scripts/backfillTickerClassifications.js`
4. `server/tmp/audit_missing_news_recovery.js`
5. `server/tmp/audit_missing_earnings_fmp.js`
6. `server/tmp/backfill_full8_earnings_slice.js`
7. `server/docs/FMP_COVERAGE_LIMITATION.md`
8. `server/docs/DATA_TRUST.md`
9. `server/migrations/20260421_intraday_timestamp_index.md`
10. `server/migrations/20260421_universe_full_cleanup.md`
11. `server/v2/routes/beacon.js`
12. `trading-os/src/app/beacon/page.tsx`
13. `trading-os/src/components/beacon/BeaconHeader.tsx`
14. `trading-os/src/components/beacon/MorningPicksTab.tsx`
15. `trading-os/src/components/beacon/StrategyGradesTab.tsx`
16. `trading-os/src/components/beacon/TrackRecordTab.tsx`
17. `trading-os/src/components/beacon/beacon-api.ts`

## Validation Artifacts Created or Updated

1. `server/logs/precheck_validation.json`
2. `server/logs/build_validation_report.json`
3. `server/logs/endpoint_validation.json`
4. `server/logs/earnings_gap_audit.json`
5. `server/logs/recovered_news_symbols.json`
6. `server/logs/missing_news_remainder_groups.json`

## Production State At End Of Window

1. Backend deploy status: success
2. Frontend deploy status: success
3. Research endpoint classification contract: live
4. Research-v2 Overview classification labels: built and deployed on the frontend service
5. Catalyst no-data copy now explains structural data gaps using ticker classification
6. Scheduled fresh-news autofill now targets stale active common-stock and penny-stock names
7. Earnings repair is now based on audited provider sufficiency, not blanket backfill assumptions

## Known Cautions Still Open

1. Railway logs still show unrelated runtime health warnings for some pre-existing subsystems, including stale `news_articles`, stale `earnings_transcripts`, and empty `options_cache`.
2. The earnings universe still contains many structurally unsupported or provider-missing names, so future earnings repair should stay selective.
3. Do not revert the route-level research response normalization, or production will lose classification fields even if the service layer still computes them.

## Safe Reuse Commands

1. Backend deploy: `cd /Users/jamesharris/Server && railway up`
2. Frontend deploy: `cd /Users/jamesharris/Server && railway up -s openrange -e production`
3. Classification backfill: `cd /Users/jamesharris/Server/server && npm run backfill:ticker-classifications`
4. Earnings audit: `cd /Users/jamesharris/Server/server && node tmp/audit_missing_earnings_fmp.js`
5. Targeted FULL_8_PLUS earnings repair: `cd /Users/jamesharris/Server/server && node tmp/backfill_full8_earnings_slice.js`
