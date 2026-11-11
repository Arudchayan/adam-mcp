import { AdamError, throwIfCancelled, type ProgressReporter, type ProgressUpdate } from "adam-core";

/** Preserve an internal time-budget error; ordinary client aborts remain cancelled. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted && signal.reason instanceof AdamError) throw signal.reason;
  throwIfCancelled(signal);
}

/** A waiter can leave immediately without abandoning another caller's work. */
export function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => {
      try { throwIfAborted(signal); } catch (error) { reject(error); }
    };
    if (signal.aborted) { void promise.catch(() => undefined); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) abort(); else resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

/** Shared work owns its signal; cancellation belongs to each subscriber. */
export class SharedOperation<T> {
  private readonly controller = new AbortController();
  private readonly subscribers = new Set<{ progress?: ProgressReporter; signal?: AbortSignal; busy?: boolean }>();
  private settled = false;
  private pendingProgress = 0;
  private latest?: ProgressUpdate;
  readonly promise: Promise<T>;

  constructor(work: (signal: AbortSignal, report: ProgressReporter) => Promise<T>) {
    this.promise = Promise.resolve().then(() => {
      throwIfAborted(this.controller.signal);
      return work(this.controller.signal, (update) => this.report(update));
    }).finally(() => { this.settled = true; });
    // Invalidation may cancel an operation before anyone has joined it.
    void this.promise.catch(() => undefined);
  }

  get aborted(): boolean { return this.controller.signal.aborted; }

  cancel(): void { this.controller.abort(); }

  async join(signal?: AbortSignal, progress?: ProgressReporter): Promise<T> {
    throwIfAborted(signal);
    const subscriber: { progress?: ProgressReporter; signal?: AbortSignal; busy?: boolean } = { progress, signal };
    this.subscribers.add(subscriber);
    if (progress && this.latest) {
      this.deliver(subscriber, this.latest);
    }
    try {
      return await waitForSignal(waitForSignal(this.promise, this.controller.signal), signal);
    } finally {
      this.subscribers.delete(subscriber);
      if (!this.settled && this.subscribers.size === 0) this.cancel();
    }
  }

  private async report(update: ProgressUpdate): Promise<void> {
    throwIfAborted(this.controller.signal);
    this.latest = update;
    // Best effort: at most one outstanding callback per subscriber; drop updates
    // while busy. A callback cannot stall work or accumulate pending deliveries.
    for (const subscriber of this.subscribers) this.deliver(subscriber, update);
    await Promise.resolve();
  }

  private deliver(subscriber: { progress?: ProgressReporter; signal?: AbortSignal; busy?: boolean }, update: ProgressUpdate): void {
    if (!subscriber.progress || subscriber.busy || subscriber.signal?.aborted || this.pendingProgress >= 32) return;
    subscriber.busy = true;
    this.pendingProgress++;
    void Promise.resolve().then(() => {
      if (this.subscribers.has(subscriber) && !subscriber.signal?.aborted) return subscriber.progress?.(update);
    }).catch(() => undefined).finally(() => { subscriber.busy = false; this.pendingProgress--; });
  }
}
