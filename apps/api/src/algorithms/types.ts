import type { AlgorithmContext, AlgorithmResult, AlgorithmType } from "@quotaguard/shared";
import type { RedisScriptManager } from "../redis/scripts.js";

export interface RateLimitAlgorithm {
  readonly type: AlgorithmType;
  evaluate(context: AlgorithmContext): Promise<AlgorithmResult>;
}

export interface AlgorithmDeps {
  scripts: RedisScriptManager;
}
