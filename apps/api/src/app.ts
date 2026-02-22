import { randomUUID } from "node:crypto";
import fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import type { AppConfig } from "@quotaguard/shared";
import { createLogger } from "@quotaguard/shared";
import { AlgorithmRegistry } from "./algorithms/registry.js";
import { FixedWindowAlgorithm } from "./algorithms/fixed-window.js";
import { SlidingWindowAlgorithm } from "./algorithms/sliding-window.js";
import { TokenBucketAlgorithm } from "./algorithms/token-bucket.js";
import { createRedisClient } from "./redis/client.js";
import { RedisScriptManager } from "./redis/scripts.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerRateLimitRoutes } from "./routes/ratelimit.js";
import { MetricsService } from "./services/metrics.js";
import { PolicyResolver } from "./services/policy-resolver.js";
import { InMemoryPolicyStore, PostgresPolicyStore } from "./services/policy-store.js";
import { RateLimiterService } from "./services/rate-limiter.js";

export async function buildApp(config: AppConfig) {
  const logger = createLogger(config.LOG_LEVEL);
  const app = fastify({ logger });

  await app.register(helmet);
  await app.register(cors, { origin: true });
  await app.register(sensible);

  app.decorateRequest("correlationId", "");
  app.addHook("onRequest", async (request, reply) => {
    const headerValue = request.headers["x-correlation-id"];
    const correlationId = typeof headerValue === "string" && headerValue.length > 0 ? headerValue : randomUUID();
    request.correlationId = correlationId;
    reply.header("x-correlation-id", correlationId);
  });

  const redis = createRedisClient(config.REDIS_URL, app.log);
  const scripts = new RedisScriptManager(redis);
  await scripts.loadScripts();

  const policyStore = config.ENABLE_PG && config.DATABASE_URL
    ? new PostgresPolicyStore(config.DATABASE_URL, config.DEFAULT_MODE, app.log)
    : new InMemoryPolicyStore(config.DEFAULT_MODE);

  await policyStore.init();
  await policyStore.upsertTenant({
    id: "acme",
    name: "Acme Inc.",
    plan: "pro"
  });

  const metrics = new MetricsService();
  const policyResolver = new PolicyResolver(policyStore, config.POLICY_CACHE_TTL_MS, metrics);

  const algorithms = new AlgorithmRegistry();
  algorithms.register(new FixedWindowAlgorithm({ scripts }));
  algorithms.register(new SlidingWindowAlgorithm({ scripts }));
  algorithms.register(new TokenBucketAlgorithm({ scripts }));

  const rateLimiter = new RateLimiterService(policyStore, policyResolver, algorithms, metrics, app.log);

  await registerHealthRoutes(app, { redis, policyStore });
  await registerRateLimitRoutes(app, rateLimiter);
  await registerAdminRoutes(app, {
    token: config.ADMIN_TOKEN,
    policyStore,
    policyResolver,
    rateLimiter
  });
  await registerMetricsRoutes(app, metrics);

  return {
    app,
    close: async () => {
      await app.close();
      await Promise.all([redis.quit(), policyStore.close()]);
    }
  };
}
