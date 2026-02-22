import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  LOG_LEVEL: z.string().default("info"),
  ADMIN_TOKEN: z.string().default("change-me"),
  DEFAULT_MODE: z.enum(["enforce", "shadow"]).default("enforce"),
  POLICY_CACHE_TTL_MS: z.coerce.number().default(10_000),
  ENABLE_PG: z.coerce.boolean().default(false),
  DATABASE_URL: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default("quotaguard-api"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional()
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
