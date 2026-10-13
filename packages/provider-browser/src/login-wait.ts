import { setTimeout as delay } from "node:timers/promises";
import { AdamError, throwIfCancelled } from "adam-core";
import { isLoggedInSnapshot } from "./extract.ts";
import type { PageSnapshot } from "./session-types.ts";

/** Poll only ADAM pages; never capture a SWITCH credential form. */
export async function waitForAdamLogin(host: {
  closed: () => boolean;
  onAdam: () => boolean;
  snapshot: () => Promise<PageSnapshot>;
  loggedOut?: () => Promise<boolean>;
  timeoutMs: number;
  signal?: AbortSignal;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PageSnapshot> {
  const clock = host.clock ?? Date.now;
  const deadline = clock() + host.timeoutMs;
  while (clock() < deadline) {
    throwIfCancelled(host.signal);
    if (await host.loggedOut?.()) throw new AdamError("cancelled", "Logout was requested. The sign-in window has been closed.", false);
    if (host.closed()) throw new AdamError("cancelled", "The sign-in window was closed. Run adam-mcp login to try again.", false);
    if (host.onAdam()) {
      try {
        const snapshot = await host.snapshot();
        if (isLoggedInSnapshot(snapshot)) return snapshot;
      } catch (error) {
        if (error instanceof AdamError) throw error;
        // A redirect may temporarily destroy the page execution context.
      }
    }
    try {
      if (host.sleep) await host.sleep(300);
      else await delay(300, undefined, { signal: host.signal });
    } catch (error) {
      throwIfCancelled(host.signal);
      throw error;
    }
  }
  throw new AdamError("unauthorized", "Sign-in timed out. The window has been closed. Run adam-mcp login to open a fresh SWITCH form.", false);
}
