# LimitFlow (QuotaGuard)

LimitFlow is a distributed rate limiting and quota service for multi-tenant APIs.
It answers one question on every request: can this tenant/key/resource continue now, and if not, when can it retry?

## What this project includes

- Fastify API in TypeScript (Node.js 20+ LTS)
- Atomic Redis decisions with Lua scripts
- Multiple algorithms:
  - fixed window
  - sliding window
  - token bucket
- Tenant and policy admin API
- Plan defaults (`free`, `pro`, `enterprise`)
- Enforce mode and shadow mode
- Standard rate limit headers
- Metrics (`/metrics`) with Prometheus format
- Structured logs (Pino)
- OpenTelemetry traces
- Docker Compose for local environment
- Vitest unit + integration tests
- GitHub Actions CI (`lint`, `typecheck`, `test`)

## Architecture summary

Main components:

- `apps/api`: HTTP API and policy/rate-limit services
- `packages/shared`: shared types/config/logger
- `redis`: counters/state and atomic Lua execution
- `postgres` (optional): persistence for tenants/policies/audit-ready model

Decision flow for `POST /v1/ratelimit/check`:

1. Validate payload (`tenantId`, `key`, `resource`, `cost`).
2. Resolve policy by `tenant + resource` (in-memory cache with TTL).
3. Execute algorithm in Redis Lua atomically.
4. Build response (`allowed`, `remaining`, `resetSeconds`, `retryAfterSeconds`) and rate limit headers.

## Algorithm behavior

- **Fixed window**
  - Fast and simple.
  - Can produce boundary spikes at window edges.
- **Sliding window**
  - Fairer distribution over time.
  - More precise under uneven traffic.
- **Token bucket**
  - Supports bursts and controlled refill.
  - Good for APIs with occasional spikes.

All algorithm decisions are atomic because they run in Redis Lua.

## Persistence model (important)

Admin endpoints always work, but storage backend depends on config:

- `ENABLE_PG=true`: tenants/policies are persisted in PostgreSQL.
- `ENABLE_PG=false`: in-memory store only (data lost on restart).

Default seed on startup: tenant `acme` with plan `pro`.

## Project layout

```txt
apps/
  api/
    src/
      algorithms/
      redis/
      routes/
      services/
      telemetry/
packages/
  shared/
infra/
  docker/
scripts/
  load.ts
tests/
  unit/
  integration/
```

## Requirements

- Docker + Docker Compose (recommended run mode)
- Node.js 20+ and npm (for local run/load tests)

## Quickstart (Docker)

```bash
cp .env.example .env
docker compose up --build
```

When running with Docker, `npm install` is not required on host.

API base URL: `http://localhost:3001`

## Quickstart (local host)

```bash
npm ci
npm run dev
```

## Environment variables

Copy `.env.example` to `.env` and adjust as needed.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3001` | API port |
| `REDIS_URL` | `redis://redis:6379` | Redis connection |
| `LOG_LEVEL` | `info` | Pino log level |
| `ADMIN_TOKEN` | `super-secret-admin-token` | Required for admin routes |
| `DEFAULT_MODE` | `enforce` | Default policy mode |
| `POLICY_CACHE_TTL_MS` | `10000` | Policy cache TTL |
| `ENABLE_PG` | `true` | Enable PostgreSQL storage |
| `DATABASE_URL` | `postgres://quotaguard:quotaguard@postgres:5432/quotaguard` | PostgreSQL URL |
| `OTEL_SERVICE_NAME` | `quotaguard-api` | Trace service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | empty | OTLP HTTP endpoint |

## API reference

### Health

- `GET /health`
- `GET /ready`

### Rate limit check

`POST /v1/ratelimit/check`

Request:

```json
{
  "tenantId": "acme",
  "key": "user-123",
  "resource": "POST:/payments",
  "cost": 1
}
```

Success response example:

```json
{
  "allowed": true,
  "limit": 600,
  "remaining": 599,
  "resetSeconds": 60,
  "retryAfterSeconds": 0,
  "policyId": "acme-pro-default",
  "mode": "enforce"
}
```

Blocked response example (`429`):

Headers:

- `Retry-After: 18`
- `X-RateLimit-Limit: 100`
- `X-RateLimit-Remaining: 0`
- `X-RateLimit-Reset: 18`

Body:

```json
{
  "allowed": false,
  "limit": 100,
  "remaining": 0,
  "resetSeconds": 18,
  "retryAfterSeconds": 18,
  "policyId": "pro-default",
  "mode": "enforce"
}
```

### Admin API

All admin endpoints require header:

- `X-Admin-Token: <ADMIN_TOKEN>`

Routes:

- `POST /v1/admin/tenants`
- `POST /v1/admin/policies`
- `GET /v1/admin/policies/:tenantId`
- `POST /v1/admin/simulate`

Create tenant example:

```bash
curl -X POST http://localhost:3001/v1/admin/tenants \
  -H "content-type: application/json" \
  -H "X-Admin-Token: super-secret-admin-token" \
  -d '{"id":"acme","name":"Acme Inc","plan":"pro"}'
```

Create policy example:

```bash
curl -X POST http://localhost:3001/v1/admin/policies \
  -H "content-type: application/json" \
  -H "X-Admin-Token: super-secret-admin-token" \
  -d '{
    "tenantId":"acme",
    "resource":"POST:/payments",
    "algorithm":"token_bucket",
    "limit":600,
    "windowSeconds":60,
    "burst":120,
    "refillRatePerSecond":10,
    "keyScope":"user",
    "mode":"enforce"
  }'
```

### Shadow mode

Policies can run in `shadow` mode.
In shadow mode, the service computes full rate-limit decision but does not block traffic.
Use this to validate policy impact before moving to `enforce`.

## Observability

### Logs

Structured logs include:

- `correlationId`
- `tenantId`
- `key`
- `resource`
- `allowed`
- `policyId`
- `mode`

### Metrics

`GET /metrics` exposes:

- `ratelimit_checks_total`
- `ratelimit_blocked_total`
- `ratelimit_latency_ms`
- `redis_lua_errors_total`
- `policy_cache_hits_total`

### Traces

OpenTelemetry spans are created per request with rate-limit attributes.

## Load testing

Run:

```bash
npm ci
npm run load
```

What it does:

- runs scenarios for `1000`, `5000`, `10000` target RPS
- writes JSON report to `reports/`
- prints p50/p95/p99, throughput, blocked rate

Note: `10k` is a benchmark target, not a guarantee. Actual numbers depend on machine/network/runtime config.

## Tests

Unit tests:

```bash
npm test
```

Integration tests (Redis required):

```bash
RUN_INTEGRATION=1 REDIS_URL=redis://localhost:6379 npm test
```

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`

Pipeline steps:

- lint
- typecheck
- tests (integration tests enabled with `RUN_INTEGRATION=1`)

## Production readiness checklist

- Redis Lua atomic updates: yes
- Multi-instance safety: yes
- Standard rate-limit headers: yes
- Shadow mode: yes
- Graceful shutdown: yes
- Metrics endpoint: yes
- Tracing enabled: yes
- Reproducible benchmark script: yes

## Suggested GitHub About metadata

Description:

`Distributed multi-tenant rate limiting and quotas service with Redis Lua atomicity and full observability.`

Topics:

- `nodejs`
- `typescript`
- `redis`
- `rate-limiting`
- `microservices`
- `observability`
- `fastify`
