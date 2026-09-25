import { AdamError, type AdamProvider } from "adam-core";
import { createFixtureProvider } from "adam-provider-fixture";
import type { SessionController } from "./server.ts";

export type ProviderName = "fixture" | "browser" | "soap" | "html";

/** In-process stdio tests only. Not a user-facing switch. */
export const TEST_FIXTURE_HARNESS_ENV = "ADAM_MCP_TEST_FIXTURE";

export type ConfiguredProvider = {
  provider: AdamProvider;
  session?: SessionController;
};

type Closeable = {
  close(): Promise<void>;
};

function isCloseable(value: unknown): value is Closeable {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    typeof (value as Closeable).close === "function"
  );
}

function isTestFixtureHarness(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env[TEST_FIXTURE_HARNESS_ENV] ?? "").trim() === "1";
}

export function parseProviderName(raw: string | undefined): "browser" {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === "browser") {
    return "browser";
  }
  switch (value) {
    case "fixture":
      throw new AdamError(
        "provider_unavailable",
        'ADAM_PROVIDER="fixture" is not a runtime provider. The synthetic catalog is test-only. Omit ADAM_PROVIDER or set ADAM_PROVIDER=browser.',
        false,
      );
    case "soap":
    case "html":
      throw new AdamError(
        "provider_unavailable",
        `ADAM_PROVIDER="${value}" is disabled (fail-closed). Use browser (the default). Enabling requires an ADR.`,
        false,
      );
    default:
      throw new AdamError(
        "provider_unavailable",
        `Unknown ADAM_PROVIDER="${raw ?? ""}". Use browser (the default).`,
        false,
      );
  }
}

export function detectProviderName(
  env: Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv,
): ProviderName {
  if (argv.includes("--browser")) {
    return "browser";
  }
  if (isTestFixtureHarness(env)) {
    return "fixture";
  }
  return parseProviderName(env.ADAM_PROVIDER);
}

export async function createConfiguredProvider(
  name: ProviderName = detectProviderName(),
): Promise<ConfiguredProvider> {
  switch (name) {
    case "fixture":
      return { provider: createFixtureProvider() };
    case "browser": {
      const { createBrowserProvider } = await import("adam-provider-browser");
      const provider = createBrowserProvider();
      return { provider, session: provider };
    }
    case "soap":
    case "html":
      throw new AdamError(
        "provider_unavailable",
        `ADAM_PROVIDER="${name}" is disabled (fail-closed). Use browser (the default). Enabling requires an ADR.`,
        false,
      );
    default: {
      const exhaustive: never = name;
      throw new AdamError("provider_unavailable", `Unhandled provider ${String(exhaustive)}`);
    }
  }
}

export async function closeConfiguredProvider(configured: ConfiguredProvider): Promise<void> {
  // Duck-type close so in-process fixture tests never import BrowserAdamProvider for instanceof.
  if (isCloseable(configured.provider)) {
    await configured.provider.close();
  }
}
