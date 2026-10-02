import { defaultOrigin, defaultProfileDir } from "./config.ts";
import { isNamedCliEntry } from "./is-main.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import { boundHolderPid, holderStatus } from "./session-holder.ts";
import type { AdamBrowserSession } from "./session-types.ts";

/** Holder-aware status: never opens a browser window (ADR 0009). */
/** ADR 0018: default mirrors adam_session_status tool keys; holder detail stays behind --verbose. */
export async function runStatusCli(
  createSession: () => AdamBrowserSession = () => createPlaywrightSession(),
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const session = createSession();
  try {
    const status = await session.status();
    const holder = await holderStatus(defaultProfileDir());
    const holderPid = boundHolderPid(holder) ?? null;
    const report: Record<string, unknown> = {
      loggedIn: status.loggedIn,
      reason: status.reason ?? (status.loggedIn ? "signed-in" : "login-required"),
      ...(status.message ? { message: status.message } : {}),
      origin: defaultOrigin(),
      currentUrl: status.currentUrl,
      title: status.title,
      checkedAt: status.checkedAt,
      holderPid,
    };
    if (verbose) {
      report.holder = holderPid !== null ? { pid: holderPid, startedAt: holder.record?.startedAt } : null;
      report.profileDir = defaultProfileDir();
    }
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = status.loggedIn ? 0 : 1;
  } finally {
    await session.close();
  }
}

if (isNamedCliEntry("status-cli")) {
  void runStatusCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Status check failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
