import type { AlgorithmType } from "@quotaguard/shared";
import type { RateLimitAlgorithm } from "./types.js";

export class AlgorithmRegistry {
  private readonly algorithms = new Map<AlgorithmType, RateLimitAlgorithm>();

  register(algorithm: RateLimitAlgorithm): void {
    this.algorithms.set(algorithm.type, algorithm);
  }

  get(type: AlgorithmType): RateLimitAlgorithm {
    const algorithm = this.algorithms.get(type);
    if (!algorithm) {
      throw new Error(`Algorithm not registered: ${type}`);
    }
    return algorithm;
  }
}
