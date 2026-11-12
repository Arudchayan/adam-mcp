import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { AdamError, type AdamObject, type Paginated } from "adam-core";
import { createFixtureProvider } from "adam-provider-fixture";
import { fail, formatAdamFailText, sanitizeListingItems, sanitizeListingObject, UntrustedContent } from "./results.ts";
import { createAdamMcpServer } from "./server.ts";
import { createBrowserProvider } from "../../provider-browser/src/browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../../provider-browser/src/memory-session.ts";
import { resolveForumThreadUrl } from "../../provider-browser/src/forum-parse.ts";

const RPC_TIMEOUT_MS = 5_000;

type RpcResponse = {
  id?: number;
  error?: { code: number; message: string };
  result?: Record<string, unknown>;
};

class ProtocolHarness {
  private readonly clientTransport: InstanceType<typeof InMemoryTransport>;
  private readonly serverTransport: InstanceType<typeof InMemoryTransport>;
  private readonly pending = new Map<number, (response: RpcResponse) => void>();
  private nextId = 1;

  constructor(private readonly server: McpServer) {
    [this.clientTransport, this.serverTransport] = InMemoryTransport.createLinkedPair();
    this.clientTransport.onmessage = (message) => {
      if (!("id" in message) || typeof message.id !== "number") {
        return;
      }
      const resolve = this.pending.get(message.id);
      if (resolve) {
        this.pending.delete(message.id);
        resolve(message as RpcResponse);
      }
    };
  }

