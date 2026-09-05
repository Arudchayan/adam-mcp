import type { AdamErrorCode } from "./types.ts";

export class AdamError extends Error {
  readonly code: AdamErrorCode;
  readonly retryable: boolean;

  constructor(code: AdamErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "AdamError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isAdamError(error: unknown): error is AdamError {
  return error instanceof AdamError;
}
