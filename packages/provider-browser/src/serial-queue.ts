/** Serialize browser ops so one Chrome session is never shared concurrently. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  /** Emit stderr telemetry when an op waited this long behind another (ADR 0016). */
  static readonly LONG_WAIT_MS = 5_000;

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const enqueuedAt = Date.now();
    const run = this.tail.then(
      () => this.runWithWaitLog(enqueuedAt, work),
      () => this.runWithWaitLog(enqueuedAt, work),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runWithWaitLog<T>(enqueuedAt: number, work: () => Promise<T>): Promise<T> {
    const waitedMs = Date.now() - enqueuedAt;
    if (waitedMs >= SerialQueue.LONG_WAIT_MS) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "browser_queue_wait",
          waitedMs,
        }),
      );
    }
    return work();
  }
}
