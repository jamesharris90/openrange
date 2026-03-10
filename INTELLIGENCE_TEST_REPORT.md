# Intelligence System Full Test Report

Date: 2026-03-08
Scope: Full-system validation of RSS Worker, OpenAI MCP narrative, Morning Brief engine, Resend delivery, and scheduler wiring.

## 1) Phase 1 - System Audit

### Required Files
- PASS: `server/workers/rss_worker.js`
- PASS: `server/services/mcpClient.js`
- PASS: `server/services/emailService.js`
- PASS: `server/engines/morningBriefEngine.js`
- PASS: `server/system/startEngines.js`

### Environment + Dotenv
- PASS: backend entrypoint already loads dotenv in `server/index.js`:
  - `require('dotenv').config({ path: path.resolve(__dirname, '.env') });`
  - fallback root `.env` load also present.
- PASS: required env keys are present in `server/.env`:
  - `OPENAI_API_KEY`
  - `RESEND_API_KEY`
  - `EMAIL_FROM`

## 2) Phase 2 - RSS Ingestion Execution

### Command
- `node server/scripts/testRSS.js`

### Result
- FAIL (runtime): DB connection failure before ingestion insert.

### Logs
- `DB pool configured: shared(max=10) idle=30s timeout=5s`
- `DB pool initialised`
- `[TEST] Running RSS ingestion`
- `DB query failed:  (workers.rss.ensure_news_articles)`
- `[TEST] RSS ingestion failed:`

## 3) Phase 3/4/5 - Morning Brief Test Script + Test Email Override + Execution

### Test Script Added
- `server/scripts/testMorningBrief.js`

### Engine Compatibility Update
- Updated `server/engines/morningBriefEngine.js` to expose:
  - `runMorningBrief(options)`
- Supports required test override:
  - `runMorningBrief({ testEmail: 'jamesharris4@me.com' })`
  - internally maps `testEmail` -> recipient override.

### Command
- `node server/scripts/testMorningBrief.js`

### Result
- FAIL (runtime): DB connection failure at RSS step, so MCP+DB insert+email not reached.

### Logs
- `DB pool configured: shared(max=10) idle=30s timeout=5s`
- `DB pool initialised`
- `[TEST] Running Morning Brief`
- `[RSS] news collected`
- `DB query failed:  (workers.rss.ensure_news_articles)`
- `[TEST] Morning Brief failed:`

## 4) Phase 6 - Database Verification

### Commands
- `SELECT headline, source FROM news_articles ORDER BY published_at DESC LIMIT 10;`
- `SELECT * FROM morning_briefings ORDER BY created_at DESC LIMIT 1;`

### Result
- FAIL: both queries blocked by DB connectivity.

### Logs
- `NEWS_QUERY_ERROR ECONNREFUSED`
- `BRIEF_QUERY_ERROR ECONNREFUSED`

## 5) Scheduler Audit (Cron)

### Result
- PASS (code-level wiring present in `server/system/startEngines.js`):
  - RSS cron: `*/2 * * * *`
  - Morning brief cron: `0 8 * * 1-5` with `America/New_York`

## 6) OpenAI Narrative + Resend Delivery Status

### OpenAI MCP
- BLOCKED by upstream DB connectivity failure in workflow execution path.
- Code path exists and is wired via `generateMorningNarrative` in `server/services/mcpClient.js`.

### Resend Email
- BLOCKED by earlier DB failure in test sequence; send path not reached in this run.
- Code path exists and is wired via `sendBriefingEmail` in `server/services/emailService.js`.

## 7) Root Cause / Error Handling

### Primary Failure
- PostgreSQL is unreachable from current test runtime.
- Direct probe result:
  - `select 1` => `DB_FAIL ECONNREFUSED`

### Safety Constraint Followed
- No production architecture rewrites were performed.
- Only test scripts and a compatibility alias (`runMorningBrief`) were added.

## 8) Recommendations to Complete Real Email Test

1. Restore DB network/access for `DATABASE_URL` target from this runtime (or run tests on the host that has DB access).
2. Re-run:
   - `node server/scripts/testRSS.js`
   - `node server/scripts/testMorningBrief.js`
3. Re-run verification queries:
   - `SELECT headline, source FROM news_articles ORDER BY published_at DESC LIMIT 10;`
   - `SELECT * FROM morning_briefings ORDER BY created_at DESC LIMIT 1;`
4. Confirm email delivery in Resend dashboard using returned provider message ID from logs.
5. Validate expected email sections:
   - Latest news
   - Geopolitical narrative
   - Sector flow
   - Market bias (SPY/QQQ)
   - Top stocks in play
   - Top earnings
   - Best setup
   - Previous day recap

## 9) Final Status

- RSS ingestion status: BLOCKED (DB ECONNREFUSED)
- OpenAI narrative generation: BLOCKED (workflow stopped before MCP stage)
- Database insertion: BLOCKED
- Email delivery: BLOCKED in this run (workflow did not reach send)
- Scheduler wiring: PASS (configured in startup)

Real morning intelligence email to `jamesharris4@me.com` could not be sent in this environment due the DB connectivity blocker.
