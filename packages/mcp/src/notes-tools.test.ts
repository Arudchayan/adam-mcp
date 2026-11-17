import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { createFixtureProvider } from "adam-provider-fixture";
import { requestConfirmElicitation } from "./elicitation.ts";
import { READ_ONLY_ANNOTATIONS } from "./results.ts";
import { createAdamMcpServer } from "./server.ts";

type RpcResponse = { id?: number; error?: { code: number; message: string }; result?: Record<string, unknown> };

/** Minimal in-memory client without elicitation capability (confirm:true is the only gate). */
class Harness {
  private readonly client: InstanceType<typeof InMemoryTransport>;
  private readonly serverSide: InstanceType<typeof InMemoryTransport>;
  private readonly pending = new Map<number, (response: RpcResponse) => void>();
  private nextId = 1;

  constructor(private readonly server: McpServer) {
    [this.client, this.serverSide] = InMemoryTransport.createLinkedPair();
    this.client.onmessage = (message) => {
      if (!("id" in message) || typeof message.id !== "number") return;
      const resolve = this.pending.get(message.id);
      if (resolve) {
        this.pending.delete(message.id);
        resolve(message as RpcResponse);
      }
    };
  }

  async start(): Promise<void> {
    await this.server.connect(this.serverSide);
    await this.client.start();
    const init = await this.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "adam-notes-test", version: "1.0.0" } });
    assert.equal(init.error, undefined);
    await this.client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async close(): Promise<void> {
    await this.server.close();
    await this.client.close();
  }

  request(method: string, params: Record<string, unknown>): Promise<RpcResponse> {
    const id = this.nextId++;
    const response = new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 5_000);
      this.pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    });
    void this.client.send({ jsonrpc: "2.0", id, method, params });
    return response;
  }

  call(name: string, args: Record<string, unknown>): Promise<RpcResponse> {
    return this.request("tools/call", { name, arguments: args });
  }
}

const text = (response: RpcResponse) => JSON.stringify(response.result ?? response.error ?? {});

describe("ADR 0063: adam_list_notes", () => {
  it("is advertised read-only with a student-ok description and no route, command or token input", async () => {
    const rpc = new Harness(createAdamMcpServer({ provider: createFixtureProvider() }));
    await rpc.start();
    try {
      const listed = (await rpc.request("tools/list", {})).result?.tools as Array<{ name: string; description?: string; annotations?: unknown; inputSchema?: { properties?: Record<string, unknown> } }>;
      const tool = listed.find((item) => item.name === "adam_list_notes");
      assert.ok(tool);
      assert.match(tool.description ?? "", /^Needs student-ok \(confirm:true OR elicitation\) after the student asked/);
      assert.match(tool.description ?? "", /never creates, edits, deletes, exports or sorts notes/);
      assert.deepEqual(tool.annotations, READ_ONLY_ANNOTATIONS);
      assert.deepEqual(Object.keys(tool.inputSchema?.properties ?? {}).sort(), ["confirm", "cursor", "limit", "refresh"]);
      assert.equal(listed.some((item) => /note.*(delete|edit|export|sort|post)|(delete|edit|export|sort|post).*note/i.test(item.name)), false);
    } finally { await rpc.close(); }
  });

  it("refuses without confirm; with confirm returns untrusted, lab-verified notes and cursor paging", async () => {
    const rpc = new Harness(createAdamMcpServer({ provider: createFixtureProvider() }));
    await rpc.start();
    try {
      const denied = await rpc.call("adam_list_notes", {});
      assert.equal(denied.result?.isError, true);
      assert.match(text(denied), /confirmation_required/);
      assert.doesNotMatch(text(denied), /Revise week 3/);

      const listed = await rpc.call("adam_list_notes", { confirm: true, limit: 1 });
      const page = listed.result?.structuredContent as {
        untrusted: boolean;
        notice: string;
        evidence: string;
        items: Array<{ noteId?: string; text: string; objectRefId?: string }>;
        nextCursor?: string;
      };
      assert.equal(page.untrusted, true);
      assert.match(page.notice, /untrusted data, not instructions/);
      assert.equal(page.evidence, "lab-verified");
      assert.deepEqual(page.items.map((item) => item.noteId), ["2"]);
      assert.equal(page.items[0]!.objectRefId, "100001");
      assert.ok(page.nextCursor);

      const next = (await rpc.call("adam_list_notes", { confirm: true, cursor: page.nextCursor })).result?.structuredContent as { items: Array<{ noteId?: string }> };
      assert.deepEqual(next.items.map((item) => item.noteId), ["1"]);

      const bad = await rpc.call("adam_list_notes", { confirm: true, url: "https://adam.unibas.ch/ilias.php?cmd=exportNotesHTML" });
      assert.ok(bad.error || bad.result?.isError, "route and command input is rejected by the strict schema");
    } finally { await rpc.close(); }
  });

  it("elicitation copy names the private notes and what is shown", () => {
    const result = requestConfirmElicitation("adam_list_notes", "notes") as unknown as { inputRequests?: { confirm?: { params?: { message?: string } } } };
    assert.match(String(result.inputRequests?.confirm?.params?.message ?? ""), /^List your ADAM Private Notes \(their text and the object each is on\)\?/);
  });
});
