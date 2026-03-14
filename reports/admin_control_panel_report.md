# OpenRange Admin Control Panel Report

Date: 2026-03-14
Scope: Frontend admin surfaces, route gating, backend admin APIs, access control model, operational reliability, and improvement roadmap.

## 1. Executive Summary
The admin control surface is broad, functional, and split into clear domains:
- Access and feature governance
- System diagnostics and monitoring
- Learning and validation analytics
- Signal intelligence operations
- Newsletter operational controls

Overall maturity is good for an internal production panel, with strong role/feature gating and resilient backend query patterns in core admin routes. The largest gaps are integration mismatches between some frontend pages and backend routes, plus a deployment portability risk from path-case inconsistencies.

Current posture:
- Security: Strong, with admin middleware and feature gates in place.
- Observability: Good, multiple diagnostics and telemetry endpoints.
- Reliability: Mixed, most pages are robust but at least one page appears wired to a non-existent endpoint.
- UX consistency: Mixed, major pages are polished, some legacy pages still use inconsistent styling and data-loading patterns.

## 2. Admin Surface Inventory
### 2.1 Main Admin Entry
- Control panel page: [client/src/pages/AdminControlPanel.jsx](client/src/pages/AdminControlPanel.jsx)
- Layout wrapper alias: [client/src/components/layout/AdminLayout.jsx](client/src/components/layout/AdminLayout.jsx)
- Primary layout implementation: [client/src/components/admin/AdminLayout.jsx](client/src/components/admin/AdminLayout.jsx)

Primary tabs in control panel:
- Users
- Feature Controls
- Audit Trail
- System Links

### 2.2 Admin Sub-Pages
- System diagnostics: [client/src/pages/Admin/SystemDiagnostics.jsx](client/src/pages/Admin/SystemDiagnostics.jsx)
- Learning dashboard: [client/src/pages/Admin/LearningDashboard.jsx](client/src/pages/Admin/LearningDashboard.jsx)
- Strategy edge dashboard: [client/src/pages/Admin/StrategyEdgeDashboard.jsx](client/src/pages/Admin/StrategyEdgeDashboard.jsx)
- Calibration dashboard: [client/src/pages/Admin/CalibrationDashboard.jsx](client/src/pages/Admin/CalibrationDashboard.jsx)
- Missed opportunities validation page: [client/src/pages/Admin/MissedOpportunitiesPage.jsx](client/src/pages/Admin/MissedOpportunitiesPage.jsx)
- System monitor page: [client/src/pages/Admin/SystemMonitorPage.jsx](client/src/pages/Admin/SystemMonitorPage.jsx)
- Legacy diagnostics shell: [client/src/pages/AdminDiagnostics.jsx](client/src/pages/AdminDiagnostics.jsx)
- Signal intelligence admin: [client/src/pages/SignalIntelligenceAdmin.jsx](client/src/pages/SignalIntelligenceAdmin.jsx)

### 2.3 Navigation Exposure
- Desktop sidebar admin entry: [client/src/components/layout/Sidebar.tsx](client/src/components/layout/Sidebar.tsx)
- Mobile drawer admin entries: [client/src/components/layout/MobileDrawer.tsx](client/src/components/layout/MobileDrawer.tsx)

## 3. Route and Access Model
### 3.1 Frontend Route Registration
Admin routes are defined in [client/src/App.jsx](client/src/App.jsx) and are protected by both:
- RequireAdmin
- FeatureGateRoute with admin_panel feature for most admin routes

Key admin routes:
- /admin
- /admin-control
- /admin/features
- /admin/users
- /admin/diagnostics
- /admin/system-diagnostics
- /admin/system
- /admin/intelligence-monitor
- /admin/system-monitor
- /admin/learning-dashboard
- /admin/learning
- /admin/strategy-edge
- /admin/signals
- /admin/calibration
- /admin/missed-opportunities
- /admin/validation

### 3.2 Frontend Gate Components
- Admin auth gate: [client/src/components/auth/RequireAdmin.jsx](client/src/components/auth/RequireAdmin.jsx)
- Feature gate: [client/src/components/auth/FeatureGateRoute.jsx](client/src/components/auth/FeatureGateRoute.jsx)
- Auth token/session context: [client/src/context/AuthContext.jsx](client/src/context/AuthContext.jsx)
- Feature access context: [client/src/context/FeatureAccessContext.jsx](client/src/context/FeatureAccessContext.jsx)

### 3.3 Backend Route Mounting
Admin route modules are mounted in [server/index.js](server/index.js):
- adminRoutes
- adminValidationRoutes
- adminLearningRoutes
- adminFeatureAccessRoutes

Route modules:
- Core admin APIs: [server/routes/admin.js](server/routes/admin.js)
- Feature and role control APIs: [server/routes/adminFeatureAccess.js](server/routes/adminFeatureAccess.js)
- Validation analytics APIs: [server/routes/adminValidationRoutes.js](server/routes/adminValidationRoutes.js)
- Learning analytics APIs: [server/routes/adminLearningRoutes.js](server/routes/adminLearningRoutes.js)

