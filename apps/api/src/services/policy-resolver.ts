import type { Policy } from "@quotaguard/shared";
import type { MetricsService } from "./metrics.js";
import type { PolicyStore } from "./policy-store.js";

interface CachedPolicy {
  policy: Policy;
  expiresAt: number;
}

export class PolicyResolver {
  private readonly cache = new Map<string, CachedPolicy>();

  constructor(
    private readonly store: PolicyStore,
    private readonly ttlMs: number,
    private readonly metrics: MetricsService
  ) {}

  invalidateTenant(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  async resolvePolicy(tenantId: string, resource: string): Promise<Policy | null> {
    const cacheKey = `${tenantId}:${resource}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      this.metrics.policyCacheHitsTotal.inc({ tenant_id: tenantId });
      return cached.policy;
    }

    this.metrics.policyCacheMissesTotal.inc({ tenant_id: tenantId });
    const policies = await this.store.listPolicies(tenantId);
    if (policies.length === 0) {
      return null;
    }

    const exact = policies.find((policy) => policy.resource === resource);
    const wildcard = policies.find((policy) => policy.resource === "*");
    const selected = exact ?? wildcard ?? null;

    if (selected) {
      this.cache.set(cacheKey, {
        policy: selected,
        expiresAt: now + this.ttlMs
      });
    }

    return selected;
  }
}
