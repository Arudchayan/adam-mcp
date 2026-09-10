import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import type { AdamObject, Paginated } from "adam-core";
import { createFixtureProvider } from "adam-provider-fixture";
import { sanitizeListingItems } from "./results.ts";
import { createAdamMcpServer } from "./server.ts";

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
    const response = new Promise<RpcResponse>((resolve) => this.pending.set(id, resolve));
    await this.clientTransport.send({ jsonrpc: "2.0", id, method, params });
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

function withUnits(object: AdamObject): AdamObject {
  return {
    ...object,
    units: [{ title: "Unit draft", instructionText: "SECRET INSTRUCTION TEXT", ownStatus: "none" }],
  } as AdamObject;
}

function withTst(object: AdamObject): AdamObject {
  return {
    ...object,
    type: "tst",
    refId: "100099",
    title: "Midterm exam",
    url: "https://adam.unibas.ch/go/tst/100099",
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

  it("drops denied types, strips units, and keeps listing counts honest", () => {
    const page: Paginated<AdamObject> = {
      items: [allowed, withUnits(exercise), withTst(allowed)],
      totalHint: 3,
      listingState: "ok",
      listingSignals: { contentItemCount: 3, emptyCopy: false, chromeOnly: false },
    };
    const safe = sanitizeListingItems(page);
    assert.deepEqual(safe.items.map((item) => item.refId), ["100010", "100021"]);
    assert.equal("units" in safe.items[1]!, false);
    assert.equal(safe.totalHint, 2);
    assert.equal(safe.listingSignals?.contentItemCount, 2);
    assert.equal(safe.listingState, "ok");
  });

  it("returns the same page when there is nothing to scrub", () => {
    const page: Paginated<AdamObject> = { items: [allowed], listingState: "ok" };
    assert.equal(sanitizeListingItems(page), page);
  });
});

describe("facade listing guards", () => {
  let rpc: ProtocolHarness | undefined;

  afterEach(async () => {
    await rpc?.close();
    rpc = undefined;
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

    rpc = new ProtocolHarness(createAdamMcpServer({ provider }));
    await rpc.start();

    const children = toolResult(
      await rpc.request("tools/call", { name: "adam_list_children", arguments: { refId: "100001" } }),
    );
    const childItems = children.items as Array<Record<string, unknown>>;
    assert.equal(childItems.some((item) => item.type === "tst" || item.refId === "100099"), false);
    const listedExercise = childItems.find((item) => item.refId === "100021");
    assert.ok(listedExercise);
    assert.equal("units" in listedExercise, false);
    assert.doesNotMatch(JSON.stringify(childItems), /SECRET INSTRUCTION TEXT/);

    const found = toolResult(
      await rpc.request("tools/call", { name: "adam_search", arguments: { query: "Retrieval summary" } }),
    );
    const hits = found.items as Array<Record<string, unknown>>;
    assert.equal(hits.some((item) => item.type === "tst" || item.refId === "100099"), false);
    assert.doesNotMatch(JSON.stringify(hits), /SECRET INSTRUCTION TEXT/);

    const courses = toolResult(
      await rpc.request("tools/call", { name: "adam_list_courses", arguments: {} }),
    );
    const courseItems = courses.items as Array<Record<string, unknown>>;
    assert.equal(courseItems.some((item) => item.type === "tst" || item.refId === "100099"), false);

    const folder = await rpc.request("resources/read", { uri: "adam://fold/100001" });
    assert.equal(folder.error, undefined, folder.error?.message);
    const folderText = JSON.stringify(folder.result?.contents ?? []);
    assert.doesNotMatch(folderText, /"type": "tst"/);
    assert.doesNotMatch(folderText, /SECRET INSTRUCTION TEXT/);
  });
});
