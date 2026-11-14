import { AdamError, isAdamError, redactText } from "adam-core";
import { defaultOrigin, defaultProfileDir } from "./config.ts";
import { isNamedCliEntry } from "./is-main.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import { boundHolderPid, holderStatus } from "./session-holder.ts";
import type { AdamBrowserSession, SessionStatus } from "./session-types.ts";
import { adamErrorFromNavigationFailure } from "./upstream-errors.ts";

/** #123: a failed status probe is still a structured, non-signed-in report. */
export function statusFromProbeFailure(error: unknown): SessionStatus & { errorCode: string; retryable: boolean } {
  const mapped = isAdamError(error) || error instanceof AdamError ? error : adamErrorFromNavigationFailure(error);
  const raw = mapped?.message ?? (error instanceof Error ? error.message : "Status check failed.");
  const unauthorized = mapped?.code === "unauthorized";
  return {
    loggedIn: false,
    reason: unauthorized ? "login-required" : "unknown",
    connectionState: unauthorized ? "disconnected" : "unknown",
    recoveryAction: unauthorized ? "login" : "check_status",
    message: redactText(raw.split(/\r?\n/)[0]!.slice(0, 300)),
    checkedAt: new Date().toISOString(),
    errorCode: mapped?.code ?? "provider_unavailable",
    retryable: mapped?.retryable ?? true,
  };
}

/** Holder-aware status: never opens a browser window (ADR 0009). */
/** ADR 0018: default mirrors adam_session_status tool keys; holder detail stays behind --verbose. */
export async function runStatusCli(
  createSession: () => AdamBrowserSession = () => createPlaywrightSession(),
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const session = createSession();
  try {
    let status: SessionStatus & { errorCode?: string; retryable?: boolean };
    try {
      status = await session.status();
    } catch (error) {
      status = statusFromProbeFailure(error);
    }
    const holder = await holderStatus(defaultProfileDir());
    const holderPid = boundHolderPid(holder) ?? null;
    const report: Record<string, unknown> = {
      loggedIn: status.loggedIn,
      reason: status.reason ?? (status.loggedIn ? "signed-in" : "login-required"),
      connectionState: status.connectionState ?? (status.loggedIn ? "connected" : "unknown"),
      recoveryAction: status.recoveryAction ?? (status.loggedIn ? "none" : "check_status"),
      ...(status.message ? { message: status.message } : {}),
      origin: defaultOrigin(),
      currentUrl: status.currentUrl,
      title: status.title,
      checkedAt: status.checkedAt,
      holderPid,
      ...(status.errorCode ? { errorCode: status.errorCode, retryable: status.retryable } : {}),
    };
    if (verbose) {
      report.holder = holderPid !== null ? { pid: holderPid, startedAt: holder.record?.startedAt } : null;
      report.profileDir = defaultProfileDir();
    }
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = status.loggedIn ? 0 : 1;
  } finally {
    // Never replace the structured report with a teardown error (#123).
    await session.close().catch(() => undefined);
  }
}

if (isNamedCliEntry("status-cli")) {
  void runStatusCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Status check failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
