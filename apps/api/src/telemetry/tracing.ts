import { trace } from "@opentelemetry/api";
import type { RateLimitDecision } from "@quotaguard/shared";

const tracer = trace.getTracer("quotaguard-api");

export async function withSpan<T>(name: string, attributes: Record<string, string | number | boolean>, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }
      const result = await fn();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function annotateDecision(decision: RateLimitDecision): void {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }

  span.setAttributes({
    "ratelimit.allowed": decision.allowed,
    "ratelimit.limit": decision.limit,
    "ratelimit.remaining": decision.remaining,
    "ratelimit.reset_seconds": decision.resetSeconds,
    "ratelimit.retry_after_seconds": decision.retryAfterSeconds,
    "ratelimit.policy_id": decision.policyId,
    "ratelimit.mode": decision.mode,
    "ratelimit.algorithm": decision.algorithm
  });
}
