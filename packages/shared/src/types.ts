export type AlgorithmType = "fixed_window" | "sliding_window" | "token_bucket";
export type PolicyMode = "enforce" | "shadow";
export type KeyScope = "user" | "apiKey" | "ip";
export type PlanName = "free" | "pro" | "enterprise";

export interface Tenant {
  id: string;
  name: string;
  plan: PlanName;
  createdAt: string;
}

export interface Policy {
  id: string;
  tenantId: string;
  resource: string;
  algorithm: AlgorithmType;
  limit: number;
  windowSeconds: number;
  burst?: number;
  refillRatePerSecond?: number;
  keyScope: KeyScope;
  mode: PolicyMode;
  updatedAt: string;
}

export interface CheckRequest {
  tenantId: string;
  key: string;
  resource: string;
  cost?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
  policyId: string;
  mode: PolicyMode;
  algorithm: AlgorithmType;
}

export interface AlgorithmContext {
  policy: Policy;
  tenantId: string;
  key: string;
  resource: string;
  cost: number;
  nowMs: number;
}

export interface AlgorithmResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
}

export interface PlanDefaults {
  free: Omit<Policy, "id" | "updatedAt">;
  pro: Omit<Policy, "id" | "updatedAt">;
  enterprise: Omit<Policy, "id" | "updatedAt">;
}
