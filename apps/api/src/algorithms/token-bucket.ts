import type { AlgorithmContext, AlgorithmResult } from "@quotaguard/shared";
import type { AlgorithmDeps, RateLimitAlgorithm } from "./types.js";

export class TokenBucketAlgorithm implements RateLimitAlgorithm {
  readonly type = "token_bucket" as const;

  constructor(private readonly deps: AlgorithmDeps) {}

  async evaluate(context: AlgorithmContext): Promise<AlgorithmResult> {
    const key = `quotaguard:tb:${context.policy.id}:${context.tenantId}:${context.resource}:${context.key}`;
    const capacity = context.policy.burst ?? context.policy.limit;
    const refillPerSecond = context.policy.refillRatePerSecond ?? context.policy.limit / context.policy.windowSeconds;
    const refillPerMs = Math.max(refillPerSecond / 1000, 0.000001);
    const ttlSeconds = Math.max(context.policy.windowSeconds * 2, 60);

    const result = await this.deps.scripts.evalScript(
      "token_bucket",
      [key],
      [capacity, refillPerMs, context.cost, context.nowMs, ttlSeconds]
    );

    return {
      allowed: result[0] === 1,
      limit: result[1],
      remaining: result[2],
      resetSeconds: result[3],
      retryAfterSeconds: result[4]
    };
  }
}
