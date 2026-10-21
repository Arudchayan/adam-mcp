import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  InMemoryTransport,
  createMcpHandler,
  type McpServer,
} from "@modelcontextprotocol/server";
import { createFixtureProvider } from "adam-provider-fixture";
import { createAdamMcpServer } from "./server.ts";

const SENTINEL = "PRIVATE APPROVAL INTEGRATION BODY";
type Response = { id?: number; error?: unknown; result?: Record<string, unknown> };
type Decision = { action: string; content?: { confirm?: unknown } };
type Era = "2025-11-25" | "2026-07-28";

/** Legacy wire transport / modern fetch-shaped HTTP, both entirely in process. */
class Host {
  private readonly transports = InMemoryTransport.createLinkedPair();
  private readonly pending = new Map<number, (value: Response) => void>();
  private nextId = 1;
  elicitationCount = 0;
  onElicit?: () => void;
  onInputRequired?: () => void;

  constructor(private readonly server: McpServer, readonly era: Era, readonly capable = true,
    private readonly decision?: Decision, private readonly makeServer?: () => McpServer) {
    this.transports[0].onmessage = async (message) => {
      if ("method" in message && message.method === "elicitation/create") {
        this.elicitationCount++;
        this.onElicit?.();
        if (this.decision && "id" in message) {
          await this.transports[0].send({ jsonrpc: "2.0", id: message.id!, result: this.decision });
        }
      } else if ("id" in message && typeof message.id === "number") {
        this.pending.get(message.id)?.(message as Response);
      }
    };
  }

  async start() {
    if (this.era === "2026-07-28") return;
    await this.server.connect(this.transports[1]);
    await this.transports[0].start();
    if (this.era === "2025-11-25") {
      const init = await this.request("initialize", {
        protocolVersion: this.era, capabilities: this.capable ? { elicitation: { form: {} } } : {},
        clientInfo: { name: "approval-integration", version: "1" },
      });
      assert.equal(init.error, undefined);
      await this.transports[0].send({ jsonrpc: "2.0", method: "notifications/initialized" });
    }
  }

  async request(method: string, params: Record<string, unknown>): Promise<Response> {
    const id = this.nextId++;
    if (this.era === "2026-07-28") {
      params = { ...params, _meta: {
        [PROTOCOL_VERSION_META_KEY]: this.era,
        [CLIENT_CAPABILITIES_META_KEY]: this.capable ? { elicitation: { form: {} } } : {},
      } };
      assert.ok(this.makeServer);
      const handler = createMcpHandler(this.makeServer, { legacy: "reject", responseMode: "json" });
      const response = await handler.fetch(new Request("https://approval-test.invalid/mcp", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
          "Mcp-Method": method, "Mcp-Name": String(params.name), "Mcp-Protocol-Version": this.era },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      }));
      return await response.json() as Response;
    }
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Test RPC timeout")); }, 5_000);
      this.pending.set(id, (value) => { clearTimeout(timer); this.pending.delete(id); resolve(value); });
      void this.transports[0].send({ jsonrpc: "2.0", id, method, params }).catch(reject);
    });
  }

  async call(name: string, args: Record<string, unknown>, inputResponses?: Record<string, unknown>) {
    const params = { name, arguments: args };
    const first = await this.request("tools/call", params);
    if (this.era === "2026-07-28" && this.capable && args.confirm !== true) {
      assert.equal(first.error, undefined);
      assert.equal(first.result?.resultType, "input_required", JSON.stringify(first));
      assert.ok((first.result?.inputRequests as Record<string, unknown>)?.confirm);
      assert.equal(JSON.stringify(first).includes(SENTINEL), false);
      this.onInputRequired?.();
      return this.request("tools/call", { ...params, inputResponses: inputResponses ?? { confirm: this.decision } });
    }
    return first;
  }

  async close() { await this.server.close(); await this.transports[0].close(); }
}

const routes = [
  { name: "adam_read_page", method: "readPage", args: { refId: "100001" } },
  { name: "adam_extract_file_text", method: "extractFileText", args: { refId: "100011" } },
  { name: "adam_get_exercise", method: "getExercise", args: { refId: "100021" } },
  { name: "adam_get_forum", method: "getForum", args: { refId: "100040", threadId: "200001" } },
] as const;

async function fixture() {
  const provider = createFixtureProvider();
  const calls: string[] = [];
  const page = await provider.readPage("100001");
  const file = await provider.getFile("100011");
  const exercise = await provider.getExercise("100021");
  const forum = await provider.getForum("100040", { threadId: "200001" });
  provider.readPage = async () => { calls.push("readPage"); return { ...page, text: SENTINEL }; };
  provider.extractFileText = async () => { calls.push("extractFileText"); return {
    ...file, pages: [{ page: 1, text: SENTINEL }], truncated: false, sha256: "a".repeat(64),
  }; };
  provider.getExercise = async () => { calls.push("getExercise"); return {
    ...exercise, units: [{ title: "Instructions", instructionText: SENTINEL, ownStatus: "none" }],
  }; };
  provider.getForum = async (_refId, options) => { calls.push("getForum"); return options?.threadId ? {
    ...forum, selectedThread: { ...forum.selectedThread!,
      posts: forum.selectedThread!.posts.map((post) => ({ ...post, body: SENTINEL })),
    },
  } : { ...forum, selectedThread: undefined }; };
  const makeServer = () => createAdamMcpServer({ provider });
  return { server: makeServer(), makeServer, calls };
}

