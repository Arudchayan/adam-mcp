import type { AdamErrorCode } from "./types.ts";

/** Transient failures worth one retry; everything else needs user action. */
const RETRYABLE_CODES: ReadonlySet<AdamErrorCode> = new Set(["provider_unavailable"]);

export class AdamError extends Error {
  readonly code: AdamErrorCode;
  readonly retryable: boolean;

  constructor(code: AdamErrorCode, message: string, retryable = RETRYABLE_CODES.has(code)) {
    super(message);
    this.name = "AdamError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isAdamError(error: unknown): error is AdamError {
  return error instanceof AdamError;
}

/** Cooperative cancellation shared by all providers (ADR 0011). */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AdamError("cancelled", "Request was cancelled by the client.", false);
  }
}
