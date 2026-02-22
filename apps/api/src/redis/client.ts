import type { FastifyBaseLogger } from "fastify";
import { Redis } from "ioredis";

export function createRedisClient(url: string, logger: FastifyBaseLogger): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableAutoPipelining: true,
    lazyConnect: false
  });

  redis.on("error", (error: unknown) => {
    logger.error({ err: error }, "Redis client error");
  });

  return redis;
}
