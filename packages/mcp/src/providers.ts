import { AdamError, type AdamProvider } from "adam-core";
import { BrowserAdamProvider, createBrowserProvider } from "adam-provider-browser";
import { createFixtureProvider } from "adam-provider-fixture";
import { createHtmlProvider } from "adam-provider-html";
import { createSoapProvider } from "adam-provider-soap";
import type { SessionController } from "./server.ts";

export type ProviderName = "fixture" | "browser" | "soap" | "html";

export type ConfiguredProvider = {
  provider: AdamProvider;
  session?: SessionController;
};

export function parseProviderName(raw: string | undefined): ProviderName {
  const value = (raw ?? "fixture").trim().toLowerCase();
  switch (value) {
    case "fixture":
    case "browser":
    case "soap":
    case "html":
      return value;
    default:
      throw new AdamError(
        "provider_unavailable",
        `Unknown ADAM_PROVIDER="${raw ?? ""}". Use fixture, browser, soap, or html.`,
      );
  }
}

export function detectProviderName(): ProviderName {
  if (process.argv.includes("--browser")) {
    return "browser";
  }
  return parseProviderName(process.env.ADAM_PROVIDER);
}

export function createConfiguredProvider(
  name: ProviderName = detectProviderName(),
): ConfiguredProvider {
  switch (name) {
    case "fixture":
      return { provider: createFixtureProvider() };
    case "browser": {
      const provider = createBrowserProvider();
      return { provider, session: provider };
    }
    case "soap":
      return { provider: createSoapProvider() };
    case "html":
      return { provider: createHtmlProvider() };
    default: {
      const exhaustive: never = name;
      throw new AdamError("provider_unavailable", `Unhandled provider ${String(exhaustive)}`);
    }
  }
}

export async function closeConfiguredProvider(configured: ConfiguredProvider): Promise<void> {
  if (configured.provider instanceof BrowserAdamProvider) {
    await configured.provider.close();
  }
}
