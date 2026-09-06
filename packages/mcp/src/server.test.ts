import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createFixtureProvider, GOLDEN_TST_REF_ID } from "adam-provider-fixture";
import {
  ConfirmGate,
  fail,
  ok,
  READ_ONLY_TOOLS,
  SESSION_TOOLS,
  UntrustedContent,
  UNTRUSTED_PAGE_NOTICE,
} from "./results.ts";
import { createAdamMcpServer } from "./server.ts";
import { untrustedExtractOutputSchema, untrustedPageOutputSchema } from "./schemas.ts";

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
    const result = ok(UntrustedContent.wrap(extracted));
    assert.match(result.content[0]?.text ?? "", /multimedia retrieval/i);
    assert.equal(result.structuredContent?.untrusted, true);
    assert.equal(result.structuredContent?.notice, UNTRUSTED_PAGE_NOTICE);
    assert.equal("bytes" in (result.structuredContent ?? {}), false);
    assert.doesNotMatch(result.content[0]?.text ?? "", /%PDF-/);
  });

  it("B4: ConfirmGate rejects omit/false; accepts literal true", () => {
    assert.throws(
      () => ConfirmGate.requireTrue(undefined, "adam_read_page"),
      (error: unknown) => {
        assert.ok(error instanceof AdamError);
        assert.equal(error.code, "confirmation_required");
        assert.match(error.message, /confirm: true/i);
        assert.match(error.message, /not an OS permission/i);
        return true;
      },
    );
    assert.throws(
      () => ConfirmGate.requireTrue(false, "adam_extract_file_text"),
      (error: unknown) => {
        assert.ok(error instanceof AdamError);
        assert.equal(error.code, "confirmation_required");
        return true;
      },
    );
    assert.throws(() => ConfirmGate.requireTrue("true", "adam_read_page"), AdamError);
    assert.doesNotThrow(() => ConfirmGate.requireTrue(true, "adam_read_page"));

    const denied = fail(
      new AdamError(
        "confirmation_required",
        "adam_read_page requires confirm: true (schema gate after the student asked to read). Not an OS permission dialog.",
      ),
    );
    assert.equal(denied.isError, true);
    assert.match(denied.content[0]?.text ?? "", /^confirmation_required:/);
    assert.match(denied.content[0]?.text ?? "", /confirm: true/);
  });

  it("B6: page and extract payloads require untrusted: true and a notice string", async () => {
    const provider = createFixtureProvider();

    const pageWrapped = UntrustedContent.wrap(await provider.readPage("100001"));
    assert.equal(pageWrapped.untrusted, true);
    assert.equal(typeof pageWrapped.notice, "string");
    assert.ok(pageWrapped.notice.length > 0);
    assert.equal(pageWrapped.notice, UntrustedContent.NOTICE);
    assert.match(pageWrapped.notice, /untrusted/i);
    assert.equal(untrustedPageOutputSchema.safeParse(pageWrapped).success, true);

    const extractWrapped = UntrustedContent.wrap(await provider.extractFileText("100011"));
    assert.equal(extractWrapped.untrusted, true);
    assert.equal(typeof extractWrapped.notice, "string");
    assert.ok(extractWrapped.notice.length > 0);
    assert.equal(extractWrapped.notice, UntrustedContent.NOTICE);
    assert.match(extractWrapped.notice, /untrusted/i);
    assert.equal(untrustedExtractOutputSchema.safeParse(extractWrapped).success, true);

    // Fail-closed shape: omitting notice must not satisfy the advertised schemas.
    const { notice: _pageNotice, ...pageWithoutNotice } = pageWrapped;
    assert.equal(untrustedPageOutputSchema.safeParse(pageWithoutNotice).success, false);
    const { notice: _extractNotice, ...extractWithoutNotice } = extractWrapped;
    assert.equal(untrustedExtractOutputSchema.safeParse(extractWithoutNotice).success, false);
  });

  it("B10: golden tst fail-closed on read/get; omitted from happy-path lists", async () => {
    const provider = createFixtureProvider();
    const deny = (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unsupported_type");
      assert.match(error.message, /tst/i);
      assert.match(error.message, /not sent to the model/i);
      assert.doesNotMatch(error.message, /DFT|Answer key|BLOCKED EXAM/i);
      return true;
    };
    await assert.rejects(() => provider.readPage(GOLDEN_TST_REF_ID), deny);
    await assert.rejects(() => provider.getCourse(GOLDEN_TST_REF_ID), deny);
    await assert.rejects(() => provider.getExercise(GOLDEN_TST_REF_ID), deny);

    const denied = fail(
      new AdamError(
        "unsupported_type",
        `ADAM object type "tst" (${GOLDEN_TST_REF_ID}) is blocked. Tests and exams are not sent to the model.`,
      ),
    );
    assert.equal(denied.isError, true);
    assert.match(denied.content[0]?.text ?? "", /^unsupported_type:/);
    assert.match(denied.content[0]?.text ?? "", /tst/);
    assert.doesNotMatch(denied.content[0]?.text ?? "", /DFT|Answer key|BLOCKED EXAM/i);

    const children = await provider.listChildren("100001");
    assert.deepEqual(
      children.items.map((item) => item.refId),
      ["100010", "100020", "100021"],
    );
    assert.equal(children.items.some((item) => item.type === "tst"), false);
    const search = await provider.search("BLOCKED EXAM CONTENT");
    assert.equal(search.items.length, 0);
  });
});
