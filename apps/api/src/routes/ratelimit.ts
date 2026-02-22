import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { CheckRequest } from "@quotaguard/shared";
import { annotateDecision, withSpan } from "../telemetry/tracing.js";
import type { RateLimiterService } from "../services/rate-limiter.js";

const checkSchema = z.object({
  tenantId: z.string().min(1),
  key: z.string().min(1),
  resource: z.string().min(1),
  cost: z.coerce.number().int().positive().default(1)
});

function setRateLimitHeaders(reply: { header: (name: string, value: string | number) => void }, decision: {
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
}): void {
  reply.header("X-RateLimit-Limit", decision.limit);
  reply.header("X-RateLimit-Remaining", decision.remaining);
  reply.header("X-RateLimit-Reset", decision.resetSeconds);

  if (decision.retryAfterSeconds > 0) {
    reply.header("Retry-After", decision.retryAfterSeconds);
  }
}

export async function registerRateLimitRoutes(
  fastify: FastifyInstance,
  rateLimiter: RateLimiterService
): Promise<void> {
  fastify.post("/v1/ratelimit/check", async (request, reply) => {
    const parsed = checkSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        error: "validation_error",
        details: parsed.error.flatten()
      };
    }

    const input: CheckRequest = parsed.data;

    try {
      const decision = await withSpan(
        "ratelimit.check",
        {
          "ratelimit.tenant_id": input.tenantId,
          "ratelimit.resource": input.resource,
          "ratelimit.key": input.key,
          "ratelimit.cost": input.cost ?? 1
        },
        async () => rateLimiter.check(input, request.correlationId)
      );

      annotateDecision(decision);
      setRateLimitHeaders(reply, decision);

      if (!decision.allowed && decision.mode === "enforce") {
        reply.status(429);
      }

      return {
        allowed: decision.allowed,
        limit: decision.limit,
        remaining: decision.remaining,
        resetSeconds: decision.resetSeconds,
        retryAfterSeconds: decision.retryAfterSeconds,
        policyId: decision.policyId,
        mode: decision.mode
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      request.log.error({ err: error }, "Rate limit check failed");
      if (message.includes("not found")) {
        reply.status(404);
        return { error: message };
      }

      reply.status(500);
      return { error: "internal_error" };
    }
  });
}
