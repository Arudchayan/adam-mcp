import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { createFixtureProvider } from "adam-provider-fixture";
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
    const init = await this.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "adam-staff-test", version: "1.0.0" } });
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

const STAFF_TOOLS = ["adam_list_course_members", "adam_get_exercise_grades"] as const;

describe("ADR 0060: adam_list_course_members / adam_get_exercise_grades", () => {
  it("are read-only, confirm-gated and take no route or command input", async () => {
    const rpc = new Harness(createAdamMcpServer({ provider: createFixtureProvider() }));
    await rpc.start();
    try {
      const listed = (await rpc.request("tools/list", {})).result?.tools as Array<{ name: string; description?: string; annotations?: unknown; inputSchema?: { properties?: Record<string, unknown> } }>;
      for (const name of STAFF_TOOLS) {
        const tool = listed.find((entry) => entry.name === name);
        assert.ok(tool, name);
        assert.match(tool.description ?? "", /^Needs student-ok \(confirm:true OR elicitation\)/);
        assert.match(tool.description ?? "", /lab-verified/);
        assert.deepEqual(tool.annotations, READ_ONLY_ANNOTATIONS);
        assert.deepEqual(Object.keys(tool.inputSchema?.properties ?? {}).sort(), ["confirm", "refId", "type"]);
      }
      assert.equal(listed.some((tool) => /grade_?set|save|enrol|remove|add_member/i.test(tool.name)), false);
    } finally { await rpc.close(); }
  });

  it("refuse without confirm, then report forbidden for a student, and reject the wrong type", async () => {
    const rpc = new Harness(createAdamMcpServer({ provider: createFixtureProvider() }));
    await rpc.start();
    try {
      for (const [name, refId] of [["adam_list_course_members", "100001"], ["adam_get_exercise_grades", "100021"]] as const) {
        const denied = await rpc.call(name, { refId });
        assert.equal(denied.result?.isError, true);
        assert.match(text(denied), /confirmation_required/);

        const forbidden = await rpc.call(name, { refId, confirm: true });
        assert.equal(forbidden.result?.isError, true);
        assert.match(text(forbidden), /forbidden/);
        assert.match(text(forbidden), /tutor or course-admin only/);
      }
      const wrong = await rpc.call("adam_get_exercise_grades", { refId: "100001", confirm: true });
      assert.equal(wrong.result?.isError, true);
      assert.match(text(wrong), /unsupported_type|not an exercise/);
    } finally { await rpc.close(); }
  });
});