  async start(): Promise<void> {
    await this.server.connect(this.serverTransport);
    await this.clientTransport.start();
    const initialized = await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "adam-facade-guards-test", version: "1.0.0" },
    });
    assert.equal(initialized.error, undefined);
    await this.clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
  }

  async close(): Promise<void> {
    await this.server.close();
    await this.clientTransport.close();
  }

  async request(method: string, params: Record<string, unknown>): Promise<RpcResponse> {
    const id = this.nextId++;
    const response = new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for a response to ${method}.`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    try {
      await this.clientTransport.send({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    return response;
  }
}

function toolResult(response: RpcResponse): Record<string, unknown> {
  assert.equal(response.error, undefined, response.error?.message);
  assert.ok(response.result);
  assert.equal(response.result.isError, undefined, JSON.stringify(response.result.content ?? []));
  assert.ok(response.result.structuredContent);
  return response.result.structuredContent as Record<string, unknown>;
}

async function resourceJson(rpc: ProtocolHarness, uri: string): Promise<Record<string, unknown>> {
  const response = await rpc.request("resources/read", { uri });
  assert.equal(response.error, undefined, response.error?.message);
  const contents = response.result?.contents as Array<{ text?: string }> | undefined;
  assert.ok(contents?.[0]?.text, `No text content for ${uri}`);
  return JSON.parse(contents[0].text) as Record<string, unknown>;
}

describe("resource error redaction", () => {
  it("redacts all provider error paths while preserving recovery semantics", async () => {
    const provider = createFixtureProvider();
    let failure: unknown;
    provider.getFile = async () => { throw failure; };
    const rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();
    try {
      for (const code of ["unauthorized", "forbidden", "stale_id", "provider_unavailable", "unsupported_type", "confirmation_required", "cancelled"] as const) {
        failure = new AdamError(code, "Synthetic password=RESOURCE_SENTINEL", true);
        const response = await rpc.request("resources/read", { uri: "adam://file/100011" });
        assert.ok(response.error);
        assert.doesNotMatch(JSON.stringify(response), /RESOURCE_SENTINEL/);
        assert.match(response.error.message, new RegExp(`${code}:`));
        assert.match(response.error.message, /retryable=true/);
      }
      failure = new Error("Synthetic password=RESOURCE_SENTINEL");
      const unknown = await rpc.request("resources/read", { uri: "adam://file/100011" });
      assert.ok(unknown.error);
      assert.doesNotMatch(JSON.stringify(unknown), /RESOURCE_SENTINEL/);
      failure = new AdamError("not_found", "password=RESOURCE_SENTINEL");
      const missing = await rpc.request("resources/read", { uri: "adam://file/100011" });
      assert.equal(missing.error?.code, -32602);
      assert.doesNotMatch(JSON.stringify(missing), /RESOURCE_SENTINEL/);
    } finally {
      await rpc.close();
    }
  });
});

describe("forum summary boundary", () => {
  it("strips over-returned bodies on both summary routes but preserves approved posts", async () => {
    const provider = createFixtureProvider();
    const forum = await provider.getForum("100040", { threadId: "200001" });
    assert.ok(forum.selectedThread?.posts[0]);
    forum.selectedThread.posts[0].body = "SYNTHETIC_POST_BODY";
    const overreturned = { ...forum, posts: [{ body: "SYNTHETIC_EXTRA_BODY" }], threads: forum.threads.map(t => ({ ...t, body: "SYNTHETIC_EXTRA_BODY" })) };
    provider.getForum = async () => overreturned;
    const rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();
    try {
      const summary = await rpc.request("tools/call", { name: "adam_get_forum", arguments: { refId: "100040" } });
      assert.ok(toolResult(summary).threads);
      assert.doesNotMatch(JSON.stringify(summary), /SYNTHETIC_(POST|EXTRA)_BODY/);
      const resource = await resourceJson(rpc, "adam://frm/100040");
      assert.ok(resource.threads);
      assert.doesNotMatch(JSON.stringify(resource), /SYNTHETIC_(POST|EXTRA)_BODY/);
      const denied = await rpc.request("tools/call", { name: "adam_get_forum", arguments: { refId: "100040", threadId: "200001" } });
      assert.doesNotMatch(JSON.stringify(denied), /SYNTHETIC_POST_BODY/);
      const approved = await rpc.request("tools/call", { name: "adam_get_forum", arguments: { refId: "100040", threadId: "200001", confirm: true } });
      assert.match(JSON.stringify(toolResult(approved)), /SYNTHETIC_POST_BODY/);
    } finally { await rpc.close(); }
  });

  it("browser provider does not return post bodies on summary routes even when landing on synthetic thread HTML", async () => {
    const origin = "https://adam.unibas.ch";
    const forumUrl = `${origin}/go/frm/100040`;
    const threadUrl = resolveForumThreadUrl(origin, "100040", "200001");
    const html = '<main><h1>Thread A</h1><div class="ilFrmPostContentContainer"><a id="300001"></a><div class="ilFrmPostTitle">Thread A</div><div class="ilFrmPostContent">BROWSER_SYNTHETIC_BODY</div></div><a href="/logout.php">Abmelden</a></main>';
    const provider = createBrowserProvider({ session: createMemorySession({
      [forumUrl]: snapshotFromHtml(threadUrl, "Thread A", html, "Thread A BROWSER_SYNTHETIC_BODY Abmelden"),
    }) });
    const direct = await provider.getForum("100040");
    assert.doesNotMatch(JSON.stringify(direct), /BROWSER_SYNTHETIC_BODY/);
    const rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();
    try {
      const summary = await rpc.request("tools/call", { name: "adam_get_forum", arguments: { refId: "100040" } });
      assert.ok(toolResult(summary));
      const resource = await resourceJson(rpc, "adam://frm/100040");
      assert.doesNotMatch(JSON.stringify([summary, resource]), /BROWSER_SYNTHETIC_BODY/);
    } finally { await rpc.close(); }
  });
});

function withUnits(object: AdamObject): AdamObject {
  return {
    ...object,
    units: [{ title: "Unit draft", instructionText: "SECRET INSTRUCTION TEXT", ownStatus: "none" }],
  } as AdamObject;
}

function withTst(object: AdamObject, refId = "100099"): AdamObject {
  return {
    ...object,
    type: "tst",
    refId,
    title: "Midterm exam",
    url: `https://adam.unibas.ch/go/tst/${refId}`,
  };
}