for (const era of ["2025-11-25", "2026-07-28"] as const) {
  describe(`actual body-tool approval over ${era}`, () => {
    for (const route of routes) {
      for (const decision of [
        { action: "accept", content: { confirm: true } },
        { action: "accept", content: { confirm: false } },
        { action: "accept", content: { confirm: "true" } },
        { action: "accept", content: {} },
        { action: "decline" }, { action: "cancel" },
      ]) {
        it(`${route.name}: ${JSON.stringify(decision)}`, async () => {
          const { server, calls, makeServer } = await fixture();
          const host = new Host(server, era, true, decision, makeServer);
          host.onElicit = host.onInputRequired = () => assert.deepEqual(calls, []);
          try {
            await host.start();
            const response = await host.call(route.name, route.args);
            const yes = decision.action === "accept" && decision.content?.confirm === true;
            assert.equal(response.error, undefined);
            assert.equal(response.result?.isError === true, !yes, JSON.stringify(response));
            if (!yes) assert.match(JSON.stringify(response), /confirmation_required/);
            assert.deepEqual(calls, yes ? [route.method] : []);
            assert.equal(JSON.stringify(response).includes(SENTINEL), yes);
            assert.equal(host.elicitationCount, era === "2025-11-25" ? 1 : 0);
          } finally { await host.close(); }
        });
      }

      it(`${route.name}: incapable host requires explicit true`, async () => {
        const { server, calls, makeServer } = await fixture();
        const host = new Host(server, era, false, undefined, makeServer);
        try {
          await host.start();
          for (const confirm of [undefined, false]) {
            const denied = await host.call(route.name, { ...route.args, ...(confirm === undefined ? {} : { confirm }) });
            assert.equal(denied.result?.isError, true);
            assert.equal(JSON.stringify(denied).includes(SENTINEL), false);
            assert.deepEqual(calls, []);
          }
          const allowed = await host.call(route.name, { ...route.args, confirm: true });
          assert.equal(allowed.result?.isError, undefined, JSON.stringify(allowed));
          assert.equal(JSON.stringify(allowed).includes(SENTINEL), true);
          assert.deepEqual(calls, [route.method]);
          assert.equal(host.elicitationCount, 0);
        } finally { await host.close(); }
      });
    }
    it("forum summaries do not request approval or expose post bodies", async () => {
      const { server, calls, makeServer } = await fixture();
      const host = new Host(server, era, true, undefined, makeServer);
      try {
        await host.start();
        const response = await host.request("tools/call", {
          name: "adam_get_forum", arguments: { refId: "100040" },
        });
        assert.equal(response.error, undefined);
        assert.equal(response.result?.isError, undefined);
        assert.notEqual(response.result?.resultType, "input_required");
        assert.equal(JSON.stringify(response).includes(SENTINEL), false);
        assert.deepEqual(calls, ["getForum"]);
        assert.equal(host.elicitationCount, 0);
      } finally { await host.close(); }
    });
  });
}

for (const route of routes) it(`${route.name}: legacy SDK timeout returns no body and makes no provider call`, async () => {
  const { server, calls } = await fixture();
  // Only shorten the SDK's test instance clock; production still uses its 10-minute timeout.
  (server.server as unknown as { _inputRequiredServing: { roundTimeoutMs: number } })
    ._inputRequiredServing.roundTimeoutMs = 25;
  const host = new Host(server, "2025-11-25", true);
  try {
    await host.start();
    const response = await host.call(route.name, route.args);
    assert.equal(response.result?.isError, true);
    assert.match(JSON.stringify(response), /timed out/i);
    assert.equal(JSON.stringify(response).includes(SENTINEL), false);
    assert.deepEqual(calls, []);
    assert.equal(host.elicitationCount, 1);
  } finally { await host.close(); }
});

for (const route of routes) it(`${route.name}: modern unfulfilled/empty re-entry grants no access`, async () => {
  const { server, calls, makeServer } = await fixture();
  const host = new Host(server, "2026-07-28", true, undefined, makeServer);
  host.onInputRequired = () => assert.deepEqual(calls, []);
  try {
    await host.start();
    // A modern host owns fulfilment/timeouts; an empty retry is still not approval.
    const response = await host.call(route.name, route.args, {});
    assert.equal(response.error, undefined);
    assert.equal(response.result?.isError, true);
    assert.match(JSON.stringify(response), /confirmation_required/);
    assert.equal(JSON.stringify(response).includes(SENTINEL), false);
    assert.deepEqual(calls, []);
  } finally { await host.close(); }
});