### 3.4 Admin Authorization Middleware
- Admin enforcement logic: [server/middleware/requireAdminAccess.js](server/middleware/requireAdminAccess.js)

Supports:
- JWT-based admin role verification
- Fallback payload role check
- Optional x-api-key admin access mode using ADMIN_API_KEY or PROXY_API_KEY

## 4. Data and API Contract Mapping
### 4.1 Control Panel APIs
Frontend caller: [client/src/pages/AdminControlPanel.jsx](client/src/pages/AdminControlPanel.jsx)
Backend handlers: [server/routes/adminFeatureAccess.js](server/routes/adminFeatureAccess.js) and [server/routes/newsletter.js](server/routes/newsletter.js)

Used endpoints:
- GET /api/admin/features/users
- GET /api/admin/features/registry
- GET /api/admin/features/audit
- GET /api/admin/features/newsletter/summary
- GET /api/admin/features/user/:userId
- PATCH /api/admin/features/user/:userId/role
- PATCH /api/admin/features/user/:userId/feature
- POST /api/newsletter/send

### 4.2 System Diagnostics Page APIs
Frontend caller: [client/src/pages/Admin/SystemDiagnostics.jsx](client/src/pages/Admin/SystemDiagnostics.jsx)
Backend handlers in [server/index.js](server/index.js)

Used endpoints:
- GET /api/system/data-freshness
- GET /api/system/diagnostics
- GET /api/system/activity
- GET /api/system/strategies
- GET /api/system/opportunities

### 4.3 Learning and Strategy Edge APIs
Frontend callers:
- [client/src/pages/Admin/LearningDashboard.jsx](client/src/pages/Admin/LearningDashboard.jsx)
- [client/src/pages/Admin/StrategyEdgeDashboard.jsx](client/src/pages/Admin/StrategyEdgeDashboard.jsx)

Backend handlers:
- [server/routes/adminLearningRoutes.js](server/routes/adminLearningRoutes.js)

Used endpoints:
- GET /api/admin/learning/strategies
- GET /api/admin/learning/capture-rate
- GET /api/admin/learning/expected-move
- GET /api/admin/learning/regime

### 4.4 Calibration and Validation APIs
Frontend callers:
- [client/src/pages/Admin/CalibrationDashboard.jsx](client/src/pages/Admin/CalibrationDashboard.jsx)
- [client/src/pages/Admin/MissedOpportunitiesPage.jsx](client/src/pages/Admin/MissedOpportunitiesPage.jsx)

Backend handlers:
- [server/routes/adminValidationRoutes.js](server/routes/adminValidationRoutes.js)

Used endpoints:
- GET /api/admin/validation/daily
- GET /api/admin/validation/weekly
- GET /api/admin/validation/missed
- GET /api/admin/validation/learning-score
- GET /api/admin/validation/missed-candles
- GET /api/calibration/strategy-weights

### 4.5 System Monitor APIs
Frontend caller:
- [client/src/pages/Admin/SystemMonitorPage.jsx](client/src/pages/Admin/SystemMonitorPage.jsx)

Configured endpoint:
- GET /api/system/monitor

Backend route found:
- No matching /api/system/monitor route found in server route files scanned.
- Closest matching data source route exists as GET /api/admin/system in [server/routes/admin.js](server/routes/admin.js).

### 4.6 Signal Intelligence Admin APIs
Frontend caller:
- [client/src/pages/SignalIntelligenceAdmin.jsx](client/src/pages/SignalIntelligenceAdmin.jsx)

Uses:
- GET /api/opportunities/top
- GET /api/intelligence/order-flow
- GET /api/intelligence/early-accumulation
- GET /api/strategy/performance
- GET /api/newsletter/preview

## 5. Security and Access Assessment
Strengths:
- Admin routes protected by server-side middleware in route modules.
- Frontend includes RequireAdmin and feature-based gating.
- Feature registry and override model is explicit and auditable.
- Role and feature updates include actor context and audit trail endpoints.

Notable behavior:
- Admin API-key mode allows privileged access using x-api-key when configured.
- JWT role checks are still enforced when API key is absent.

Risks to monitor:
- API-key mode should be tightly controlled in production and rotated regularly.
- Verify proxy/public routes never leak admin-only handlers behind weak guards.

Relevant files:
- [server/middleware/requireAdminAccess.js](server/middleware/requireAdminAccess.js)
- [server/routes/adminFeatureAccess.js](server/routes/adminFeatureAccess.js)
- [server/config/features.js](server/config/features.js)

## 6. UX and Product Assessment
Strengths:
- Clear segmentation of admin concerns via tabbed and page-based structure.
- Good charting and tabular diagnostics density on system and learning pages.
- Polling intervals are present on key monitoring views.

Inconsistencies:
- Mixed styling systems across pages.
- Some pages use modern card/tailwind style, others use plain inline styles.
- AdminLayout prop usage is inconsistent: some pages pass section while component expects title.

