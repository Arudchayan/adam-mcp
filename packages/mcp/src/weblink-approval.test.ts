import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserProvider } from "../../provider-browser/src/browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../../provider-browser/src/memory-session.ts";
// @ts-expect-error The protocol QA harness is JavaScript without declarations.
import { host } from "../../../scripts/qa/mcp-harness.mjs";

test("Web Link destination resolution stays behind the page approval gate over JSON-RPC", async () => {
  const url = "https://adam.unibas.ch/go/webr/710002";
  const route = "/ilias.php?baseClass=ilLinkResourceHandlerGUI&cmdClass=ilObjLinkResourceGUI&cmd=callLink&ref_id=710002&link_id=720001";
  const session = createMemorySession({ [url]: snapshotFromHtml(url, "Synthetic Web Link", `<main><a href="${route}">x</a></main>`, "x") });
  let resolved = 0;
  session.resolveWebLink = async () => { resolved++; return { url: "https://example.org/", sourceUrl: "https://adam.unibas.ch" + route }; };
  const provider = createBrowserProvider({ session });
  const rpc = await host(provider);
  try {
    const omitted = await rpc.call("adam_read_page", { refId: "710002", type: "webr" });
    assert.match(JSON.stringify(omitted), /confirmation_required/);
    assert.equal(resolved, 0);
    const approved = await rpc.call("adam_read_page", { refId: "710002", type: "webr", confirm: true });
    assert.equal(approved.result.isError, undefined);
    assert.equal(approved.result.structuredContent.untrusted, true);
    assert.equal(approved.result.structuredContent.destinations.length, 1);
    assert.equal(resolved, 1);
  } finally { await rpc.close(); await provider.close(); }
});
