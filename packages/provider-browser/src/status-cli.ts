import { defaultOrigin, defaultProfileDir } from "./config.ts";
import { isNamedCliEntry } from "./is-main.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import { holderStatus } from "./session-holder.ts";
import type { AdamBrowserSession } from "./session-types.ts";

/** Holder-aware status: never opens a browser window (ADR 0009). */
export async function runStatusCli(
  createSession: () => AdamBrowserSession = () => createPlaywrightSession(),
): Promise<void> {
  const session = createSession();
  try {
    const status = await session.status();
    const holder = await holderStatus(defaultProfileDir());
    const report = {
      loggedIn: status.loggedIn,
      reason: status.reason ?? (status.loggedIn ? "signed-in" : "login-required"),
      ...(status.message ? { message: status.message } : {}),
      origin: defaultOrigin(),
      currentUrl: status.currentUrl,
      title: status.title,
      checkedAt: status.checkedAt,
      holder: holder.running ? { pid: holder.record?.pid, startedAt: holder.record?.startedAt } : null,
      profileDir: defaultProfileDir(),
    };
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
