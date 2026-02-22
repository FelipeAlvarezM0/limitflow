import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Policy } from "@quotaguard/shared";
import { TokenBucketAlgorithm } from "../../apps/api/src/algorithms/token-bucket.js";
import { RedisScriptManager } from "../../apps/api/src/redis/scripts.js";

const runIntegration = process.env.RUN_INTEGRATION === "1";

describe.runIf(runIntegration)("TokenBucketAlgorithm (Lua)", () => {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new Redis(redisUrl);
  const scripts = new RedisScriptManager(redis);
  const algorithm = new TokenBucketAlgorithm({ scripts });

  beforeAll(async () => {
    await redis.ping();
    await scripts.loadScripts();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("allows bursts and recovers over time", async () => {
    const policy: Policy = {
      id: `tb-${randomUUID()}`,
      tenantId: "acme",
      resource: "POST:/payments",
      algorithm: "token_bucket",
      limit: 60,
      windowSeconds: 60,
      burst: 2,
      refillRatePerSecond: 1,
      keyScope: "user",
      mode: "enforce",
      updatedAt: new Date().toISOString()
    };

    const shared = {
      policy,
      tenantId: "acme",
      key: `user-${randomUUID()}`,
      resource: "POST:/payments",
      cost: 1
    };

    const now = Date.now();
    const first = await algorithm.evaluate({ ...shared, nowMs: now });
    const second = await algorithm.evaluate({ ...shared, nowMs: now + 10 });
    const third = await algorithm.evaluate({ ...shared, nowMs: now + 20 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    const recovered = await algorithm.evaluate({ ...shared, nowMs: now + 1400 });
    expect(recovered.allowed).toBe(true);
  });
});
