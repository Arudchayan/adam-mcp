import { AdamError } from "adam-core";

export type AuthorizedHttpKind = "fetch" | "probe" | "goto";

/** Map non-OK ADAM HTTP status to the shared error taxonomy (ADR 0016). */
export function adamErrorFromAuthorizedHttpStatus(
  status: number,
  kind: AuthorizedHttpKind,
): AdamError {
  const noun = nounForKind(kind);
  if (status === 404) {
    return new AdamError("not_found", `ADAM returned HTTP 404 for a ${noun}.`);
  }
  if (status === 401) {
    return new AdamError(
      "unauthorized",
      `ADAM returned HTTP 401 for a ${noun}. Run adam_login or \`npm run login\` and complete SWITCH edu-ID in Chrome.`,
    );
  }
  if (status === 403) {
    return new AdamError(
      "forbidden",
      `ADAM returned HTTP 403 for a ${noun}. Access is denied for this account — the object is not reported as missing.`,
    );
  }
  if (status === 429) {
    return new AdamError(
      "provider_unavailable",
      `ADAM rate-limited (HTTP 429) a ${noun}. Retry later.`,
    );
  }
  if (status >= 500 && status <= 599) {
    return new AdamError(
      "provider_unavailable",
      `ADAM returned HTTP ${status} for a ${noun}. Retry later.`,
    );
  }
  return new AdamError(
    "provider_unavailable",
    `ADAM returned HTTP ${status} for a ${noun}.`,
  );
}

/**
 * After `page.goto`, map a main-document HTTP failure through ADR 0016.
 * Missing response (download abort / ERR_ABORTED — ADR 0013) is not an HTTP
 * denial — leave the throw path / caller to handle it.
 */
export function rejectIfGotoHttpFailed(
  response: { ok(): boolean; status(): number } | null | undefined,
): void {
  if (!response) {
    return;
  }
  if (!response.ok()) {
    throw adamErrorFromAuthorizedHttpStatus(response.status(), "goto");
  }
}

/**
 * Map typed Playwright navigation / network failures to retryable upstream errors.
 * Returns undefined for unexpected bugs so ADR 0011 keeps retryable=false.
 */
export function adamErrorFromNavigationFailure(error: unknown): AdamError | undefined {
  if (error instanceof AdamError) {
    return undefined;
  }
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (
    name === "TimeoutError" ||
    /Timeout \d+ms exceeded|page\.goto: Timeout|Navigation timeout|timed out/i.test(message) ||
    /net::ERR_|NS_ERROR_NET|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(
      message,
    )
  ) {
    const detail = message.replace(/\s+/g, " ").trim().slice(0, 200);
    return new AdamError(
      "provider_unavailable",
      `ADAM page navigation failed (${detail}). Retry; if it keeps failing, check the Chrome ADAM session.`,
    );
  }
  return undefined;
}

function nounForKind(kind: AuthorizedHttpKind): string {
  switch (kind) {
    case "fetch":
      return "file fetch";
    case "probe":
      return "file probe";
    case "goto":
      return "page navigation";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
