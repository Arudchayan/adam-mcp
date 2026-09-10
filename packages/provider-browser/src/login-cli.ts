import { defaultProfileDir } from "./config.ts";
import { isNamedCliEntry } from "./is-main.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import type { AdamBrowserSession } from "./session-types.ts";

/**
 * ADR 0009: open Chrome for the interactive SWITCH sign-in, then hand the
 * session to a detached headless holder and return control to the terminal.
 */
export async function runLoginCli(
  createSession: () => AdamBrowserSession = () => createPlaywrightSession({ headed: true }),
): Promise<void> {
  const session = createSession();
  console.error("Opening Chrome for ADAM.");
  console.error(`Profile: ${defaultProfileDir()}`);
  console.error("Sign in in that window. It closes automatically when sign-in completes.");
  const status = await session.loginInteractively();
  if (!status.loggedIn) {
    console.error("Login did not complete.");
    await session.close();
    process.exitCode = 1;
    return;
  }
  console.error("Signed in. The browser window is closed; the ADAM session runs headless.");
  console.error("Check: adam-mcp status    Stop: adam-mcp logout");
  await session.close();
}

if (isNamedCliEntry("login-cli")) {
  void runLoginCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Login failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
