import type { CheckRequest, Policy, RateLimitDecision } from "@quotaguard/shared";
import type { FastifyBaseLogger } from "fastify";
import { AlgorithmRegistry } from "../algorithms/registry.js";
import type { MetricsService } from "./metrics.js";
import type { PolicyResolver } from "./policy-resolver.js";
import type { PolicyStore } from "./policy-store.js";

export class RateLimiterService {
  constructor(
    private readonly policyStore: PolicyStore,
    private readonly policyResolver: PolicyResolver,
    private readonly algorithms: AlgorithmRegistry,
    private readonly metrics: MetricsService,
    private readonly logger: FastifyBaseLogger
  ) {}

  async check(input: CheckRequest, correlationId?: string): Promise<RateLimitDecision> {
    const tenant = await this.policyStore.getTenant(input.tenantId);
    if (!tenant) {
      throw new Error(`Tenant not found: ${input.tenantId}`);
    }

    const policy = await this.policyResolver.resolvePolicy(input.tenantId, input.resource);
    if (!policy) {
      throw new Error(`Policy not found for tenant=${input.tenantId} resource=${input.resource}`);
    }

    return this.evaluateWithPolicy(input, policy, correlationId);
  }

  async evaluateWithPolicy(input: CheckRequest, policy: Policy, correlationId?: string): Promise<RateLimitDecision> {
    const start = process.hrtime.bigint();
    const algorithm = this.algorithms.get(policy.algorithm);

    let decision: RateLimitDecision;
    try {
      const scopedKey = `${policy.keyScope}:${input.key}`;
      const result = await algorithm.evaluate({
        policy,
        tenantId: input.tenantId,
        key: scopedKey,
        resource: input.resource,
        cost: input.cost ?? 1,
        nowMs: Date.now()
      });

      const allowed = policy.mode === "shadow" ? true : result.allowed;
      const retryAfterSeconds = policy.mode === "shadow" ? 0 : result.retryAfterSeconds;

      decision = {
        allowed,
        limit: result.limit,
        remaining: result.remaining,
        resetSeconds: result.resetSeconds,
        retryAfterSeconds,
        policyId: policy.id,
        mode: policy.mode,
        algorithm: policy.algorithm
      };
    } catch (error) {
      this.metrics.redisLuaErrorsTotal.inc({ algorithm: policy.algorithm });
      throw error;
    }

    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    this.metrics.checksTotal.inc({
      tenant_id: input.tenantId,
      resource: input.resource,
      policy_id: decision.policyId,
      mode: decision.mode
    });

    this.metrics.latencyMs.observe(
      {
        tenant_id: input.tenantId,
        resource: input.resource,
        policy_id: decision.policyId,
        mode: decision.mode
      },
      elapsedMs
    );

    if (!decision.allowed && decision.mode === "enforce") {
      this.metrics.blockedTotal.inc({
        tenant_id: input.tenantId,
        resource: input.resource,
        policy_id: decision.policyId,
        mode: decision.mode
      });
    }

    this.logger.info(
      {
        correlationId,
        tenantId: input.tenantId,
        key: input.key,
        resource: input.resource,
        allowed: decision.allowed,
        policyId: decision.policyId,
        mode: decision.mode,
        latencyMs: elapsedMs
      },
      "Rate limit decision"
    );

    return decision;
  }
}
