import { createPlaywrightSession } from "./playwright-session.ts";
import { defaultProfileDir } from "./config.ts";
import { isMainModule } from "./is-main.ts";

export async function runLoginCli(): Promise<void> {
  const session = createPlaywrightSession({ headed: true });
  console.error("Opening a dedicated Chrome profile for ADAM.");
  console.error(`Profile: ${defaultProfileDir()}`);
  console.error("Sign in with SWITCH edu-ID in that window.");
  console.error("Do not paste the password into this terminal or into chat.");
  const status = await session.loginInteractively();
  if (!status.loggedIn) {
    console.error("Login did not complete.");
    await session.close();
    process.exitCode = 1;
    return;
  }
  console.error("Signed in. Leave this Chrome window open.");
  console.error("Enable the adam MCP server in Cursor, then use adam_list_courses.");
  console.error("Ctrl+C closes Chrome and drops the SWITCH session.");
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await session.close();
}

if (isMainModule(import.meta.url)) {
  void runLoginCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Login failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
