import { AdamError, redactText } from "adam-core";
import { isNamedCliEntry } from "./is-main.ts";
import { createPlaywrightSession } from "./playwright-session.ts";
import type { AdamBrowserSession } from "./session-types.ts";

/**
 * ADR 0009: open Chrome for the interactive SWITCH sign-in, then hand the
 * session to a detached headless holder and return control to the terminal.
 */
export async function runLoginCli(
  createSession: () => AdamBrowserSession = () => createPlaywrightSession({ headed: true }),
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const timeoutIndex = argv.indexOf("--timeout-ms");
  const rawTimeout = timeoutIndex < 0 ? undefined : argv[timeoutIndex + 1];
  const timeoutMs = rawTimeout === undefined ? undefined : Number(rawTimeout);
  if (timeoutIndex >= 0 && (!rawTimeout || !Number.isInteger(timeoutMs) || timeoutMs! < 10_000 || timeoutMs! > 30 * 60_000)) {
    throw new AdamError("provider_unavailable", "--timeout-ms must be an integer between 10000 and 1800000.", false);
  }
  const session = createSession();
  const controller = new AbortController();
  const cancel = () => { controller.abort(); void session.close(); };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    console.error("Checking the ADAM session…");
    const current = argv.includes("--force") ? undefined : await session.status();
    if (current?.loggedIn) {
      console.error("Already signed in. No browser window needed.");
      return;
    }
    console.error("Opening a sign-in window. Close it or press Ctrl+C to cancel.");
    console.error("After sign-in it closes automatically; your session continues in the background.");
    const status = await session.loginInteractively(timeoutMs, { signal: controller.signal, force: true });
    if (!status.loggedIn) {
      console.error("Sign-in did not complete. Run adam-mcp login to try again.");
      process.exitCode = 1;
      return;
    }
    console.error("Signed in. Check: adam-mcp status    Stop: adam-mcp logout");
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await session.close();
  }
}

if (isNamedCliEntry("login-cli")) {
  void runLoginCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Login failed.";
    console.error(redactText(message));
    process.exitCode = 1;
  });
}
