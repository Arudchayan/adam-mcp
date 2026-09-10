import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { runLoginCli, runLogoutCli, runSessionHolder, runStatusCli } from "adam-provider-browser";
import { closeConfiguredProvider, createConfiguredProvider, detectProviderName } from "./providers.ts";
import { createAdamMcpServer } from "./server.ts";

export { createAdamMcpServer } from "./server.ts";
export { READ_ONLY_ANNOTATIONS, READ_ONLY_TOOLS, SESSION_TOOLS, UNTRUSTED_PAGE_NOTICE } from "./results.ts";
export { createConfiguredProvider, detectProviderName, parseProviderName } from "./providers.ts";

export function createServer() {
  return createAdamMcpServer(createConfiguredProvider());
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
  adam-mcp              Fixture catalog
  adam-mcp --browser    Live ADAM via a headless session (run login first)
  adam-mcp login        Sign in to ADAM in Chrome, then close it
  adam-mcp status       Check the headless ADAM session
  adam-mcp logout       Stop the headless session (--purge removes the profile)`);
}

async function runStdio(): Promise<void> {
  const configured = createConfiguredProvider();
  const name = detectProviderName();
  console.error(`adam-mcp running on stdio (${name} provider)`);
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
    case "login":
      await runLoginCli();
      return;
    case "status":
      await runStatusCli();
      return;
    case "logout":
      await runLogoutCli(argv);
      return;
    case "session-holder": {
      const seedIndex = argv.indexOf("session-holder");
      const seedFile = argv[seedIndex + 1];
      if (!seedFile) {
        throw new Error("session-holder requires a seed file path.");
      }
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

if (isMainModule()) {
  void runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "adam-mcp failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
