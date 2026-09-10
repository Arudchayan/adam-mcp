import { rm } from "node:fs/promises";
import { defaultProfileDir } from "./config.ts";
import { isNamedCliEntry } from "./is-main.ts";
import { stopSessionHolder } from "./session-holder.ts";

/** Stop the detached headless session; `--purge` also removes the Chrome profile. */
export async function runLogoutCli(argv: string[] = []): Promise<void> {
  const purge = argv.includes("--purge");
  const stopped = await stopSessionHolder();
  console.error(stopped ? "Stopped the headless ADAM session." : "No ADAM session was running.");
  if (purge) {
    await rm(defaultProfileDir(), { recursive: true, force: true }).catch(() => undefined);
    console.error(`Removed the local Chrome profile at ${defaultProfileDir()}.`);
  }
}

if (isNamedCliEntry("logout-cli")) {
  void runLogoutCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Logout failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