describe("sanitizeListingItems", () => {
  const allowed: AdamObject = {
    type: "fold",
    refId: "100010",
    title: "Notes",
    url: "https://adam.unibas.ch/go/fold/100010",
    breadcrumb: [],
    provenance: { sourceUrl: "https://adam.unibas.ch/go/fold/100010", fetchedAt: "2026-09-10T00:00:00.000Z", provider: "fixture" },
  };
  const exercise: AdamObject = { ...allowed, type: "exc", refId: "100021", title: "Exercise 1" };
  const nested = (): AdamObject =>
    ({
      ...exercise,
      children: [withUnits({ ...allowed, type: "exc", refId: "100022" }), withTst(allowed)],
    }) as AdamObject;

  it("drops denied types and strips units recursively without rewriting provider counts", () => {
    const page: Paginated<AdamObject> = {
      items: [allowed, withUnits(nested()), withTst(allowed)],
      nextCursor: "3",
      totalHint: 27,
      listingState: "unknown",
      listingSignals: { contentItemCount: 27, emptyCopy: false, chromeOnly: false },
    };
    const safe = sanitizeListingItems(page);
    assert.deepEqual(safe.items.map((item) => item.refId), ["100010", "100021"]);
    const kept = safe.items[1]!;
    assert.equal("units" in kept, false);
    const children = (kept as { children?: Array<Record<string, unknown>> }).children ?? [];
    assert.deepEqual(children.map((child) => child.refId), ["100022"]);
    assert.equal("units" in (children[0] ?? {}), false);
    // Provider-reported pagination and listing honesty signals stay untouched.
    assert.equal(safe.totalHint, 27);
    assert.equal(safe.listingSignals?.contentItemCount, 27);
    assert.equal(safe.listingState, "unknown");
    assert.equal(safe.nextCursor, "3");
  });

  it("drops every denied row without inventing counts", () => {
    const page: Paginated<AdamObject> = { items: [withTst(allowed)], totalHint: 4, listingState: "ok" };
    const safe = sanitizeListingItems(page);
    assert.deepEqual(safe.items, []);
    assert.equal(safe.totalHint, 4);
    assert.equal(safe.listingState, "ok");
  });

  it("returns the same page when there is nothing to scrub", () => {
    const page: Paginated<AdamObject> = { items: [allowed], listingState: "ok" };
    assert.equal(sanitizeListingItems(page), page);
    const empty: Paginated<AdamObject> = { items: [], listingState: "empty", totalHint: 0 };
    assert.equal(sanitizeListingItems(empty), empty);
  });

  it("subtracts leaked rows on empty listings without inventing a tree", () => {
    const page: Paginated<AdamObject> = {
      items: [allowed],
      totalHint: 4,
      listingState: "empty",
      listingSignals: { contentItemCount: 0, emptyCopy: true, chromeOnly: false },
    };
    const safe = sanitizeListingItems(page);
    assert.deepEqual(safe.items, []);
    assert.equal(safe.listingState, "empty");
    assert.equal(safe.totalHint, 0);
  });

  it("subtracts leaked rows on unknown/blank listings without claiming ok", () => {
    const page: Paginated<AdamObject> = {
      items: [allowed],
      totalHint: 4,
      listingState: "unknown",
      listingSignals: { contentItemCount: 0, emptyCopy: false, chromeOnly: false },
      notice: "The folder view rendered a blank content area",
    };
    const safe = sanitizeListingItems(page);
    assert.deepEqual(safe.items, []);
    assert.equal(safe.listingState, "unknown");
    assert.equal("totalHint" in safe, false);
    assert.match(safe.notice ?? "", /blank content area/i);
  });

  it("sanitizes a single object with nested children", () => {
    const course = sanitizeListingObject({
      ...allowed,
      children: [withUnits(nested()), withTst(allowed)],
    } as AdamObject);
    assert.equal("units" in course, false);
    assert.deepEqual(course.children?.map((child) => child.refId), ["100021"]);
    const first = course.children?.[0];
    assert.equal("units" in (first ?? {}), false);
    assert.deepEqual(first?.children?.map((child) => child.refId), ["100022"]);
    assert.equal("units" in (first?.children?.[0] ?? {}), false);
  });
});

