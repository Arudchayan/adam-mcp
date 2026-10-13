import { isMainModule } from "./main-entry.ts";
import { fileURLToPath } from "node:url";
import { AdamError, isAdamError, redactText } from "adam-core";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { closeConfiguredProvider, createConfiguredProvider, detectProviderName } from "./providers.ts";
import { createAdamMcpServer } from "./server.ts";

export { createAdamMcpServer } from "./server.ts";
export { READ_ONLY_ANNOTATIONS, READ_ONLY_TOOLS, SESSION_TOOLS, UNTRUSTED_PAGE_NOTICE } from "./results.ts";
export { createConfiguredProvider, detectProviderName, parseProviderName } from "./providers.ts";

export async function createServer() {
  return createAdamMcpServer(await createConfiguredProvider());
}

function commandFromArgv(argv: string[]): "setup" | "doctor" | "login" | "status" | "logout" | "session-holder" | "help" | "mcp" {
  if (argv.includes("--help") || argv.includes("-h")) {
    return "help";
  }
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const command = positional[0];
  if (command === "setup" || command === "doctor") return command;
  if (command === "help") {
    return "help";
  }
  if (command === "login") {
    return "login";
  }
  if (command === "status") {
    return "status";
  }
  if (command === "logout") {
    return "logout";
  }
  if (command === "session-holder") {
    return "session-holder";
  }
  if (command === undefined) return "mcp";
  throw new AdamError("provider_unavailable", `Unknown command: ${redactText(command)}. Use login, status, logout, or --help.`, false);
}

function printHelp(): void {
  console.error(`adam-mcp — ADAM MCP server (stdio)

Usage:
  adam-mcp              Live ADAM via a headless session (run login first)
  adam-mcp --browser    Same as adam-mcp (kept for existing host JSON)
  adam-mcp setup --client codex  Preview client configuration
  adam-mcp setup --client codex --write --login  Install with backup and verify sign-in
  adam-mcp doctor --client codex  Check installation and passive session status
  adam-mcp login        Sign in to ADAM in Chrome, then close it
  adam-mcp login --force  Open a fresh sign-in window instead of reusing a session
  adam-mcp login --timeout-ms 120000  Limit the sign-in wait (close window or Ctrl+C to cancel)
  adam-mcp status       Check the headless ADAM session (default mirrors adam_session_status keys: loggedIn/reason/holderPid/checkedAt)
  adam-mcp status --verbose  Bug-report-only holder/profileDir detail (holder pid/generation/exe + profileDir)
  adam-mcp logout       Stop the headless session (--purge removes the profile)`);
}

async function runStdio(): Promise<void> {
  const configured = await createConfiguredProvider();
  const name = detectProviderName();
  const banner =
    name === "fixture"
      ? "adam-mcp running on stdio (fixture provider (test harness))"
      : `adam-mcp running on stdio (${name} provider)`;
  console.error(banner);
  if (name === "browser") {
    console.error("Live ADAM: run `adam-mcp login` once, then the session runs headless.");
  }
  const shutdown = () => {
    void closeConfiguredProvider(configured).finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await serveStdio(() => createAdamMcpServer(configured));
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = commandFromArgv(argv);
  switch (command) {
    case "setup":
    case "doctor": {
      const { runSetupCli } = await import("./setup-cli.ts");
      await runSetupCli(argv.slice(argv.indexOf(command) + 1), fileURLToPath(import.meta.url), command === "doctor");
      return;
    }
    case "help":
      printHelp();
      return;
    case "login": {
      const { runLoginCli } = await import("adam-provider-browser");
      await runLoginCli(undefined, argv);
      return;
    }
    case "status": {
      const { runStatusCli } = await import("adam-provider-browser");
      await runStatusCli();
      return;
    }
    case "logout": {
      const { runLogoutCli } = await import("adam-provider-browser");
      await runLogoutCli(argv);
      return;
    }
    case "session-holder": {
      const seedIndex = argv.indexOf("session-holder");
      const seedFile = argv[seedIndex + 1];
      if (!seedFile) {
        throw new Error("session-holder requires a seed file path.");
      }
      const { runSessionHolder } = await import("adam-provider-browser");
      await runSessionHolder(seedFile);
      return;
    }
    case "mcp":
      await runStdio();
      return;
    default: {
      const exhaustive: never = command;
      throw new Error(`Unhandled command ${String(exhaustive)}`);
    }
  }
}

/** Stderr line for a refused startup. Keeps the AdamError code and retryable flag. */
export function formatCliError(error: unknown): string {
  if (isAdamError(error) || error instanceof AdamError) {
    return `${error.code}: ${redactText(error.message)} (retryable=${error.retryable})`;
  }
  return error instanceof Error ? redactText(error.message) : "adam-mcp failed.";
}

if (isMainModule(import.meta.url)) {
  void runCli().catch((error: unknown) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}
