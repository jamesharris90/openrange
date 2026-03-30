-- Migration 043: Admin roles + system event log

-- Role-based access control table
CREATE TABLE IF NOT EXISTS admin_roles (
  user_id    INT  NOT NULL,
  role       TEXT NOT NULL DEFAULT 'USER',
  granted_at TIMESTAMPTZ  DEFAULT NOW(),
  PRIMARY KEY (user_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_role ON admin_roles (role);

-- System event log for the admin log viewer
CREATE TABLE IF NOT EXISTS system_logs (
  id          BIGSERIAL PRIMARY KEY,
  label       TEXT,
  level       TEXT NOT NULL DEFAULT 'INFO',   -- INFO / WARN / ERROR / CRITICAL
  message     TEXT NOT NULL,
  engine      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_created  ON system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_level    ON system_logs (level);
CREATE INDEX IF NOT EXISTS idx_system_logs_engine   ON system_logs (engine);
