# Roadmap: Investigate scheduled news ingestion strategy change

## Context

During the 2026-04-19 to 2026-04-22 ChatGPT earnings data session,
`server/ingestion/fmp_news_ingest.js` was modified to change scheduled
news ingestion from env-list-based targeting to DB-driven selection of
stale active common/penny symbols.

The change introduces:
- `SCHEDULED_NEWS_STALE_LOOKBACK_DAYS` env (default 3)
- `SCHEDULED_NEWS_SYMBOL_LIMIT` env (default 75)
- DB query for stale symbols instead of env-provided symbol list

## Why held

This change was flagged RED in Phase 27 Bundle 2 review because:
- Not clearly earnings-related
- Changes broad news ingestion targeting behavior
- Could affect multi-feed news ingestion we recently fixed (Phase 5)
- Requires verification that it doesn't regress news freshness SLAs

## Investigation needed before commit or revert

1. Is this change currently running in production?
   - Check Railway env vars for SCHEDULED_NEWS_STALE_LOOKBACK_DAYS
   - Check if the new code path is being executed

2. Does it break or enhance the multi-feed news ingestion?
   - Verify stock_news, press_release, market_analysis feeds all still flow
   - Check news_articles row rate over last 24h vs baseline

3. Does DB-driven targeting produce better coverage than env-list?
   - Count distinct symbols with fresh news in last 24h
   - Compare against env-list symbol count

4. Does it affect earnings display?
   - ChatGPT may have changed this because stale news was thinning earnings
     catalyst context on research pages
   - Worth verifying with a symbol on the old list vs a symbol not on it

## Decision path

- If investigation shows improvement -> commit with earnings-context rationale
- If investigation shows neutral -> commit as standalone news improvement
- If investigation shows regression -> revert the file, stay on old behavior

## Priority: MEDIUM

Not blocking current tree cleanup. Can be addressed after Beacon fix
and decision engine work.