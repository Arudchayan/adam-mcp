import { createPlaywrightSession } from "./playwright-session.ts";
import { isLoggedInSnapshot, isLoginSnapshot } from "./extract.ts";
import { defaultOrigin, defaultProfileDir } from "./config.ts";
import { isNamedCliEntry } from "./is-main.ts";

export async function runStatusCli(): Promise<void> {
  const session = createPlaywrightSession({ headed: true });
  try {
    const snapshot = await session.open(defaultOrigin());
    const url = new URL(snapshot.url);
    const report = {
      loggedIn: isLoggedInSnapshot(snapshot),
      loginPage: isLoginSnapshot(snapshot),
      host: url.hostname,
      path: url.pathname,
      title: snapshot.title,
      profileDir: defaultProfileDir(),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.loggedIn ? 0 : 1;
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
