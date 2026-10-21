import { AdamError, throwIfCancelled } from "./errors.ts";

/** One active task with bounded waiting input. Active work owns cancellation. */
export class WeightedQueue {
  private active = false;
  private bytes = 0;
  private readonly pending: Array<{ start: () => void }> = [];

  constructor(private readonly limits: { maxPending: number; maxBytes: number; waitMs: number }) {}

  enqueue<T>(weight: number, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfCancelled(signal);
    if (this.active && (this.pending.length >= this.limits.maxPending || weight > this.limits.maxBytes - this.bytes)) {
      return Promise.reject(new AdamError("provider_unavailable", "PDF extraction queue is full. Retry after the current extraction finishes.", true));
    }
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
      const remove = (error: AdamError) => {
        const index = this.pending.indexOf(entry);
        if (index < 0) return;
        this.pending.splice(index, 1);
        this.bytes -= weight;
        cleanup();
        reject(error);
      };
      const cancel = () => remove(new AdamError("cancelled", "Queued PDF extraction cancelled.", false));
      const entry = { start: () => {
        cleanup();
        this.active = true;
        Promise.resolve().then(() => { throwIfCancelled(signal); return work(); })
          .then(resolve, reject).finally(() => {
            this.active = false;
            const next = this.pending.shift();
            if (next) next.start();
          });
      } };
      if (!this.active) { entry.start(); return; }
      this.bytes += weight;
      // Remove the weight before running, including when an active task fails.
      const start = entry.start;
      entry.start = () => { this.bytes -= weight; start(); };
      this.pending.push(entry);
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => remove(new AdamError("provider_unavailable", "PDF extraction queue wait exceeded 30 seconds. Retry later.", true)), this.limits.waitMs);
    });
  }
}
