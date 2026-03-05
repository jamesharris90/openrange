# OpenRange Alert Engine Report

Date: 2026-03-05
Scope: Alert infrastructure only (no ingestion/metrics/strategy/catalyst engine modifications)

## Summary
Implemented backend alert infrastructure that reuses screener query-tree logic and supports scheduled alert checks, history tracking, and user-level alert management APIs.

## Delivered Components

### 1) Database Migrations
- Added `server/migrations/create_user_alerts.sql` with table:
  - `alert_id` (UUID PK)
  - `user_id`
  - `alert_name`
  - `query_tree` (JSONB)
  - `message_template`
  - `frequency`
  - `enabled`
  - `created_at`
  - `last_triggered`
- Added `server/migrations/create_alert_history.sql` with table:
  - `alert_id`
  - `symbol`
  - `triggered_at`
  - `message`

### 2) Alert Engine
- Added `server/alerts/alert_engine.js`.
- Responsibilities implemented:
  - Load active alerts.
  - Execute query trees against market data with AND/OR/NOT support.
  - Translate query tree fields to backend SQL expressions.
  - Detect newly matching symbols with cooldown suppression.
  - Trigger notifications and persist alert history.

### 3) Scheduler
- Added `server/alerts/alert_scheduler.js`.
- Runs alert cycle every 60 seconds.
- Wired into server startup behind env flag:
  - `ENABLE_ALERT_SCHEDULER !== 'false'`

### 4) Notification Service
- Added `server/alerts/notification_service.js`.
- Phase 1 channels:
  - In-platform: writes alert events into `alert_history`.
  - Email: stub/logging path with SMTP detection for future activation.

### 5) Alert API Endpoints
- Added `server/routes/alerts.js` and mounted in `server/index.js`.
- Endpoints:
  - `GET /api/alerts`
  - `POST /api/alerts/create`
  - `POST /api/alerts/disable`
  - `GET /api/alerts/history`
- Endpoints are mounted after auth middleware, requiring authenticated user context.

### 6) Trigger Logic
- Alert triggers when new symbol appears in current query results.
- Cooldown behavior enforced using `frequency` and recent `alert_history` rows.
- Duplicate symbol triggers within cooldown window are suppressed.

### 7) Screener Integration
- Updated `client/src/pages/InstitutionalScreener.jsx` save workflow:
  - Added `enable_alert` flag to saved filter payload.
  - Added "Create Alert" toggle in Save Filter controls.
  - When enabled, save flow calls `POST /api/alerts/create` with existing `query_tree`.

## Files Added
- `server/migrations/create_user_alerts.sql`
- `server/migrations/create_alert_history.sql`
- `server/alerts/alert_engine.js`
- `server/alerts/alert_scheduler.js`
- `server/alerts/notification_service.js`
- `server/routes/alerts.js`
- `ALERT_ENGINE_REPORT.md`

## Files Updated
- `server/index.js`
- `client/src/pages/InstitutionalScreener.jsx`

## Constraints Compliance
- No modifications were made to ingestion workers, metrics engine, strategy engine, or catalyst engine.
- Alert logic reuses screener query-tree architecture (`query_tree` JSON-based filtering model).

## Alert Dashboard UI

Implemented a dedicated Alerts Command Center frontend at `/alerts` with a two-column management layout and screener-aligned card styling.

### Delivered UI Components
- `client/src/pages/AlertsPage.jsx`
  - Top summary bar + two-column body layout.
  - Left: active alerts management cards.
  - Right: triggered alerts timeline/history.
- `client/src/components/alerts/AlertsSummary.jsx`
  - Displays: Active Alerts, Triggered Today, Total Alerts, Last Trigger Time.
  - Data source: `/api/alerts` and `/api/alerts/history`.
- `client/src/components/alerts/AlertsList.jsx`
  - Card view with: Alert Name, Query Summary, Frequency, Enabled toggle.
  - Actions: Edit, Disable, Delete, Test Alert.
  - Visual state: left border green when enabled, gray when disabled.
- `client/src/components/alerts/AlertHistory.jsx`
  - Timeline format with: Ticker, Alert Name, Triggered Time, Message.
  - Actions: Open Chart, View Screener.
- `client/src/components/alerts/EditAlertModal.jsx`
  - Editable fields: Alert Name, Frequency, Enabled status, Message template.
  - Query tree is preserved unchanged.

### API Interaction Behavior
- Enabled toggle:
  - Disable path: `POST /api/alerts/disable`
  - Enable path: `POST /api/alerts/create` (recreates enabled alert from existing query tree)
- Test alert action:
  - Calls `POST /api/alerts/test`
  - If unavailable, UI still presents a simulated alert notification.

### Navigation Updates
- Added Alerts route in `client/src/App.jsx`:
  - `/alerts` → `AlertsPage`
- Updated sidebar workflows to include Alerts:
  - Dashboard, Scanner, Alerts, Research

