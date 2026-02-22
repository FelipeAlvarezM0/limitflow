CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  window_seconds INTEGER NOT NULL,
  burst INTEGER,
  refill_rate_per_second DOUBLE PRECISION,
  key_scope TEXT NOT NULL,
  mode TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_tenant_resource
ON policies(tenant_id, resource);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  key_value TEXT NOT NULL,
  resource TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  remaining INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