Relevant files:
- [client/src/components/admin/AdminLayout.jsx](client/src/components/admin/AdminLayout.jsx)
- [client/src/pages/Admin/CalibrationDashboard.jsx](client/src/pages/Admin/CalibrationDashboard.jsx)
- [client/src/pages/AdminControlPanel.jsx](client/src/pages/AdminControlPanel.jsx)

## 7. Reliability and Operational Assessment
Strengths:
- Many backend admin queries use timeout bounds and safe fallback patterns.
- Core diagnostics endpoints return degraded payloads rather than hard crashing.
- Control panel bootstrapping handles missing tables gracefully in multiple places.

Weak spots:
- Endpoint mismatch for system monitor page likely causes persistent error state.
- Some frontend pages have one-shot load without periodic refresh where monitoring value is time-sensitive.
- API response shape handling differs by caller utility, increasing maintenance complexity.

Relevant files:
- [server/routes/admin.js](server/routes/admin.js)
- [server/routes/adminFeatureAccess.js](server/routes/adminFeatureAccess.js)
- [client/src/api/apiClient.js](client/src/api/apiClient.js)
- [client/src/utils/api.js](client/src/utils/api.js)

## 8. Critical Findings
1. System Monitor endpoint mismatch
- Frontend page requests /api/system/monitor in [client/src/pages/Admin/SystemMonitorPage.jsx](client/src/pages/Admin/SystemMonitorPage.jsx).
- No backend route for /api/system/monitor found in scanned server routes.
- Existing likely intended route is /api/admin/system in [server/routes/admin.js](server/routes/admin.js).
- Impact: System Monitor page may always show failure in production.

2. Case sensitivity portability risk
- Admin page imports in [client/src/App.jsx](client/src/App.jsx) use lowercase path segment pages/admin.
- Actual directory is [client/src/pages/Admin](client/src/pages/Admin).
- Impact: case-sensitive Linux build or deploy environments can fail module resolution.

3. Mixed admin page architecture and component contracts
- Pages alternate between [client/src/components/admin/AdminLayout.jsx](client/src/components/admin/AdminLayout.jsx) and the layout alias [client/src/components/layout/AdminLayout.jsx](client/src/components/layout/AdminLayout.jsx), and use inconsistent props.
- Impact: reduced maintainability, higher regression risk when evolving shared admin shell.

## 9. Medium-Priority Findings
1. API client pattern divergence
- Admin pages mix authFetchJSON and apiClient wrappers with different error and contract behavior in [client/src/utils/api.js](client/src/utils/api.js) and [client/src/api/apiClient.js](client/src/api/apiClient.js).
- Impact: hidden bugs when endpoint response contracts evolve.

2. Legacy visual and state management patterns
- Calibration and missed opportunities pages still rely on inline styles and minimal error states in:
  - [client/src/pages/Admin/CalibrationDashboard.jsx](client/src/pages/Admin/CalibrationDashboard.jsx)
  - [client/src/pages/Admin/MissedOpportunitiesPage.jsx](client/src/pages/Admin/MissedOpportunitiesPage.jsx)
- Impact: inconsistent operator experience and harder future extensibility.

## 10. Data Dependencies and Tables
Admin panel depends heavily on availability of these tables/views:
- users
- user_roles
- feature_access_audit
- newsletter_subscribers
- newsletter_send_history
- signal_validation_daily
- signal_validation_weekly
- missed_opportunities
- daily_ohlc
- strategy_learning_metrics
- signal_capture_analysis
- expected_move_tracking
- market_regime_daily
- engine_activity_last_hour
- strategy_performance_dashboard
- opportunity_stream
- strategy_signals

Primary query modules:
- [server/routes/adminFeatureAccess.js](server/routes/adminFeatureAccess.js)
- [server/routes/adminValidationRoutes.js](server/routes/adminValidationRoutes.js)
- [server/routes/adminLearningRoutes.js](server/routes/adminLearningRoutes.js)
- [server/index.js](server/index.js)

## 11. Recommended Improvement Plan
### Phase A: Correctness and Stability
1. Align system monitor endpoint contract.
2. Standardize path casing for admin imports in [client/src/App.jsx](client/src/App.jsx).
3. Add a lightweight admin API contract test suite covering all admin route responses.

### Phase B: UX and Platform Consistency
1. Normalize all admin pages onto one layout contract.
2. Unify API callers to one consistent admin fetch layer.
3. Migrate legacy inline-styled pages to shared design primitives.

### Phase C: Operability and Governance
1. Add explicit operator-facing status for data-source staleness on all admin pages.
2. Add server-side audit entries for all sensitive admin actions if not already covered.
3. Add periodic synthetic checks for top admin endpoints and include in deploy smoke tests.

## 12. Overall Grade
- Security and Access Control: A-
- Diagnostics and Visibility: B+
- Consistency and Maintainability: B-
- Runtime Reliability of Admin UX: B
- Deployment Portability: C+ (due to path-case risk)

Overall Admin Control Panel Grade: B

This panel is production-capable and feature-rich, with strong foundations. Addressing the endpoint mismatch and path-case portability issues should be prioritized first, followed by unifying admin page architecture for long-term stability.