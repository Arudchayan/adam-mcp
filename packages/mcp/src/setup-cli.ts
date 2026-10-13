import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { AdamError } from "adam-core";
import { defaultHostPath, HOST_CLIENTS, installHostConfig, renderHostConfig, type HostClient } from "./host-config.ts";
import { diagnose } from "./doctor.ts";

export function parseSetupArgs(argv: string[]): { client?: HostClient; output?: string; write: boolean; login: boolean; json: boolean } {
  const result: { client?: HostClient; output?: string; write: boolean; login: boolean; json: boolean } = { write: false, login: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--write") result.write = true;
    else if (arg === "--login") result.login = true;
    else if (arg === "--json") result.json = true;
    else if (arg === "--client" || arg === "--output") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new AdamError("provider_unavailable", `${arg} needs a value.`, false);
      if (arg === "--client") {
        if (!HOST_CLIENTS.includes(value as HostClient)) throw new AdamError("provider_unavailable", `Choose a client: ${HOST_CLIENTS.join(", ")}.`, false);
        result.client = value as HostClient;
      } else result.output = resolve(value);
    } else throw new AdamError("provider_unavailable", "Unknown setup option. Use --client, --output, --write, --login or --json.", false);
  }
  return result;
}

export async function runSetupCli(argv: string[], entryPath = fileURLToPath(import.meta.url), doctorOnly = false): Promise<void> {
  const options = parseSetupArgs(argv);
  if (doctorOnly && (options.write || options.login)) throw new AdamError("provider_unavailable", "Doctor is passive; --write and --login are setup options.", false);
  if (!doctorOnly && !options.client && process.stdin.isTTY && process.stderr.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const value = (await prompt.question(`Choose your client (${HOST_CLIENTS.join(", ")}): `)).trim();
      if (!HOST_CLIENTS.includes(value as HostClient)) throw new AdamError("provider_unavailable", "Choose a supported client using --client.", false);
      options.client = value as HostClient;
    } finally { prompt.close(); }
  }
  if (!doctorOnly && !options.client) {
    if (options.write || options.login || options.output) throw new AdamError("provider_unavailable", "Select --client before installing configuration or signing in.", false);
    for (const client of HOST_CLIENTS) { console.log(`${client}:\n${renderHostConfig(client, entryPath)}`); }
    console.error("Select one client: adam-mcp setup --client codex --write --login");
    return;
  }
  const report = await diagnose(entryPath, { client: options.client, configPath: options.output });
  if (doctorOnly) {
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else for (const check of report.checks) console.log(`${check.state.toUpperCase()}: ${check.message}`);
    process.exitCode = report.ready ? 0 : 1;
    return;
  }
  for (const check of report.checks) console.error(`${check.state.toUpperCase()}: ${check.message}`);
  if (options.write || options.login) {
    if (!report.ready) throw new AdamError("provider_unavailable", "Resolve the prerequisite errors above before setup. Nothing was installed.", false);
  }
  if (options.write) {
    const installed = await installHostConfig(options.client!, options.output ?? defaultHostPath(options.client!), entryPath);
    console.error(`Installed: ${installed.path}${installed.backup ? `\nBackup: ${installed.backup}` : ""}`);
  } else console.log(renderHostConfig(options.client!, entryPath));
  if (options.login) {
    const { runLoginCli, createBrowserProvider } = await import("adam-provider-browser");
    await runLoginCli(undefined, []);
    if (process.exitCode) return;
    const provider = createBrowserProvider();
    try {
      const status = await provider.status();
      if (!status.loggedIn) throw new AdamError("unauthorized", "Sign-in could not be verified. Run status before retrying.", false);
      const courses = await provider.listCourses({ limit: 1 });
      if (courses.listingState === "unknown") throw new AdamError("provider_unavailable", "Connected, but the course listing could not be verified. Retry the listing.", true);
      console.error(courses.items.length ? "Connected. Your course listing is available." : "Connected. ADAM returned an empty course listing.");
    } finally { await provider.close(); }
  }
  console.error("Restart your client, enable adam, then ask: What courses am I in?");
}
