import { AdamError } from "./errors.ts";
import { DEFAULT_ADAM_ORIGIN } from "./types.ts";

export const PRODUCTION_ADAM_ORIGIN = DEFAULT_ADAM_ORIGIN;

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
