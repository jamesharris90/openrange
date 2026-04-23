# OpenRange Short Change Log

Window covered: 2026-04-19 to 2026-04-22

## Key outcomes

1. Research classification is now stored, backfilled, and served live through `/api/v2/research/:symbol`.
2. Research-v2 Overview now supports:
   - Classification
   - Instrument Detail
   - Listing Type
3. Catalyst no-data messaging now explains structural gaps such as SPAC, shell, unit, warrant, note, fund, or penny-stock coverage limits.
4. Bulk missing-news recovery materially improved coverage.
5. Scheduled fresh-news autofill no longer depends on the tiny env symbol list and now targets stale active common/penny names from the database.
6. Earnings gap work was audited properly before repair.
7. A narrow approved earnings slice was backfilled and coverage improved.
8. Both backend and frontend were deployed successfully after correcting Railway root-directory behavior.

## Biggest do-not-roll-back items

1. Backend deploys must run from repo root `/Users/jamesharris/Server`, not from `/server`, because Railway expects `rootDirectory: server`.
2. Frontend deploys must run from repo root with `railway up -s openrange -e production`, not from `/trading-os`, because Railway expects `rootDirectory: trading-os`.
3. Do not remove the route-level research response normalization in `server/v2/routes/research.js` or production will lose classification fields even if the service still computes them.
4. Do not revert the scheduled news targeting fix in `server/ingestion/fmp_news_ingest.js` or fresh common-stock news will fall back to the old fixed-symbol behavior.

## News and catalyst work

1. Bulk provider recovery inserted `24697` news articles.
2. `3506` missing-news symbols were recovered.
3. Active missing-news count dropped from `4080` to `574`.
4. The scheduler fix now pulls stale active `COMMON_STOCK` and `PENNY_STOCK` symbols from `data_coverage.last_news_at` instead of using only `INGEST_SYMBOLS`.

## Classification work

1. Added persistent `ticker_classifications` storage.
2. Added heuristic classification service and backfill script.
3. Added broad classes:
   - Common Stock
   - SPAC / Shell
   - Unit / Warrant / Right
   - Preferred / Note
   - ETF / Fund / Trust
   - Penny Stock
4. Added finer instrument-detail labels including ADR, REIT, ETF, Closed-End Fund, Fund, Trust, Unit, Warrant, Right, Preferred, Note, SPAC Common, and Common Stock.
5. Production now returns examples such as:
   - `ADAC` → `SPAC / Shell`, `SPAC Common`, `COMMON_STOCK`
   - `AAPL` → `Common Stock`, `Common Stock`, `COMMON_STOCK`
   - `REED` → `Penny Stock`, `Common Stock`, `COMMON_STOCK`

## Earnings work

1. Full missing-earnings universe was audited against FMP `stable/earnings` before any repair.
2. Audit result across `805` missing symbols:
   - `31` `FULL_8_PLUS`
   - `105` partial history
   - `669` no provider data
3. Main conclusion: there was no safe full-universe backfill, only a narrow safe repair slice.
4. Approved repair slice size: `31` symbols.
5. Slice precheck:
   - `10` already had `8+` history rows
   - `8` had partial history
   - `13` had zero history
   - all `31` were still missing earnings coverage in `data_coverage`
6. Slice repair result:
   - `history_ingested`: `116`
   - `projected_events_ingested`: `16`
   - `coverage_rows_updated`: `31`
7. Slice postcheck:
   - coverage missing improved from `31` to `13`
8. Production `/api/earnings?symbol=REED` now returns a DB-backed partial payload with next report date `2026-06-16`.

## Deployment and validation

1. Backend deployment succeeded: `bea2d82d-26a8-4155-b83e-3404716ef336`.
2. Frontend deployment succeeded: `bd18529c-1b04-4def-870f-9399c248e53e`.
3. Production validations passed for:
   - `/api/v2/research/ADAC`
   - `/api/v2/research/AAPL`
   - `/api/v2/research/REED`
   - `/api/earnings?symbol=REED`

## Major committed repo themes across the 4-day window

1. Beacon nightly worker, adaptive tuning, outcome evaluation, and Beacon UI were introduced and stabilized.
2. Intelligence decision and top-opportunity runtime was hardened.
3. Market overview, research first-hit runtime, and health/integrity routes were stabilized.
4. Startup load and closed-market scheduler behavior were reduced.
5. Dashboard briefing and live narrative fallback were hardened.
6. Screener universe quality controls were tightened, especially around penny stocks and live floor logic.
7. Observability and data-trust routes were added and improved.

## Files that matter most

1. `server/ingestion/fmp_news_ingest.js`
2. `server/services/tickerClassificationService.js`
3. `server/scripts/backfillTickerClassifications.js`
4. `server/v2/services/researchService.js`
5. `server/v2/routes/research.js`
6. `trading-os/src/app/research-v2/[symbol]/page.tsx`
7. `trading-os/src/components/research/CatalystPanel.jsx`
8. `server/tmp/audit_missing_earnings_fmp.js`
9. `server/tmp/backfill_full8_earnings_slice.js`

## Reuse commands

1. Backend deploy: `cd /Users/jamesharris/Server && railway up`
2. Frontend deploy: `cd /Users/jamesharris/Server && railway up -s openrange -e production`
3. Classification backfill: `cd /Users/jamesharris/Server/server && npm run backfill:ticker-classifications`
4. Earnings audit: `cd /Users/jamesharris/Server/server && node tmp/audit_missing_earnings_fmp.js`
5. Targeted earnings repair: `cd /Users/jamesharris/Server/server && node tmp/backfill_full8_earnings_slice.js`
