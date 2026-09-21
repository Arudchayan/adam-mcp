import { AdamError, type AdamProvider } from "adam-core";
import { createFixtureProvider } from "adam-provider-fixture";
import type { SessionController } from "./server.ts";

export type ProviderName = "fixture" | "browser" | "soap" | "html";

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

export function parseProviderName(raw: string | undefined): ProviderName {
  const value = (raw ?? "fixture").trim().toLowerCase();
  switch (value) {
    case "fixture":
    case "browser":
      return value;
    case "soap":
    case "html":
      throw new AdamError(
        "provider_unavailable",
        `ADAM_PROVIDER="${value}" is disabled (fail-closed). Use fixture or browser. Enabling requires an ADR.`,
        false,
      );
    default:
      throw new AdamError(
        "provider_unavailable",
        `Unknown ADAM_PROVIDER="${raw ?? ""}". Use fixture or browser.`,
        false,
      );
  }
}

export function detectProviderName(): ProviderName {
  if (process.argv.includes("--browser")) {
    return "browser";
  }
  return parseProviderName(process.env.ADAM_PROVIDER);
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
        `ADAM_PROVIDER="${name}" is disabled (fail-closed). Use fixture or browser. Enabling requires an ADR.`,
        false,
      );
    default: {
      const exhaustive: never = name;
      throw new AdamError("provider_unavailable", `Unhandled provider ${String(exhaustive)}`);
    }
  }
}

export async function closeConfiguredProvider(configured: ConfiguredProvider): Promise<void> {
  // Duck-type close so fixture mode never imports BrowserAdamProvider for instanceof.
  if (isCloseable(configured.provider)) {
    await configured.provider.close();
  }
}
