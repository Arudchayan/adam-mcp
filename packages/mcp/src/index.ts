import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AdamError, isAdamError } from "adam-core";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { closeConfiguredProvider, createConfiguredProvider, detectProviderName } from "./providers.ts";
import { createAdamMcpServer } from "./server.ts";

export { createAdamMcpServer } from "./server.ts";
export { READ_ONLY_ANNOTATIONS, READ_ONLY_TOOLS, SESSION_TOOLS, UNTRUSTED_PAGE_NOTICE } from "./results.ts";
export { createConfiguredProvider, detectProviderName, parseProviderName } from "./providers.ts";

export async function createServer() {
  return createAdamMcpServer(await createConfiguredProvider());
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url).toLowerCase() === resolve(entry).toLowerCase();
}

function commandFromArgv(argv: string[]): "login" | "status" | "logout" | "session-holder" | "help" | "mcp" {
  if (argv.includes("--help") || argv.includes("-h")) {
    return "help";
  }
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const command = positional[0];
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
  return "mcp";
}

function printHelp(): void {
  console.error(`adam-mcp — ADAM MCP server (stdio)

Usage:
  adam-mcp              Live ADAM via a headless session (run login first)
  adam-mcp --browser    Same as adam-mcp (kept for existing host JSON)
  adam-mcp login        Sign in to ADAM in Chrome, then close it
  adam-mcp status       Check the headless ADAM session
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
    case "help":
      printHelp();
      return;
    case "login": {
      const { runLoginCli } = await import("adam-provider-browser");
      await runLoginCli();
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
    return `${error.code}: ${error.message} (retryable=${error.retryable})`;
  }
  return error instanceof Error ? error.message : "adam-mcp failed.";
}

if (isMainModule()) {
  void runCli().catch((error: unknown) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}
