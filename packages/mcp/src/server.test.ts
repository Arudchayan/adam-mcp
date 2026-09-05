import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createFixtureProvider } from "adam-provider-fixture";
import { fail, ok, READ_ONLY_TOOLS, SESSION_TOOLS } from "./results.ts";
import { createAdamMcpServer } from "./server.ts";

describe("read-only MCP facade", () => {
  it("exposes the student-focused v1 tools and no write tools", () => {
    assert.deepEqual([...READ_ONLY_TOOLS], [
      "adam_list_courses",
      "adam_get_course",
      "adam_list_children",
      "adam_read_page",
      "adam_list_files",
      "adam_get_file",
      "adam_extract_file_text",
      "adam_get_exercise",
      "adam_search",
      "adam_list_calendar",
      "adam_list_news",
    ]);
    assert.equal(READ_ONLY_TOOLS.some((name) => name.includes("post") || name.includes("submit")), false);
    assert.deepEqual([...SESSION_TOOLS], ["adam_login", "adam_session_status"]);
  });

  it("builds a server against the fixture provider", () => {
    const server = createAdamMcpServer({ provider: createFixtureProvider() });
    assert.equal(typeof server, "object");
    assert.notEqual(server, null);
  });

  it("marks AdamError results as tool errors", () => {
    const result = fail(new AdamError("not_found", "missing"));
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? "", /^not_found:/);
  });

  it("returns JSON text and structuredContent for successful payloads", () => {
    const result = ok({ refId: "100001" });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0]?.text ?? "", /"refId": "100001"/);
    assert.equal(result.structuredContent?.refId, "100001");
  });

  it("extracts fixture file text without bytes in the MCP payload", async () => {
    const provider = createFixtureProvider();
    const extracted = await provider.extractFileText("100011");
    const result = ok({ untrusted: true, ...extracted });
    assert.match(result.content[0]?.text ?? "", /multimedia retrieval/i);
    assert.equal("bytes" in (result.structuredContent ?? {}), false);
    assert.doesNotMatch(result.content[0]?.text ?? "", /%PDF-/);
  });
});
