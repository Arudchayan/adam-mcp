import { AdamError } from "./errors.ts";
import { DEFAULT_ADAM_ORIGIN } from "./types.ts";

export const PRODUCTION_ADAM_ORIGIN = DEFAULT_ADAM_ORIGIN;

/**
 * Live browser is selected via ADAM_PROVIDER=browser or --browser.
 * Kept in core so resolveAdamOrigin can refuse ADAM_ALLOW_TEST_ORIGIN without
 * depending on packages/mcp provider wiring.
 */
export function isLiveBrowserProviderSelected(
  env: Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  if (argv.includes("--browser")) {
    return true;
  }
  return (env.ADAM_PROVIDER ?? "").trim().toLowerCase() === "browser";
}

export function resolveAdamOrigin(raw?: string): string {
  const candidate = (raw ?? process.env.ADAM_ORIGIN ?? PRODUCTION_ADAM_ORIGIN).trim().replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new AdamError("provider_unavailable", "ADAM_ORIGIN is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new AdamError("provider_unavailable", "ADAM_ORIGIN must use HTTPS.");
  }
  if (process.env.ADAM_ALLOW_TEST_ORIGIN === "1") {
    if (isLiveBrowserProviderSelected()) {
      throw new AdamError(
        "provider_unavailable",
        "ADAM_ALLOW_TEST_ORIGIN=1 is refused when the live browser provider is selected (ADAM_PROVIDER=browser or --browser). Use the fixture provider for test origins.",
        false,
      );
    }
    return candidate;
  }
  if (candidate !== PRODUCTION_ADAM_ORIGIN) {
    throw new AdamError(
      "provider_unavailable",
      `ADAM_ORIGIN must be ${PRODUCTION_ADAM_ORIGIN} (set ADAM_ALLOW_TEST_ORIGIN=1 only in tests).`,
    );
  }
  return candidate;
}
