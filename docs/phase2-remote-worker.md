# Phase 2 Remote Worker

This repo now supports a dedicated always-on Phase 2 worker service for Railway.

## Service Roles

- `OPENRANGE_SERVICE_ROLE=backend`
  - Runs the Express API.
- `OPENRANGE_SERVICE_ROLE=coverage-worker`
  - Runs the coverage campaign loop.
- `OPENRANGE_SERVICE_ROLE=phase2-worker`
  - Runs the Phase 2 historical backfill from a DB-backed checkpoint and then remains alive for nightly backtests.

## Phase 2 Worker Command

The worker is launched through the existing Railway start shim:

```bash
npm run start:railway
```

with:

```bash
OPENRANGE_SERVICE_ROLE=phase2-worker
```

## Phase 2 Worker Environment

- `PHASE2_ENABLE_NIGHTLY=true|false`
  - Defaults to `true`.
- `PHASE2_NIGHTLY_CRON="15 6 * * 1-5"`
  - Defaults to weekdays at `06:15` in the configured timezone.
- `PHASE2_NIGHTLY_TIMEZONE="UTC"`
  - Defaults to `UTC`.
- `PHASE2_WORKER_HEARTBEAT_MS=30000`
  - Controls how often worker liveness is written to Postgres.
- `PHASE2_WORKER_PROGRESS_EVENT_EVERY=100`
  - Controls how often progress events are appended to the monitor feed.
- `PHASE2_RESET_STATE=true|false`
  - Clears DB-backed status/checkpoint/events on startup.
- `PHASE2_RESET_CHECKPOINT=true|false`
  - Clears only the DB-backed checkpoint before the historical pass.
- `PHASE2_STRATEGY_IDS=id1,id2`
  - Optional strategy filter.
- `PHASE2_SYMBOLS=AAPL,MSFT`
  - Optional symbol filter.

## Persistence Model

The remote Phase 2 worker writes monitor state to Postgres table `phase2_backfill_state` using keys:

- `status`
- `checkpoint`
- `events`

This makes the coverage page and Phase 2 page independent of the worker container filesystem and resilient across worker restarts.

## Deployment Pattern

Create a separate Railway service for the Phase 2 worker with the same repo and env as the backend service, then set:

```bash
OPENRANGE_SERVICE_ROLE=phase2-worker
```

The worker will:

1. Resume historical backfill from the DB-backed checkpoint.
2. Keep reporting liveness and progress into Postgres.
3. Stay alive after completion.
4. Run nightly incremental backtests on the configured cron schedule.