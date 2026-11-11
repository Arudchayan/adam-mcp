import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createAdamMcpServer } from "../../packages/mcp/src/server.ts";

export async function host(provider) {
  const server = createAdamMcpServer({ provider });
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const pending = new Map();
  let nextId = 0;
  client.onmessage = (message) => { if ("id" in message) pending.get(message.id)?.(message); };
  await server.connect(transport);
  await client.start();
  async function request(method, params) {
    const id = ++nextId;
    const response = new Promise((done, fail) => {
      const timer = setTimeout(() => { pending.delete(id); fail(new Error(`timeout ${method}`)); }, 5000);
      pending.set(id, (value) => { clearTimeout(timer); pending.delete(id); done(value); });
    });
    await client.send({ jsonrpc: "2.0", id, method, params });
    return response;
  }
  const init = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "adversarial-qa", version: "1" } });
  assert.equal(init.error, undefined);
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return {
    request,
    notify: async (method, params) => {
      await client.send({ jsonrpc: "2.0", method, params });
      // MCP does not require a response after cancellation. End only the local
      // waiter; the reproduction separately checks the provider's signal.
      if (method === "notifications/cancelled") pending.get(params.requestId)?.({ locallyCancelled: true });
    },
    call: (name, args) => request("tools/call", { name, arguments: args }),
    resource: (uri) => request("resources/read", { uri }),
    close: async () => { await server.close(); await client.close(); },
  };
}
