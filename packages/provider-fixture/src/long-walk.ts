import type { ProgressReporter } from "adam-core";

/** Fixture-only multi-step walk that emits progress without real delays (A2). */
export class LongWalkStub {
  static async emit(
    label: string,
    onProgress?: ProgressReporter,
    steps = 3,
  ): Promise<void> {
    if (!onProgress) {
      return;
    }
    for (let i = 1; i <= steps; i += 1) {
      await onProgress({
        progress: i,
        total: steps,
        message: `${label}: step ${i}/${steps}`,
      });
    }
  }
}
