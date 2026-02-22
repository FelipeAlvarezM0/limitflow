import type { AlgorithmContext, AlgorithmResult } from "@quotaguard/shared";
import type { AlgorithmDeps, RateLimitAlgorithm } from "./types.js";

export class FixedWindowAlgorithm implements RateLimitAlgorithm {
  readonly type = "fixed_window" as const;

  constructor(private readonly deps: AlgorithmDeps) {}

  async evaluate(context: AlgorithmContext): Promise<AlgorithmResult> {
    const key = `quotaguard:fw:${context.policy.id}:${context.tenantId}:${context.resource}:${context.key}`;
    const result = await this.deps.scripts.evalScript(
      "fixed_window",
      [key],
      [context.policy.limit, context.policy.windowSeconds, context.cost]
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
