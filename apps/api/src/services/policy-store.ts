import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { Pool } from "pg";
import type { PlanName, Policy, PolicyMode, Tenant } from "@quotaguard/shared";

export interface PolicyStore {
  init(): Promise<void>;
  close(): Promise<void>;
  healthcheck(): Promise<boolean>;
  upsertTenant(input: { id: string; name: string; plan: PlanName }): Promise<Tenant>;
  getTenant(tenantId: string): Promise<Tenant | null>;
  upsertPolicy(policy: Policy): Promise<Policy>;
  listPolicies(tenantId: string): Promise<Policy[]>;
}

const nowIso = () => new Date().toISOString();

export function buildDefaultPolicy(tenantId: string, plan: PlanName, mode: PolicyMode): Policy {
  const timestamp = nowIso();
  if (plan === "free") {
    return {
      id: `${tenantId}-free-default`,
      tenantId,
      resource: "*",
      algorithm: "fixed_window",
      limit: 60,
      windowSeconds: 60,
      keyScope: "user",
      mode,
      updatedAt: timestamp
    };
  }

  if (plan === "pro") {
    return {
      id: `${tenantId}-pro-default`,
      tenantId,
      resource: "*",
      algorithm: "fixed_window",
      limit: 600,
      windowSeconds: 60,
      keyScope: "user",
      mode,
      updatedAt: timestamp
    };
  }

  return {
    id: `${tenantId}-enterprise-default`,
    tenantId,
    resource: "*",
    algorithm: "token_bucket",
    limit: 6000,
    windowSeconds: 60,
    burst: 1200,
    refillRatePerSecond: 100,
    keyScope: "user",
    mode,
    updatedAt: timestamp
  };
}

export class InMemoryPolicyStore implements PolicyStore {
  private readonly tenants = new Map<string, Tenant>();
  private readonly policiesByTenant = new Map<string, Map<string, Policy>>();

  constructor(private readonly defaultMode: PolicyMode) {}

  async init(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    return;
  }

  async healthcheck(): Promise<boolean> {
    return true;
  }

  async upsertTenant(input: { id: string; name: string; plan: PlanName }): Promise<Tenant> {
    const tenant: Tenant = {
      id: input.id,
      name: input.name,
      plan: input.plan,
      createdAt: this.tenants.get(input.id)?.createdAt ?? nowIso()
    };
    this.tenants.set(input.id, tenant);

    const existingPolicies = this.policiesByTenant.get(input.id) ?? new Map<string, Policy>();
    if (existingPolicies.size === 0) {
      const defaultPolicy = buildDefaultPolicy(input.id, input.plan, this.defaultMode);
      existingPolicies.set(defaultPolicy.id, defaultPolicy);
    }
    this.policiesByTenant.set(input.id, existingPolicies);

    return tenant;
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    return this.tenants.get(tenantId) ?? null;
  }

  async upsertPolicy(policy: Policy): Promise<Policy> {
    const tenantPolicies = this.policiesByTenant.get(policy.tenantId) ?? new Map<string, Policy>();
    const nextPolicy: Policy = {
      ...policy,
      id: policy.id || randomUUID(),
      updatedAt: nowIso()
    };
    tenantPolicies.set(nextPolicy.id, nextPolicy);
    this.policiesByTenant.set(policy.tenantId, tenantPolicies);
    return nextPolicy;
  }

  async listPolicies(tenantId: string): Promise<Policy[]> {
    const policies = this.policiesByTenant.get(tenantId);
    if (!policies) {
      return [];
    }
    return [...policies.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export class PostgresPolicyStore implements PolicyStore {
  private readonly pool: Pool;

  constructor(
    databaseUrl: string,
    private readonly defaultMode: PolicyMode,
    private readonly logger: FastifyBaseLogger
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        plan TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await this.pool.query(`
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
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_policies_tenant_resource
      ON policies(tenant_id, resource);
    `);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch (error) {
      this.logger.error({ err: error }, "Postgres healthcheck failed");
      return false;
    }
  }

  async upsertTenant(input: { id: string; name: string; plan: PlanName }): Promise<Tenant> {
    const query = `
      INSERT INTO tenants (id, name, plan)
      VALUES ($1, $2, $3)
      ON CONFLICT (id)
      DO UPDATE SET name = EXCLUDED.name, plan = EXCLUDED.plan
      RETURNING id, name, plan, created_at;
    `;

    const result = await this.pool.query(query, [input.id, input.name, input.plan]);
    const row = result.rows[0];
    const tenant: Tenant = {
      id: row.id,
      name: row.name,
      plan: row.plan,
      createdAt: new Date(row.created_at).toISOString()
    };

    const existingPolicies = await this.listPolicies(input.id);
    if (existingPolicies.length === 0) {
      await this.upsertPolicy(buildDefaultPolicy(input.id, input.plan, this.defaultMode));
    }

    return tenant;
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      "SELECT id, name, plan, created_at FROM tenants WHERE id = $1 LIMIT 1",
      [tenantId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      plan: row.plan,
      createdAt: new Date(row.created_at).toISOString()
    };
  }

  async upsertPolicy(policy: Policy): Promise<Policy> {
    const nextPolicy: Policy = {
      ...policy,
      id: policy.id || randomUUID(),
      updatedAt: nowIso()
    };

    const query = `
      INSERT INTO policies (
        id,
        tenant_id,
        resource,
        algorithm,
        limit_value,
        window_seconds,
        burst,
        refill_rate_per_second,
        key_scope,
        mode,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        resource = EXCLUDED.resource,
        algorithm = EXCLUDED.algorithm,
        limit_value = EXCLUDED.limit_value,
        window_seconds = EXCLUDED.window_seconds,
        burst = EXCLUDED.burst,
        refill_rate_per_second = EXCLUDED.refill_rate_per_second,
        key_scope = EXCLUDED.key_scope,
        mode = EXCLUDED.mode,
        updated_at = NOW()
      RETURNING updated_at;
    `;

    const result = await this.pool.query(query, [
      nextPolicy.id,
      nextPolicy.tenantId,
      nextPolicy.resource,
      nextPolicy.algorithm,
      nextPolicy.limit,
      nextPolicy.windowSeconds,
      nextPolicy.burst ?? null,
      nextPolicy.refillRatePerSecond ?? null,
      nextPolicy.keyScope,
      nextPolicy.mode
    ]);

    nextPolicy.updatedAt = new Date(result.rows[0].updated_at).toISOString();
    return nextPolicy;
  }

  async listPolicies(tenantId: string): Promise<Policy[]> {
    const query = `
      SELECT
        id,
        tenant_id,
        resource,
        algorithm,
        limit_value,
        window_seconds,
        burst,
        refill_rate_per_second,
        key_scope,
        mode,
        updated_at
      FROM policies
      WHERE tenant_id = $1
      ORDER BY updated_at DESC;
    `;

    const result = await this.pool.query(query, [tenantId]);
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      resource: row.resource,
      algorithm: row.algorithm,
      limit: row.limit_value,
      windowSeconds: row.window_seconds,
      burst: row.burst ?? undefined,
      refillRatePerSecond: row.refill_rate_per_second ?? undefined,
      keyScope: row.key_scope,
      mode: row.mode,
      updatedAt: new Date(row.updated_at).toISOString()
    } satisfies Policy));
  }
}
