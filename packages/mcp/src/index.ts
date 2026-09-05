import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { runLoginCli, runStatusCli } from "adam-provider-browser";
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

function commandFromArgv(argv: string[]): "login" | "status" | "help" | "mcp" {
  if (argv.includes("help") || argv.includes("--help") || argv.includes("-h")) {
    return "help";
  }
  if (argv.includes("login")) {
    return "login";
  }
  if (argv.includes("status")) {
    return "status";
  }
  return "mcp";
}

function printHelp(): void {
  console.error(`adam-mcp — local read-only ADAM MCP server

Usage:
  adam-mcp              Start MCP on stdio (fixture unless ADAM_PROVIDER=browser or --browser)
  adam-mcp --browser    Start MCP using the local Chrome session
  adam-mcp login        Open Chrome and wait for SWITCH edu-ID
  adam-mcp status       Check whether the local profile looks signed in

Never paste SWITCH passwords into chat or this process.
ChatGPT cannot launch this stdio server.`);
}

async function runStdio(): Promise<void> {
  const configured = createConfiguredProvider();
  const name = detectProviderName();
  console.error(`adam-mcp running on stdio (${name} provider, read-only)`);
  if (name === "browser") {
    console.error("Use adam_login or `adam-mcp login` and complete SWITCH edu-ID in Chrome. Do not paste the password into chat.");
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
