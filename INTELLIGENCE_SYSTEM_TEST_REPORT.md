# Intelligence System Test Report

Date: 2026-03-08
Scope: End-to-end validation and repair of DB connectivity, RSS ingestion, morning briefing generation, OpenAI narrative, Resend email, and API endpoint health.

## 1) Project Audit

Required files confirmed:
- `server/workers/rss_worker.js`
- `server/services/mcpClient.js`
- `server/services/emailService.js`
- `server/engines/morningBriefEngine.js`
- `server/system/startEngines.js`

DB client mapping:
- Primary shared pool: `server/db/pool.js`
- Query wrapper: `server/db/pg.js` (imports shared pool)
- Legacy wrapper: `server/db/index.js` (imports shared pool)
- RSS worker import: `../db/pg`
- Morning brief engine import: `../db/pg`
- API routes primarily use `../db/pg` or `../db` (which both use `server/db/pool.js`)

Conclusion: backend uses one shared DB client pool via `server/db/pool.js`.

## 2) Environment Validation

Startup dotenv status:
- `server/index.js` already loads dotenv from `server/.env` and fallback root `.env`.

Variables confirmed present:
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `RESEND_API_KEY`
- `EMAIL_FROM`

(Secrets intentionally redacted.)

## 3) Connectivity Repair Applied

### Issue Identified
- DNS failure (`ENOTFOUND`) with the previously configured hostname format in `DATABASE_URL`.

### Fixes Applied
1. Updated `server/.env` DB URL to a resolvable Supabase pooler format:
   - user: `postgres.<project_ref>`
   - host: regional pooler host (`aws-1-eu-west-1.pooler.supabase.com`)
   - port: `6543`
2. Updated `server/db/pool.js` for Supabase PgBouncer compatibility:
   - SSL enabled: `ssl: { rejectUnauthorized: false }`
   - reduced pool default: `max: 5` (override via `PGPOOL_MAX`)
3. Updated `server/db/pg.js` startup log to reflect pool max default.
4. Added dotenv loading to manual test scripts (`testRSS.js`, `testMorningBrief.js`) so they use runtime `.env` when run directly.

## 4) DB Connection Test

Script created:
- `server/scripts/testDBConnection.js`

Result:
- PASS
- Output included: `DB CONNECTED`
- Query executed: `SELECT NOW()`

## 5) Table Access Verification

Counts verified:
- `news_articles`: 570
- `morning_briefings`: 0 (before run)
- `market_metrics`: 5663

`news_articles` exists; fallback create guard in test path was not required to create a new table.

## 6) RSS Ingestion Test

Command run:
- `node server/scripts/testRSS.js`

Initial issue repaired:
- `news_articles.id` was UUID-typed while RSS worker generated non-UUID IDs.
- Fix applied in `server/workers/rss_worker.js`: deterministic UUID-style ID generation from URL hash.

Final RSS result:
- PASS (partial feed tolerance by design)
- Worker summary: `ingested: 60`, `failures: 1`
- One feed (`marketwatch`) returned HTTP 403, but other feeds succeeded.

Sample latest rows confirmed from `news_articles`.

## 7) Morning Brief + OpenAI + Email Test

Command run:
- `node server/scripts/testMorningBrief.js`
- Uses test override recipient: `jamesharris4@me.com`

Pipeline behavior:
- RSS collection: PASS
- DB data pulls (`market_metrics`, `market_quotes`): PASS
- OpenAI narrative call: fallback engaged due model mismatch in env (`gpt-5.3` not available for API key)
- DB write to `morning_briefings`: PASS
- Email send via Resend: PASS path reached and returned sent status

Observed logs:
- `[MCP] generating narrative`
- `[DB] briefing stored`
- `[EMAIL] sending via Resend`
- `[EMAIL] delivered`

## 8) Briefing Row Verification

Latest row check:
- `id`: 1
- `signals_count`: 12
- `market_count`: 1
- `news_count`: 20
- `narrative` keys present: `overview`, `risk`, `catalysts`, `watchlist`
- `email_status.sent`: true
- recipient includes `jamesharris4@me.com`

## 9) API Validation (Post-Restart)

Server restarted and endpoint checks returned HTTP 200:
- `/api/intelligence/news` -> 200
- `/api/opportunities/top` -> 200
- `/api/market/sector-strength` -> 200
- `/api/system/db-status` -> 200

## 10) Additional Notes

- OpenAI model configured in env appears to be `gpt-5.3`, which returned 404 for this API key.
- Morning briefing still completed using engine fallback narrative logic.
- Resend response returned sent state but provider id was null in current service mapping.

## 11) Fixes Applied Summary

- DB pooler connectivity repaired.
- SSL enabled for pooler connections.
- Pool size adjusted for PgBouncer usage.
- Manual test scripts made environment-aware.
- RSS UUID/id schema mismatch repaired.
- Full pipeline executed successfully through briefing + email path.
