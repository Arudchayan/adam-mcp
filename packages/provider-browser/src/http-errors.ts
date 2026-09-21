import { AdamError } from "adam-core";

/**
 * Map ADAM HTTP status from authorized fetch/probe to actionable AdamError codes.
 * 404 → not_found; 401 → unauthorized; 403 → forbidden; 429/5xx → retryable
 * provider_unavailable. Never label 429/5xx as not_found.
 */
export function adamErrorForHttpStatus(status: number, action: "fetch" | "probe"): AdamError {
  const label = action === "fetch" ? "file fetch" : "file probe";
  if (status === 404) {
    return new AdamError("not_found", `ADAM returned HTTP 404 for a ${label}.`, false);
  }
  if (status === 401) {
    return new AdamError("unauthorized", `ADAM returned HTTP 401 for a ${label}.`, false);
  }
  if (status === 403) {
    return new AdamError("forbidden", `ADAM returned HTTP 403 for a ${label}.`, false);
  }
  if (status === 429) {
    return new AdamError(
      "provider_unavailable",
      `ADAM rate-limited the ${label} (HTTP 429). Wait and retry.`,
      true,
    );
  }
  if (status >= 500 && status <= 599) {
    return new AdamError("provider_unavailable", `ADAM returned HTTP ${status} for a ${label}.`, true);
  }
  return new AdamError("provider_unavailable", `ADAM returned HTTP ${status} for a ${label}.`, false);
}
