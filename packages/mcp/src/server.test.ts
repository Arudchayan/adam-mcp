import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AdamError } from "adam-core";
import { createFixtureProvider, GOLDEN_TST_REF_ID } from "adam-provider-fixture";
import {
  ConfirmGate,
  fail,
  ok,
  READ_ONLY_TOOLS,
  ResourceLinks,
  SESSION_TOOLS,
  toolText,
  UntrustedContent,
  UNTRUSTED_PAGE_NOTICE,
} from "./results.ts";
import { createAdamMcpServer } from "./server.ts";
import { untrustedExtractOutputSchema, untrustedPageOutputSchema } from "./schemas.ts";

const here = dirname(fileURLToPath(import.meta.url));

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

  it("marks more provider errors as tool errors", () => {
    const result = fail(new AdamError("not_found", "missing"));
    assert.equal(result.isError, true);
    assert.match(toolText(result), /^not_found:/);
    assert.match(toolText(result), /retryable=false/);
  });

  it("surfaces retryability and run ids on failures", () => {
    const transient = fail(new AdamError("provider_unavailable", "Chrome is not available."), "deadbeef");
    assert.equal(transient.isError, true);
    assert.match(toolText(transient), /retryable=true/);
    assert.match(toolText(transient), /runId=deadbeef/);
  });

  it("returns JSON text and structuredContent for successful payloads", () => {
    const result = ok({ refId: "100001" });
    assert.equal(result.isError, undefined);
    assert.match(toolText(result), /"refId": "100001"/);
    assert.equal(result.structuredContent?.refId, "100001");
    assert.deepEqual(ok(null).structuredContent, { value: null });
    assert.deepEqual(ok(1).structuredContent, { value: 1 });
    assert.deepEqual(ok(true).structuredContent, { value: true });
  });

  it("extracts fixture file text without bytes in the MCP payload", async () => {
    const provider = createFixtureProvider();
    const extracted = await provider.extractFileText("100011");
    const result = ok(UntrustedContent.wrap(extracted));
    assert.match(toolText(result), /multimedia retrieval/i);
    assert.equal(result.structuredContent?.untrusted, true);
    assert.equal(result.structuredContent?.notice, UNTRUSTED_PAGE_NOTICE);
    assert.equal("bytes" in (result.structuredContent ?? {}), false);
    assert.doesNotMatch(toolText(result), /%PDF-/);
  });

  it("keeps provider listing notices when wrapping untrusted content", () => {
    const wrapped = UntrustedContent.wrap(
      { items: [], notice: "Listed successfully; no files." },
      UntrustedContent.DATA_NOTICE,
    );
    assert.equal(wrapped.notice, UntrustedContent.DATA_NOTICE);
    assert.equal(wrapped.listingNotice, "Listed successfully; no files.");
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
    assert.match(toolText(denied), /^confirmation_required:/);
    assert.match(toolText(denied), /confirm: true/);
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
    assert.match(toolText(denied), /^unsupported_type:/);
    assert.match(toolText(denied), /tst/);
    assert.doesNotMatch(toolText(denied), /DFT|Answer key|BLOCKED EXAM/i);

    const children = await provider.listChildren("100001");
    assert.deepEqual(
      children.items.map((item) => item.refId),
      ["100010", "100020", "100021"],
    );
    assert.equal(children.items.some((item) => item.type === "tst"), false);
    const search = await provider.search("BLOCKED EXAM CONTENT");
    assert.equal(search.items.length, 0);
  });

  it("B11: server capabilities omit Sampling, Roots, and Logging; no HTTP transport wiring", () => {
    const server = createAdamMcpServer({ provider: createFixtureProvider() });
    const capabilities = server.server.getCapabilities();
    assert.equal("sampling" in capabilities, false);
    assert.equal("roots" in capabilities, false);
    assert.equal("logging" in capabilities, false);
    assert.equal(capabilities.tools?.listChanged, true);
    assert.equal(capabilities.resources?.listChanged, true);
    assert.equal(capabilities.prompts?.listChanged, true);

    const wiringFiles = ["index.ts", "server.ts", "providers.ts", "results.ts"] as const;
    const forbidden =
      /\boauth\b|\bauthorize\b|sampling\/createMessage|roots\/list|logging\/setLevel|sendLoggingMessage|StreamableHTTP|SSEServerTransport|serveHttp|createMcpHandler/i;
    for (const file of wiringFiles) {
      const source = readFileSync(resolve(here, file), "utf8");
      assert.equal(
        forbidden.test(source),
        false,
        `${file} must not wire Sampling/Roots/Logging client APIs, OAuth, or HTTP MCP transports`,
      );
    }
  });

  it("B12: fixture server wiring exposes no oauth/authorize tools or routes", () => {
    const server = createAdamMcpServer({ provider: createFixtureProvider() });
    const toolNames = Object.keys(server["_registeredTools"] as Record<string, unknown>);
    assert.equal(toolNames.some((name) => /oauth|authorize/i.test(name)), false);
    assert.equal(toolNames.includes("adam_login"), false);
    assert.equal(READ_ONLY_TOOLS.some((name) => /oauth|authorize/i.test(name)), false);

    const indexSource = readFileSync(resolve(here, "index.ts"), "utf8");
    assert.match(indexSource, /serveStdio/);
    assert.doesNotMatch(indexSource, /\boauth\b|\bauthorize\b|StreamableHTTP|SSEServerTransport|serveHttp/i);
    assert.match(indexSource, /ADAM_PROVIDER|detectProviderName|createConfiguredProvider/);
  });
});

