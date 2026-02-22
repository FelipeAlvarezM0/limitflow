import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CheckRequest, Policy } from "@quotaguard/shared";
import { withSpan } from "../telemetry/tracing.js";
import type { PolicyResolver } from "../services/policy-resolver.js";
import type { PolicyStore } from "../services/policy-store.js";
import type { RateLimiterService } from "../services/rate-limiter.js";

interface AdminDeps {
  token: string;
  policyStore: PolicyStore;
  policyResolver: PolicyResolver;
  rateLimiter: RateLimiterService;
}

const tenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  plan: z.enum(["free", "pro", "enterprise"])
});

const policySchema = z.object({
  id: z.string().optional(),
  tenantId: z.string().min(1),
  resource: z.string().min(1),
  algorithm: z.enum(["fixed_window", "sliding_window", "token_bucket"]),
  limit: z.coerce.number().int().positive(),
  windowSeconds: z.coerce.number().int().positive(),
  burst: z.coerce.number().int().positive().optional(),
  refillRatePerSecond: z.coerce.number().positive().optional(),
  keyScope: z.enum(["user", "apiKey", "ip"]),
  mode: z.enum(["enforce", "shadow"])
});

const simulateSchema = z.object({
  input: z.object({
    tenantId: z.string().min(1),
    key: z.string().min(1),
    resource: z.string().min(1),
    cost: z.coerce.number().int().positive().default(1)
  }),
  policy: policySchema.optional()
});

function requireAdminToken(request: FastifyRequest, token: string): boolean {
  const provided = request.headers["x-admin-token"];
  if (!provided || typeof provided !== "string") {
    return false;
  }
  return provided === token;
}

export async function registerAdminRoutes(fastify: FastifyInstance, deps: AdminDeps): Promise<void> {
  fastify.register(async (admin) => {
    admin.addHook("preHandler", async (request, reply) => {
      if (!requireAdminToken(request, deps.token)) {
        return reply.status(401).send({ error: "unauthorized" });
      }
    });

    admin.post("/v1/admin/tenants", async (request, reply) => {
      const parsed = tenantSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return { error: "validation_error", details: parsed.error.flatten() };
      }

      const tenant = await withSpan("admin.create_tenant", { "tenant.id": parsed.data.id }, async () =>
        deps.policyStore.upsertTenant(parsed.data)
      );

      deps.policyResolver.invalidateTenant(tenant.id);
      return tenant;
    });

    admin.post("/v1/admin/policies", async (request, reply) => {
      const parsed = policySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return { error: "validation_error", details: parsed.error.flatten() };
      }

      const tenant = await deps.policyStore.getTenant(parsed.data.tenantId);
      if (!tenant) {
        reply.status(404);
        return { error: `Tenant not found: ${parsed.data.tenantId}` };
      }

      const policy: Policy = {
        ...parsed.data,
        id: parsed.data.id ?? randomUUID(),
        updatedAt: new Date().toISOString()
      };

      const saved = await withSpan("admin.upsert_policy", { "tenant.id": policy.tenantId }, async () =>
        deps.policyStore.upsertPolicy(policy)
      );

      deps.policyResolver.invalidateTenant(policy.tenantId);
      return saved;
    });

    admin.get("/v1/admin/policies/:tenantId", async (request, reply) => {
      const tenantId = (request.params as { tenantId: string }).tenantId;
      if (!tenantId) {
        reply.status(400);
        return { error: "tenantId is required" };
      }

      const policies = await deps.policyStore.listPolicies(tenantId);
      return { tenantId, policies };
    });

    admin.post("/v1/admin/simulate", async (request, reply) => {
      const parsed = simulateSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return { error: "validation_error", details: parsed.error.flatten() };
      }

      const input: CheckRequest = parsed.data.input;

      const decision = await withSpan(
        "admin.simulate",
        {
          "tenant.id": input.tenantId,
          "ratelimit.resource": input.resource
        },
        async () => {
          if (parsed.data.policy) {
            return deps.rateLimiter.evaluateWithPolicy(input, {
              ...parsed.data.policy,
              id: parsed.data.policy.id ?? `simulation-${randomUUID()}`,
              updatedAt: new Date().toISOString()
            }, request.correlationId);
          }

          return deps.rateLimiter.check(input, request.correlationId);
        }
      );

      return decision;
    });
  });
}
