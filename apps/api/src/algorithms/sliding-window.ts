import { randomUUID } from "node:crypto";
import type { AlgorithmContext, AlgorithmResult } from "@quotaguard/shared";
import type { AlgorithmDeps, RateLimitAlgorithm } from "./types.js";

export class SlidingWindowAlgorithm implements RateLimitAlgorithm {
  readonly type = "sliding_window" as const;

  constructor(private readonly deps: AlgorithmDeps) {}

  async evaluate(context: AlgorithmContext): Promise<AlgorithmResult> {
    const baseKey = `quotaguard:sw:${context.policy.id}:${context.tenantId}:${context.resource}:${context.key}`;
    const zsetKey = `${baseKey}:events`;
    const seqKey = `${baseKey}:seq`;
    const windowMs = context.policy.windowSeconds * 1000;

    const result = await this.deps.scripts.evalScript(
      "sliding_window",
      [zsetKey, seqKey],
      [context.nowMs, windowMs, context.policy.limit, context.cost, randomUUID()]
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