describe("A1 resource links in tool results", () => {
  it("ok() enriches adam:// handles and keeps canonical HTTPS citations", async () => {
    const provider = createFixtureProvider();
    const course = await provider.getCourse("100001");
    const result = ok(course);
    assert.equal(result.structuredContent?.url, "https://adam.unibas.ch/go/crs/100001");
    assert.equal(result.structuredContent?.resourceUri, "adam://crs/100001");
    assert.match(toolText(result), /adam:\/\/crs\/100001/);
    assert.match(toolText(result), /https:\/\/adam\.unibas\.ch\/go\/crs\/100001/);
    const link = result.content.find((block) => block.type === "resource_link");
    assert.equal(link?.type, "resource_link");
    if (link && link.type === "resource_link") {
      assert.equal(link.uri, "adam://crs/100001");
    }

    const listed = ok(await provider.listCourses());
    const items = listed.structuredContent?.items as Array<{ resourceUri?: string; url?: string }>;
    assert.equal(items[0]?.resourceUri, "adam://crs/100001");
    assert.equal(items[0]?.url, "https://adam.unibas.ch/go/crs/100001");

    // FAIL shape: bare refId / HTTPS-only must not be the only citation form.
    assert.notEqual(ResourceLinks.forRecord({ refId: "100001" }), "adam://crs/100001");
    assert.equal(ResourceLinks.forRecord({ type: "crs", refId: "100001" }), "adam://crs/100001");
  });
});

describe("A6 resources for read-by-id", () => {
  it("keeps existing get tools as thin wrappers; does not add duplicate get-by-id tools", () => {
    const server = createAdamMcpServer({ provider: createFixtureProvider() });
    const toolNames = Object.keys(server["_registeredTools"] as Record<string, unknown>);
    const getById = toolNames.filter((name) => /^adam_get_/.test(name));
    assert.deepEqual(getById.sort(), ["adam_get_course", "adam_get_exercise", "adam_get_file"]);
    assert.equal(toolNames.some((name) => /adam_get_folder|adam_get_page|adam_get_by_id/.test(name)), false);

    const resources = Object.keys(server["_registeredResources"] as Record<string, unknown>);
    assert.equal(resources.includes("adam://me/courses"), true);
    const templates = Object.keys(server["_registeredResourceTemplates"] as Record<string, unknown>).sort();
    assert.deepEqual(templates, ["adam-course", "adam-exercise", "adam-file", "adam-folder"]);
  });
});
