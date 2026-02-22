import type { FastifyInstance } from "fastify";
import type { PolicyStore } from "../services/policy-store.js";
import type { Redis } from "ioredis";

interface HealthDeps {
  redis: Redis;
  policyStore: PolicyStore;
}

export async function registerHealthRoutes(fastify: FastifyInstance, deps: HealthDeps): Promise<void> {
  fastify.get("/health", async () => ({ status: "ok", service: "quotaguard" }));

  fastify.get("/ready", async (_request, reply) => {
    const [redisOk, dbOk] = await Promise.all([
      deps.redis
        .ping()
        .then((res: string) => res === "PONG")
        .catch(() => false),
      deps.policyStore.healthcheck()
    ]);

    const ready = redisOk && dbOk;
    if (!ready) {
      reply.status(503);
    }

    return {
      status: ready ? "ready" : "degraded",
      checks: {
        redis: redisOk,
        db: dbOk
      }
    };
  });
}

