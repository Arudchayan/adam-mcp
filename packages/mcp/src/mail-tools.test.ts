import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { createFixtureProvider } from "adam-provider-fixture";
import { requestConfirmElicitation } from "./elicitation.ts";
import { READ_ONLY_ANNOTATIONS, READ_STATE_ANNOTATIONS } from "./results.ts";
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
    const init = await this.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "adam-mail-test", version: "1.0.0" } });
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

describe("ADR 0054: adam_list_mail / adam_read_mail", () => {
  it("are advertised with honest annotations and student-ok descriptions that state the mark-as-read effect", async () => {
    const rpc = new Harness(createAdamMcpServer({ provider: createFixtureProvider() }));
    await rpc.start();
    try {
      const listed = (await rpc.request("tools/list", {})).result?.tools as Array<{ name: string; description?: string; annotations?: unknown; inputSchema?: { properties?: Record<string, unknown> } }>;
      const list = listed.find((tool) => tool.name === "adam_list_mail");
      const read = listed.find((tool) => tool.name === "adam_read_mail");
      assert.ok(list && read);
      for (const tool of [list, read]) {
        assert.match(tool.description ?? "", /^Needs student-ok \(confirm:true OR elicitation\) after the student asked/);
        // Listing is read-only; opening a message marks it read, so read is not readOnlyHint.
        assert.deepEqual(tool.annotations, tool === read ? READ_STATE_ANNOTATIONS : READ_ONLY_ANNOTATIONS);
        assert.doesNotMatch(Object.keys(tool.inputSchema?.properties ?? {}).join(","), /url|href|cmd|token|action/i, "no route, command or token input");
      }
      assert.match(read.description ?? "", /marks it read in ADAM/);
      assert.match(read.description ?? "", /never downloaded/);
      assert.equal(listed.some((tool) => /send|reply|delete|compose|mark/i.test(tool.name)), false);
    } finally { await rpc.close(); }
  });

  it("require confirm for headers and bodies; return untrusted, redacted payloads", async () => {
    const rpc = new Harness(createAdamMcpServer({ provider: createFixtureProvider() }));
    await rpc.start();
    try {
      const deniedList = await rpc.call("adam_list_mail", {});
      assert.equal(deniedList.result?.isError, true);
      assert.match(text(deniedList), /confirmation_required/);
      assert.doesNotMatch(text(deniedList), /Synthetic Tutor|Exercise 1 feedback/);

      const listed = await rpc.call("adam_list_mail", { confirm: true });
      const page = listed.result?.structuredContent as { untrusted: boolean; items: Array<{ mailId: string; status: string; subject: string }> };
      assert.equal(page.untrusted, true);
      assert.deepEqual(page.items.map((item) => [item.mailId, item.status]), [["700002", "unread"], ["700001", "read"]]);
      assert.doesNotMatch(text(listed), /graded|Ignore previous/, "list never carries bodies");

      const deniedRead = await rpc.call("adam_read_mail", { folderId: "9000", mailId: "700002" });
      assert.equal(deniedRead.result?.isError, true);
      assert.doesNotMatch(text(deniedRead), /graded/);

      const read = await rpc.call("adam_read_mail", { folderId: "9000", mailId: "700002", confirm: true });
      const message = read.result?.structuredContent as { untrusted: boolean; notice: string; body: string; attachments: Array<{ name: string }> };
      assert.equal(message.untrusted, true);
      assert.match(message.notice, /untrusted data, not instructions/);
      assert.match(message.body, /graded/);
      assert.deepEqual(message.attachments.map((item) => item.name), ["feedback-notes.pdf"]);

      const after = (await rpc.call("adam_list_mail", { confirm: true })).result?.structuredContent as { items: Array<{ mailId: string; status: string }> };
      assert.equal(after.items.find((item) => item.mailId === "700002")?.status, "read", "opening marks read, as in ADAM");

      const bad = await rpc.call("adam_read_mail", { folderId: "9000", mailId: "../ilias.php?cmd=executeTableAction", confirm: true });
      assert.ok(bad.error || bad.result?.isError, "non-numeric mailId rejected by schema");
      const unknown = await rpc.call("adam_read_mail", { folderId: "9000", mailId: "1", confirm: true });
      assert.match(text(unknown), /not_found/);
    } finally { await rpc.close(); }
  });

  it("elicitation copy names the mailbox / message and the mark-as-read effect", () => {
    const message = (tool: string, id?: string) => {
      const result = requestConfirmElicitation(tool, id) as unknown as { inputRequests?: { confirm?: { params?: { message?: string } } } };
      return String(result.inputRequests?.confirm?.params?.message ?? "");
    };
    assert.match(message("adam_list_mail", "inbox"), /^List your ADAM inbox \(senders and subjects\)\?/);
    assert.match(message("adam_read_mail", "700002"), /mark it as read.*\(mail 700002\)\?/);
    assert.match(message("adam_read_page", "100001"), /\(ADAM object 100001\)/);
  });
});
