import { isMainModule } from "./main-entry.ts";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import { AdamError, isAdamError, redactText } from "adam-core";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { closeConfiguredProvider, createConfiguredProvider, detectProviderName } from "./providers.ts";
import { createAdamMcpServer } from "./server.ts";

export { createAdamMcpServer } from "./server.ts";
export { READ_ONLY_ANNOTATIONS, READ_ONLY_TOOLS, SESSION_TOOLS, UNTRUSTED_PAGE_NOTICE } from "./results.ts";
export { createConfiguredProvider, detectProviderName, parseProviderName } from "./providers.ts";

export async function createServer() {
  return createAdamMcpServer(await createConfiguredProvider());
}

function commandFromArgv(argv: string[]): "setup" | "doctor" | "login" | "status" | "logout" | "download" | "session-holder" | "help" | "mcp" {
  if (argv.includes("--help") || argv.includes("-h")) {
    return "help";
  }
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const command = positional[0];
  if (command === "setup" || command === "doctor") return command;
  if (command === "download") return command;
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
  throw new AdamError("provider_unavailable", `Unknown command: ${redactText(command)}. Use login, status, logout, download, or --help.`, false);
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
  adam-mcp logout       Stop the headless session (--purge removes the profile)
  adam-mcp download FILE_ID --output-dir DIRECTORY --confirm
                       Save one selected file outside Git (256 MiB / 120 seconds)`);
}

export async function runStdio(
  configuredOverride?: Awaited<ReturnType<typeof createConfiguredProvider>>,
  streams?: { stdin: Readable; stdout: Writable },
  serve: typeof serveStdio = serveStdio,
  createServer?: () => ReturnType<typeof createAdamMcpServer>,
): Promise<void> {
  const configured = configuredOverride ?? await createConfiguredProvider();
  const name = detectProviderName();
  const banner =
    name === "fixture"
      ? "adam-mcp running on stdio (fixture provider (test harness))"
      : `adam-mcp running on stdio (${name} provider)`;
  console.error(banner);
  if (name === "browser") {
    console.error("Live ADAM: run `adam-mcp login` once, then the session runs headless.");
  }
  const transport = new StdioServerTransport(streams?.stdin, streams?.stdout);
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => { finish = resolve; });
  let completionError: unknown;
  let sdkClose: Promise<void> = Promise.resolve();
  let providerClose: Promise<void> | undefined;
  const closeProviderOnce = () => providerClose ??= closeConfiguredProvider(configured);
  let closing: Promise<void> | undefined;
  let handle: ReturnType<typeof serveStdio> | undefined;
  const shutdown = () => {
    if (!closing) {
      // Defer side effects until after `closing` is assigned: handle.close()
      // can synchronously emit transport close and signal another shutdown.
      closing = Promise.resolve().then(async () => {
        let sdkError: unknown;
        try {
          await handle?.close();
          await sdkClose;
        } catch (error) {
          sdkError = error;
        } finally {
          try {
            await closeProviderOnce();
          } catch (providerError) {
            throw sdkError === undefined ? providerError : new AggregateError([sdkError, providerError], "MCP and provider shutdown failed.");
          }
        }
        if (sdkError !== undefined) throw sdkError;
      });
      closing.then(() => finish(), (error: unknown) => { completionError = error; finish(); });
    }
    return closing;
  };
  const onSignal = () => {
    void shutdown().then(
      () => process.exit(0),
      (error: unknown) => { console.error(formatCliError(error)); process.exit(1); },
    );
  };
  const input = streams?.stdin ?? process.stdin;
  const output = streams?.stdout ?? process.stdout;
  const onInputError = () => { void shutdown(); };
  const onOutputError = () => { void shutdown(); };
  input.on("error", onInputError);
  output.on("error", onOutputError);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  let primaryError: unknown;
  try {
    handle = serve(() => {
      const product = createServer?.() ?? createAdamMcpServer(configured);
      const closeProduct = product.close.bind(product);
      product.close = () => {
        sdkClose = Promise.resolve().then(closeProduct);
        return sdkClose;
      };
      return product;
    }, { transport });
    // serveStdio installs its close callback synchronously before returning.
    // Preserve SDK teardown, await its product close (which the SDK does not
    // await for EOF), then release provider-owned resources.
    const sdkOnClose = transport.onclose;
    transport.onclose = () => {
      sdkOnClose?.();
      void (async () => {
        try {
          await sdkClose;
        } catch (error) {
          completionError = error;
        }
        try {
          await closeProviderOnce();
        } catch (error) {
          completionError = completionError === undefined ? error : new AggregateError([completionError, error], "MCP and provider shutdown failed.");
        }
        finish();
      })();
    };
    const sdkOnError = transport.onerror;
    transport.onerror = (error) => {
      sdkOnError?.(error);
      // The SDK reports malformed JSON here but continues serving. Actual
      // stream errors arrive on the streams themselves and close via onclose.
    };
    await closed;
    if (completionError !== undefined) throw completionError;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    input.off("error", onInputError);
    output.off("error", onOutputError);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (!providerClose) {
      try {
        await shutdown();
      } catch (cleanupError) {
        if (primaryError === undefined) throw cleanupError;
        console.error(formatCliError(cleanupError));
      }
    }
  }
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
    case "download": {
      if (detectProviderName() !== "browser") throw new AdamError("provider_unavailable", "Local downloads require the browser provider.", false);
      const { runDownloadCli } = await import("adam-provider-browser");
      await runDownloadCli(argv.slice(argv.indexOf(command) + 1));
      return;
    }
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
