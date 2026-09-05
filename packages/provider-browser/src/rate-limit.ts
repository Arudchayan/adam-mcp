import { AdamError } from "adam-core";
import { setTimeout as delay } from "node:timers/promises";

export type NavigationLimiterOptions = {
  gapMs: number;
  perMinute: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class NavigationLimiter {
  private lastAt = 0;
  private readonly recent: number[] = [];
  private readonly gapMs: number;
  private readonly perMinute: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: NavigationLimiterOptions) {
    this.gapMs = options.gapMs;
    this.perMinute = options.perMinute;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
  }

  async take(): Promise<void> {
    const now = this.now();
    const windowStart = now - 60_000;
    while (this.recent.length > 0 && this.recent[0] < windowStart) {
      this.recent.shift();
    }
    if (this.recent.length >= this.perMinute) {
      throw new AdamError(
        "rate_limited",
        `Live ADAM navigation rate limit reached (${this.perMinute} per minute). Wait and retry.`,
        true,
      );
    }
    const wait = this.gapMs - (now - this.lastAt);
    if (wait > 0) {
      await this.sleep(wait);
    }
    const stamped = this.now();
    this.lastAt = stamped;
    this.recent.push(stamped);
  }
}
