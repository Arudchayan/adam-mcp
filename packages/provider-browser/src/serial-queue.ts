import { AdamError } from "adam-core";
import { throwIfAborted, waitForSignal } from "./request-lifecycle.ts";

type PendingWork = { run: () => Promise<void> };

/** One active operation; cancelled entries are physically removed from the FIFO. */
export class SerialQueue {
  private readonly pending: PendingWork[] = [];
  private active = false;

  constructor(private readonly options: { maxPending?: number; waitTimeoutMs?: number } = {}) {}

  /** Emit stderr telemetry when an op waited this long behind another (ADR 0016). */
  static readonly LONG_WAIT_MS = 5_000;

  enqueue<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    try { throwIfAborted(signal); } catch (error) { return Promise.reject(error); }
    if (this.pending.length >= (this.options.maxPending ?? 32)) {
      return Promise.reject(new AdamError("provider_unavailable", "The ADAM browser queue is full. Retry after the current request finishes.", true));
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const enqueuedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let entry: PendingWork;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", removeCancelled);
    };
    let rejectWork!: (error: unknown) => void;
    const removeCancelled = () => {
      const index = this.pending.indexOf(entry);
      if (index >= 0) {
        this.pending.splice(index, 1);
        cleanup();
        try { throwIfAborted(controller.signal); } catch (error) { rejectWork(error); }
      }
    };
    const result = new Promise<T>((resolve, reject) => {
      rejectWork = reject;
      entry = { run: async () => {
        clearTimeout(timer);
        try {
          throwIfAborted(controller.signal);
          const value = await this.runWithWaitLog(enqueuedAt, () => work(controller.signal));
          throwIfAborted(controller.signal);
          resolve(value);
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      } };
    });
    timer = setTimeout(() => controller.abort(new AdamError("provider_unavailable", "ADAM browser queue wait exceeded 30 seconds. Retry after the current request finishes.", true)), this.options.waitTimeoutMs ?? 30_000);
    controller.signal.addEventListener("abort", removeCancelled, { once: true });
    this.pending.push(entry!);
    this.drain();
    return waitForSignal(result, controller.signal);
  }

  private drain(): void {
    if (this.active) return;
    const entry = this.pending.shift();
    if (!entry) return;
    this.active = true;
    void entry.run().finally(() => {
      this.active = false;
      this.drain();
    });
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
