import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRunId, logToolCall } from "./telemetry.ts";

describe("telemetry", () => {
  it("creates short, log-safe run ids", () => {
    assert.match(createRunId(), /^[0-9a-f]{8}$/);
    assert.notEqual(createRunId(), createRunId());
  });

  it("writes exactly one JSON line per call to stderr", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = ((line?: unknown) => {
      lines.push(String(line));
    }) as typeof console.error;
    try {
      logToolCall({
        ts: "2026-09-10T00:00:00.000Z",
        runId: "abcd1234",
        tool: "adam_list_children",
        outcome: "ok",
        ms: 12,
        listingState: "ok",
        partial: false,
      });
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!), {
      ts: "2026-09-10T00:00:00.000Z",
      runId: "abcd1234",
      tool: "adam_list_children",
      outcome: "ok",
      ms: 12,
      listingState: "ok",
      partial: false,
    });
  });
});
