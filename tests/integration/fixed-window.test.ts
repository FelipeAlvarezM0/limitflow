import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Policy } from "@quotaguard/shared";
import { FixedWindowAlgorithm } from "../../apps/api/src/algorithms/fixed-window.js";
import { RedisScriptManager } from "../../apps/api/src/redis/scripts.js";

const runIntegration = process.env.RUN_INTEGRATION === "1";

describe.runIf(runIntegration)("FixedWindowAlgorithm (Lua)", () => {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new Redis(redisUrl);
  const scripts = new RedisScriptManager(redis);
  const algorithm = new FixedWindowAlgorithm({ scripts });

  beforeAll(async () => {
    await redis.ping();
    await scripts.loadScripts();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("blocks after exceeding limit in same window", async () => {
    const policy: Policy = {
      id: `fw-${randomUUID()}`,
      tenantId: "acme",
      resource: "POST:/payments",
      algorithm: "fixed_window",
      limit: 3,
      windowSeconds: 5,
      keyScope: "user",
      mode: "enforce",
      updatedAt: new Date().toISOString()
    };

    const contextBase = {
      policy,
      tenantId: "acme",
      key: `user-${randomUUID()}`,
      resource: "POST:/payments",
      cost: 1,
      nowMs: Date.now()
    };

    const first = await algorithm.evaluate(contextBase);
    const second = await algorithm.evaluate(contextBase);
    const third = await algorithm.evaluate(contextBase);
    const fourth = await algorithm.evaluate(contextBase);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
