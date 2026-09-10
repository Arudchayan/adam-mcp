import { randomUUID } from "node:crypto";

/**
 * One JSON line per tool call on stderr (stdout is JSON-RPC only).
 * Local, redacted, no payload contents.
 */
export type ToolCallLog = {
  ts: string;
  runId: string;
  tool: string;
  outcome: "ok" | "error";
  ms: number;
  code?: string;
  retryable?: boolean;
  listingState?: string;
  partial?: boolean;
  skipped?: number;
};

export function createRunId(): string {
  return randomUUID().slice(0, 8);
}

export function logToolCall(entry: ToolCallLog): void {
  console.error(JSON.stringify(entry));
}