describe("facade listing guards", () => {
  let rpc: ProtocolHarness | undefined;

  afterEach(async () => {
    await rpc?.close();
    rpc = undefined;
  });

  it("preserves unknown folder diagnostics across children, files and resource reads", async () => {
    const provider = createFixtureProvider();
    const unknown = {
      items: [],
      listingState: "unknown" as const,
      listingSignals: { contentItemCount: 0, emptyCopy: false, chromeOnly: true },
      notice: "The folder view rendered a blank content area; check access in ADAM. password=fixture-secret",
    };
    provider.listChildren = async () => unknown;
    provider.listFiles = async () => unknown;
    rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();

    const results = [
      toolResult(await rpc.request("tools/call", {
        name: "adam_list_children", arguments: { refId: "100010", type: "fold" },
      })),
      toolResult(await rpc.request("tools/call", {
        name: "adam_list_files", arguments: { refId: "100010", type: "fold" },
      })),
      await resourceJson(rpc, "adam://fold/100010"),
    ];
    for (const result of results) {
      assert.equal(result.listingState, "unknown");
      assert.deepEqual(result.items, []);
      assert.equal("totalHint" in result, false);
      assert.deepEqual(result.listingSignals, unknown.listingSignals);
      assert.equal(result.untrusted, true);
      assert.match(String(result.notice), /untrusted/i);
      assert.match(String(result.listingNotice), /blank content area; check access in ADAM/i);
      assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
    }
  });

  it("never surfaces denied types or exercise units when a provider leaks them", async () => {
    const provider = createFixtureProvider();

    const originalChildren = provider.listChildren.bind(provider);
    provider.listChildren = async (refId, options) => {
      const listed = await originalChildren(refId, options);
      const example = listed.items[0];
      assert.ok(example);
      return {
        ...listed,
        notice: "Listed successfully; no child objects.",
        items: [
          ...listed.items.map((item) => (item.refId === "100021" ? withUnits(item) : item)),
          withTst(example),
        ],
      };
    };

    const originalSearch = provider.search.bind(provider);
    provider.search = async (query, options) => {
      const listed = await originalSearch(query, options);
      const example = listed.items[0];
      assert.ok(example);
      return {
        ...listed,
        items: [
          ...listed.items.map((item) => (item.refId === "100021" ? withUnits(item) : item)),
          withTst(example),
        ],
      };
    };

    const originalCourses = provider.listCourses.bind(provider);
    provider.listCourses = async (options) => {
      const listed = await originalCourses(options);
      const example = listed.items[0];
      assert.ok(example);
      return { ...listed, items: [...listed.items, withTst(example)] };
    };

    const originalCourse = provider.getCourse.bind(provider);
    provider.getCourse = async (refId) => {
      const course = await originalCourse(refId);
      return {
        ...course,
        children: [
          withUnits({ ...course, type: "exc", refId: "100021", title: "Exercise 1" } as AdamObject),
          withTst(course),
        ],
      };
    };

    rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();

    const children = toolResult(
      await rpc.request("tools/call", { name: "adam_list_children", arguments: { refId: "100001" } }),
    );
    const childItems = children.items as Array<Record<string, unknown>>;
    assert.equal(children.untrusted, true);
    assert.equal(children.notice, UntrustedContent.DATA_NOTICE);
    assert.equal(children.listingNotice, "Listed successfully; no child objects.");
    assert.equal(childItems.some((item) => item.type === "tst" || item.refId === "100099"), false);
    assert.ok(childItems.some((item) => item.refId === "100010"), "allowed children survive");
    const listedExercise = childItems.find((item) => item.refId === "100021");
    assert.ok(listedExercise);
    assert.equal("units" in listedExercise, false);
    assert.doesNotMatch(JSON.stringify(childItems), /SECRET INSTRUCTION TEXT/);

    const found = toolResult(
      await rpc.request("tools/call", { name: "adam_search", arguments: { query: "Retrieval summary" } }),
    );
    const hits = found.items as Array<Record<string, unknown>>;
    assert.equal(hits.some((item) => item.type === "tst" || item.refId === "100099"), false);
    assert.ok(hits.some((item) => item.refId === "100021"), "allowed search hits survive");
    assert.doesNotMatch(JSON.stringify(hits), /SECRET INSTRUCTION TEXT/);

    const courses = toolResult(
      await rpc.request("tools/call", { name: "adam_list_courses", arguments: {} }),
    );
    const courseItems = courses.items as Array<Record<string, unknown>>;
    assert.equal(courseItems.some((item) => item.type === "tst" || item.refId === "100099"), false);
    assert.ok(courseItems.some((item) => item.refId === "100001"), "allowed courses survive");

    const files = toolResult(
      await rpc.request("tools/call", { name: "adam_list_files", arguments: { refId: "100010" } }),
    );
    const fileItems = files.items as Array<Record<string, unknown>>;
    assert.equal(fileItems.some((item) => item.type === "tst" || item.refId === "100099"), false);
    assert.ok(fileItems.some((item) => item.refId === "100011"), "allowed files survive");

    const course = toolResult(
      await rpc.request("tools/call", { name: "adam_get_course", arguments: { refId: "100001" } }),
    );
    const childSummaries = (course.children ?? []) as Array<Record<string, unknown>>;
    assert.deepEqual(childSummaries.map((item) => item.refId), ["100021"]);
    assert.equal("units" in childSummaries[0]!, false);
    assert.doesNotMatch(JSON.stringify(course), /SECRET INSTRUCTION TEXT/);

    const meCourses = await resourceJson(rpc, "adam://me/courses");
    assert.equal(meCourses.untrusted, true);
    assert.equal(typeof meCourses.notice, "string");
    const meItems = meCourses.items as Array<Record<string, unknown>>;
    assert.equal(meItems.some((item) => item.type === "tst" || item.refId === "100099"), false);
    assert.ok(meItems.some((item) => item.refId === "100001"), "allowed rows survive the courses resource");

    const folder = await resourceJson(rpc, "adam://fold/100001");
    const folderItems = folder.items as Array<Record<string, unknown>>;
    assert.equal(folderItems.some((item) => item.type === "tst" || item.refId === "100099"), false);
    const folderExercise = folderItems.find((item) => item.refId === "100021");
    assert.ok(folderExercise);
    assert.equal("units" in folderExercise, false);
    assert.doesNotMatch(JSON.stringify(folderItems), /SECRET INSTRUCTION TEXT/);

    const crs = await resourceJson(rpc, "adam://crs/100001");
    const crsChildren = (crs.children ?? []) as Array<Record<string, unknown>>;
    assert.deepEqual(crsChildren.map((item) => item.refId), ["100021"]);
    assert.equal("units" in crsChildren[0]!, false);
    assert.doesNotMatch(JSON.stringify(crs), /SECRET INSTRUCTION TEXT/);
  });
});

