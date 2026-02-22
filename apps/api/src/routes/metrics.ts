import type { FastifyInstance } from "fastify";
import type { MetricsService } from "../services/metrics.js";

export async function registerMetricsRoutes(fastify: FastifyInstance, metrics: MetricsService): Promise<void> {
  fastify.get("/metrics", async (_request, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return metrics.getMetricsText();
  });
}
