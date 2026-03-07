# BUILD_REPORT

Generated: 2026-03-07

## SYSTEM STATUS
- Stage 1 complete: documentation structure verified at `docs/`.
- Stage 2 complete: `docs/OPENRANGE_SYSTEM_MAP.md` generated with requested layers and flow.
- Stage 3 complete: `docs/OPENRANGE_ROADMAP.md` generated with Phase 1 to Phase 4 roadmap.
- Stage 4 complete: `docs/OPENRANGE_FEATURE_BACKLOG.md` generated with required backlog items.
- Stage 5 partial success: required engine/route/page files verified and `/api/radar` runtime check passed.
- Stage 5 failure (non-blocking): direct DB validation for `strategy_signals` failed with connection error (`AggregateError`) during pool query.
- Stage 6 complete: problem-area checks executed and locations mapped for Phase 1 continuation.
- Stage 7 complete: final consolidated build report generated.

Files created:
- `docs/OPENRANGE_ROADMAP.md`
- `docs/OPENRANGE_SYSTEM_MAP.md`
- `docs/OPENRANGE_FEATURE_BACKLOG.md`
- `docs/BUILD_REPORT.md`

Files verified:
- `server/engines/strategySignalEngine.js`
- `server/engines/radarEngine.js`
- `server/routes/radarRoutes.js`
- `client/src/pages/OpenMarketRadar.jsx`

## WORKING COMPONENTS
- Radar route is mounted in backend: `server/index.js` (`app.use('/api/radar', radarRoutes)`).
- Radar endpoint handler exists: `server/routes/radarRoutes.js`.
- Runtime API probe successful:
	- `GET /api/radar` -> HTTP `200`
	- Returned grouped arrays with counts: `A=5`, `B=6`, `C=14`
- Core strategy signal query paths exist in engines:
	- `server/engines/strategySignalEngine.js`
	- `server/engines/radarEngine.js`

## ISSUES FOUND
- Database table verification for `strategy_signals` could not be confirmed by live query in this run:
	- Check command returned: `{"ok":false,"error":"AggregateError"}`
	- Impact: table likely exists in code/migrations, but live DB connectivity prevented direct confirmation.
- Startup environment warnings detected during runtime validation:
	- Missing env keys: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROXY_API_KEY`
- Engine runtime warnings detected during startup logs:
	- Metrics scheduler timeout (`canceling statement due to statement timeout`)
	- Intel scheduler request failure (`status code 404`)

Phase 1 continuation problem-area map (locations only, no refactor yet):
- SPY / QQQ market cards (0% behavior investigation targets):
	- `client/src/pages/DashboardPage.jsx`
	- `client/src/pages/PreMarketPage.jsx`
	- `client/src/pages/PostMarketReview.jsx`
- TradingView ticker/widget usage (candidate removal/replacement targets):
	- `client/src/pages/MarketOverviewPage.jsx`
	- `client/src/pages/OpenMarketPage.jsx`
	- `client/src/components/shared/TradingViewChart.jsx`
	- `client/src/components/shared/TradingViewProfile.jsx`
	- `client/src/components/watchlist/ResearchPanel.jsx`
- Intel Inbox ingestion route and related flow:
	- `server/index.js` (`/api/intelligence/news/run`)
	- `server/routes/intelligence.js` (`/api/intelligence/email-ingest`)
	- `server/services/intelNewsRunner.js`
- Homepage member login button:
	- `client/src/pages/LandingPage.jsx` (login links to `/login` found)

Missing features from roadmap/backlog (not yet implemented in this build run):
- `signal_history` table
- Signal outcome tracking
- Backtesting engine
- Strategy performance analytics
- Stocks in Play scanner
- Catalyst detection engine
- Morning briefing newsletter generator
- News sentiment scoring
- Holly-style AI scanner
- Strategy ranking engine
- LLM trading assistant
- Signal explanation engine

## NEXT DEVELOPMENT PRIORITIES
- Restore reliable DB connectivity for validation and scheduler stability.
- Implement and verify `signal_history` plus outcome tracking to unblock analytics.
- Execute Phase 1 UI fixes in order:
	- SPY/QQQ card data mapping and fallback behavior
	- Replace TradingView widget dependencies with native components
	- Unify ticker tape behavior across Dashboard and Pre Market Command
	- Confirm Intel Inbox ingestion end-to-end from route to storage
- Add automated checks for `/api/radar`, `/api/intelligence/news`, and market context cards to prevent regressions.

## RADAR ARCHITECTURE CLEANUP (2026-03-07)
- `server/routes/radarRoutes.js` deprecated via rename to `server/routes/radarRoutes.deprecated.js`.
- Removed duplicate radar route module import from `server/index.js`.
- Removed duplicate route registration `app.use('/api/radar', radarRoutes)` from `server/index.js`.
- Canonical endpoint preserved: `app.get('/api/radar/summary', async (req, res) => { ... })`.
- Added startup trace in canonical endpoint: `console.log('[RADAR] summary endpoint active')`.

Syntax validation:
- `node --check server/index.js` -> success (no syntax errors).

Remaining `radarRoutes` references discovered (logged only, not auto-modified):
- `docs/BUILD_REPORT.md`
