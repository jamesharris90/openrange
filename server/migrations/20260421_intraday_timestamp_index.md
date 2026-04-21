# Migration: Add timestamp index to intraday_1m

Applied: 2026-04-21
Purpose: Support the data trust queries that measure 10m and 24h coverage without hitting the 10s statement_timeout.

SQL applied manually via production DB:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_intraday_1m_timestamp_desc ON intraday_1m(timestamp DESC);