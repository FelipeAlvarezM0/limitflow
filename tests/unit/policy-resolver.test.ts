import { describe, expect, it } from "vitest";
import type { Policy } from "@quotaguard/shared";
import { MetricsService } from "../../apps/api/src/services/metrics.js";
import { PolicyResolver } from "../../apps/api/src/services/policy-resolver.js";

const basePolicy: Policy = {
  id: "policy-default",
  tenantId: "acme",
  resource: "*",
  algorithm: "fixed_window",
  limit: 60,
  windowSeconds: 60,
  keyScope: "user",
  mode: "enforce",
  updatedAt: new Date().toISOString()
};

describe("PolicyResolver", () => {
  it("prefers exact resource over wildcard and caches results", async () => {
    let calls = 0;
    const store = {
      async listPolicies(): Promise<Policy[]> {
        calls += 1;
        return [
          basePolicy,
          {
            ...basePolicy,
            id: "policy-payments",
            resource: "POST:/payments",
            limit: 5
          }
        ];
      }
    };

    const metrics = new MetricsService();
    const resolver = new PolicyResolver(store as never, 10_000, metrics);

    const first = await resolver.resolvePolicy("acme", "POST:/payments");
    const second = await resolver.resolvePolicy("acme", "POST:/payments");

    expect(first?.id).toBe("policy-payments");
    expect(second?.id).toBe("policy-payments");
    expect(calls).toBe(1);
  });

  it("falls back to wildcard resource", async () => {
    const store = {
      async listPolicies(): Promise<Policy[]> {
        return [basePolicy];
      }
    };

    const resolver = new PolicyResolver(store as never, 10_000, new MetricsService());
    const result = await resolver.resolvePolicy("acme", "GET:/orders");

    expect(result?.id).toBe("policy-default");
  });
});
