import { rm } from "node:fs/promises";
import { resolve, parse, relative, isAbsolute } from "node:path";
import { AdamError, redactText } from "adam-core";
import { defaultProfileDir } from "./config.ts";
import { isNamedCliEntry } from "./is-main.ts";
import { stopSessionHolder } from "./session-holder.ts";
import { disableSession } from "./session-disabled.ts";

/** Stop the detached headless session; `--purge` also removes the Chrome profile. */
export async function runLogoutCli(argv: string[] = []): Promise<void> {
  const purge = argv.includes("--purge");
  const profileDir = resolve(defaultProfileDir());
  const workspaceRelative = relative(profileDir, resolve(process.cwd()));
  const containsWorkspace = !isAbsolute(workspaceRelative) && workspaceRelative !== ".." && !workspaceRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
  if (purge && (profileDir === parse(profileDir).root || containsWorkspace)) {
    throw new AdamError("provider_unavailable", "Refusing to purge a filesystem root or the current workspace. Set ADAM_BROWSER_PROFILE_DIR to a dedicated Chrome profile.", false);
  }
  await disableSession(profileDir);
  console.error("Stopping ADAM… Automatic reconnection is now disabled.");
  const stopped = await stopSessionHolder(profileDir);
  console.error(stopped ? "Stopped the headless ADAM session." : "No ADAM session was running.");
  if (purge) {
    await rm(profileDir, { recursive: true, force: true });
    await disableSession(profileDir);
    console.error("Removed the local Chrome profile. Run adam-mcp login to start again.");
  }
}

if (isNamedCliEntry("logout-cli")) {
  void runLogoutCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Logout failed.";
    console.error(redactText(message));
    process.exitCode = 1;
  });
}