describe("resource error parity with tools (ADR 0016)", () => {
  let rpc: ProtocolHarness | undefined;

  afterEach(async () => {
    if (rpc) {
      await rpc.close();
      rpc = undefined;
    }
  });

  it("resources/read forbidden surfaces fail() code text, not ResourceNotFound", async () => {
    const provider = createFixtureProvider();
    const deniedError = new AdamError(
      "forbidden",
      "Access is denied for this course (not reported as missing).",
      false,
    );
    provider.getCourse = async () => {
      throw deniedError;
    };

    rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();

    const denied = await rpc.request("resources/read", { uri: "adam://crs/100001" });
    assert.equal(denied.result, undefined);
    assert.ok(denied.error, "forbidden resource read must be an RPC error");
    assert.notEqual(denied.error.code, -32602, "forbidden must not look like not_found");
    assert.doesNotMatch(denied.error.message, /Resource not found/i);

    const expected = formatAdamFailText(deniedError);
    assert.ok(
      denied.error.message.includes(expected),
      `expected host message to include tool fail() line "${expected}", got "${denied.error.message}"`,
    );
    assert.equal((fail(deniedError).content[0] as { text: string }).text, expected);
    // ADR 0020 parity: same one-line carries retryable + runId.
    assert.match(denied.error.message, /forbidden:/);
    assert.match(denied.error.message, /retryable=false/);
    assert.match(denied.error.message, /runId=[0-9a-f]{8}/);
  });

  it("resources/read adam://me/courses unauthorized surfaces fail() code text, not ResourceNotFound", async () => {
    const provider = createFixtureProvider();
    const authError = new AdamError("unauthorized", "ADAM session is not signed in.", true);
    provider.listCourses = async () => {
      throw authError;
    };

    rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();

    const denied = await rpc.request("resources/read", { uri: "adam://me/courses" });
    assert.equal(denied.result, undefined);
    assert.ok(denied.error, "unauthorized courses resource read must be an RPC error");
    assert.notEqual(denied.error.code, -32602, "unauthorized must not look like not_found");
    assert.match(denied.error.message, /unauthorized:/);

    const expected = formatAdamFailText(authError);
    assert.ok(
      denied.error.message.includes(expected),
      `expected host message to include tool fail() line "${expected}", got "${denied.error.message}"`,
    );
    // ADR 0020 parity: retryable=true preserved with runId.
    assert.match(denied.error.message, /retryable=true/);
    assert.match(denied.error.message, /runId=[0-9a-f]{8}/);
  });

  it("resources/read stale_id surfaces fail() code text, not ResourceNotFound", async () => {
    const provider = createFixtureProvider();
    const staleError = new AdamError(
      "stale_id",
      "Object id is stale; refresh the listing before retrying.",
      false,
    );
    provider.getCourse = async () => {
      throw staleError;
    };

    rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();

    const denied = await rpc.request("resources/read", { uri: "adam://crs/100001" });
    assert.equal(denied.result, undefined);
    assert.ok(denied.error, "stale_id resource read must be an RPC error");
    assert.notEqual(denied.error.code, -32602, "stale_id must not look like not_found");
    assert.match(denied.error.message, /stale_id:/);

    const expected = formatAdamFailText(staleError);
    assert.ok(
      denied.error.message.includes(expected),
      `expected host message to include tool fail() line "${expected}", got "${denied.error.message}"`,
    );
    assert.match(denied.error.message, /retryable=false/);
    assert.match(denied.error.message, /runId=[0-9a-f]{8}/);
  });

  it("resources/read provider_unavailable surfaces retryable + runId, not ResourceNotFound", async () => {
    const provider = createFixtureProvider();
    const transient = new AdamError("provider_unavailable", "Chrome is not available.", true);
    provider.getCourse = async () => {
      throw transient;
    };

    rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();

    const denied = await rpc.request("resources/read", { uri: "adam://crs/100001" });
    assert.equal(denied.result, undefined);
    assert.ok(denied.error, "provider_unavailable resource read must be an RPC error");
    assert.notEqual(denied.error.code, -32602, "provider_unavailable must not look like not_found");
    assert.match(denied.error.message, /provider_unavailable:/);
    assert.match(denied.error.message, /retryable=true/);
    assert.match(denied.error.message, /runId=[0-9a-f]{8}/);
    const expected = formatAdamFailText(transient);
    assert.ok(
      denied.error.message.includes(expected),
      `expected host message to include tool fail() line "${expected}", got "${denied.error.message}"`,
    );
  });
});
