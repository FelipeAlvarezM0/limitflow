import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export class MetricsService {
  readonly registry: Registry;
  readonly checksTotal: Counter;
  readonly blockedTotal: Counter;
  readonly redisLuaErrorsTotal: Counter;
  readonly policyCacheHitsTotal: Counter;
  readonly policyCacheMissesTotal: Counter;
  readonly latencyMs: Histogram;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry, prefix: "quotaguard_" });

    this.checksTotal = new Counter({
      name: "ratelimit_checks_total",
      help: "Total number of rate limit checks",
      labelNames: ["tenant_id", "resource", "policy_id", "mode"],
      registers: [this.registry]
    });

    this.blockedTotal = new Counter({
      name: "ratelimit_blocked_total",
      help: "Total number of blocked checks",
      labelNames: ["tenant_id", "resource", "policy_id", "mode"],
      registers: [this.registry]
    });

    this.redisLuaErrorsTotal = new Counter({
      name: "redis_lua_errors_total",
      help: "Total Redis Lua execution errors",
      labelNames: ["algorithm"],
      registers: [this.registry]
    });

    this.policyCacheHitsTotal = new Counter({
      name: "policy_cache_hits_total",
      help: "Total policy cache hits",
      labelNames: ["tenant_id"],
      registers: [this.registry]
    });

    this.policyCacheMissesTotal = new Counter({
      name: "policy_cache_misses_total",
      help: "Total policy cache misses",
      labelNames: ["tenant_id"],
      registers: [this.registry]
    });

    this.latencyMs = new Histogram({
      name: "ratelimit_latency_ms",
      help: "Rate limit check latency in milliseconds",
      buckets: [0.25, 0.5, 1, 2, 3, 5, 10, 25, 50],
      labelNames: ["tenant_id", "resource", "policy_id", "mode"],
      registers: [this.registry]
    });
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }
}
