import { createPlaywrightSession } from "./playwright-session.ts";
import { defaultProfileDir } from "./config.ts";
import { isNamedCliEntry } from "./is-main.ts";

export async function runLoginCli(): Promise<void> {
  const session = createPlaywrightSession({ headed: true });
  console.error("Opening Chrome for ADAM.");
  console.error(`Profile: ${defaultProfileDir()}`);
  console.error("Sign in in that window.");
  const status = await session.loginInteractively();
  if (!status.loggedIn) {
    console.error("Login did not complete.");
    await session.close();
    process.exitCode = 1;
    return;
  }
  console.error("Signed in. The window should close; a background Chrome keeps the session.");
  console.error("Enable the adam MCP server in your client, then list courses.");
  console.error("Ctrl+C closes Chrome and ends the session.");
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await session.close();
}

if (isNamedCliEntry("login-cli")) {
  void runLoginCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Login failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
