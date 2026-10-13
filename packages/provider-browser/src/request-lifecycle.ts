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
  private readonly subscribers = new Set<{ progress?: ProgressReporter; signal?: AbortSignal }>();
  private settled = false;
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
    const subscriber = { progress, signal };
    this.subscribers.add(subscriber);
    if (progress && this.latest) {
      void Promise.resolve().then(() => {
        if (this.subscribers.has(subscriber) && !signal?.aborted) return progress(this.latest!);
      }).catch(() => undefined);
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
    // One host's failed notification must not fail another subscriber's read.
    await waitForSignal(Promise.allSettled([...this.subscribers].map(async (subscriber) => {
      if (this.subscribers.has(subscriber) && !subscriber.signal?.aborted) await subscriber.progress?.(update);
    })), this.controller.signal);
  }
}
