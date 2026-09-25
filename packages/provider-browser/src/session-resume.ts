import type { SessionCookie } from "./session-types.ts";
import type { HolderRecord, StartHolderOptions } from "./session-holder.ts";

export type ResumeLaunch = {
  /** Chrome was already reachable over CDP; do not spawn a second holder. */
  alreadyAttached?: boolean;
  loggedIn: boolean;
  exportSeed: () => Promise<{ cookies: SessionCookie[]; userAgent?: string } | undefined>;
  close: () => Promise<void>;
};

export type ResumeDeadHolderHost = {
  holderRunning: boolean;
  profileDir: string;
  origin: string;
  launchHeadlessAndVerify: () => Promise<ResumeLaunch>;
  startHolder: (options: StartHolderOptions) => Promise<HolderRecord>;
};

/**
 * Resume a dead holder only when nothing else owns the profile (ADR 0017).
 * A live holder or an already-attached CDP session must not launch a second Chrome.
 */
export function canResumeDeadHolder(input: {
  holderRunning: boolean;
  attached: boolean;
}): boolean {
  return !input.holderRunning && !input.attached;
}

/**
 * Headless-verify an existing Chrome profile, then hand off to a new session holder.
 * Login pages close the temporary Chrome and do not write a holder record.
 */
export async function resumeDeadHolderSession(
  host: ResumeDeadHolderHost,
): Promise<"signed-in" | "login-required" | "skipped" | "already-attached"> {
  if (!canResumeDeadHolder({ holderRunning: host.holderRunning, attached: false })) {
    return "skipped";
  }
  const launched = await host.launchHeadlessAndVerify();
  if (launched.alreadyAttached) {
    return "already-attached";
  }
  let closed = false;
  const closeOnce = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await launched.close();
  };
  try {
    if (!launched.loggedIn) {
      await closeOnce();
      return "login-required";
    }
    const seed = (await launched.exportSeed()) ?? { cookies: [] };
    await closeOnce();
    await host.startHolder({
      profileDir: host.profileDir,
      origin: host.origin,
      seed,
    });
    return "signed-in";
  } catch (error) {
    await closeOnce().catch(() => undefined);
    throw error;
  }
}
