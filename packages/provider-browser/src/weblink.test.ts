import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseAdamRef } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import { readWebLinkRedirect, webLinkLaunchUrl } from "./weblink.ts";

const capture = JSON.parse(readFileSync(new URL("../qa/weblink-captures/selected-link.json", import.meta.url), "utf8"));
const selected = snapshotFromHtml(capture.selected.url, "x", capture.selected.html, "x");
const route = webLinkLaunchUrl(selected.links.find((link) => webLinkLaunchUrl(link.href, "710002"))!.href, "710002")!;

test("permitted scrubbed listing capture supplies row-local Web Link identity", async () => {
  const listing = snapshotFromHtml(capture.listing.url, "x", capture.listing.html, "x");
  const session = createMemorySession({ [capture.listing.url]: listing });
  const provider = createBrowserProvider({ session });
  try {
    const children = await provider.listChildren("710001", { type: "crs" });
    assert.equal(children.listingState, "ok");
    assert.equal(children.items.find((item) => item.refId === "710002")?.type, "webr");
    const source = listing.links.find((link) => link.href.includes("calldirectlink"))!.href;
    assert.deepEqual(parseAdamRef(source), { type: "webr", refId: "710002" });
    assert.equal(parseAdamRef(source + "&item_ref_id=710003")?.type, "unknown");
    assert.equal(parseAdamRef(source + "&cmdClass=ilobjtestgui")?.type, "tst");
    assert.equal(parseAdamRef(source + "&cmd=delete")?.type, "unknown");
    assert.equal(capture.rawHtmlSaved, false);
    assert.equal(capture.externalNavigation, false);
    assert.doesNotMatch(JSON.stringify(capture), /\b\d{7,}\b|github\.com|cookie|password|token=/i);
  } finally { await provider.close(); }
});

test("only selected reads resolve redirect metadata, never listings or external destinations", async () => {
  const session = createMemorySession({ [capture.listing.url]: snapshotFromHtml(capture.listing.url, "x", capture.listing.html, "x"), [capture.selected.url]: selected });
  let requests = 0;
  session.resolveWebLink = (href, refId, options) => readWebLinkRedirect(href, refId, {
    headers: async () => ({ Cookie: "synthetic-only" }),
    fetch: async (target, options) => {
      requests++;
      assert.equal(new URL(String(target)).origin, "https://adam.unibas.ch");
      assert.equal(options?.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "https://example.org/course?token=SYNTHETIC" } });
    },
  }, options?.signal);
  const provider = createBrowserProvider({ session });
  try {
    await provider.listChildren("710001", { type: "crs" });
    assert.equal(requests, 0);
    const result = await provider.readPage("710002", { type: "webr" });
    assert.equal(result.destinations?.length, 1);
    assert.match(result.destinations![0]!.url, /^https:\/\/example.org/);
    assert.doesNotMatch(result.destinations![0]!.url, /SYNTHETIC/);
    assert.equal(new URL(result.destinations![0]!.sourceUrl).origin, "https://adam.unibas.ch");
    assert.match(result.destinationNotice!, /no external destination was fetched/);
    assert.equal(requests, 1);
  } finally { await provider.close(); }
});

test("route mutation corpus fails before cookie acquisition or network", async () => {
  const valid = new URL(route);
  const mutations = [
    route.replace("https:", "http:"), route.replace("adam.unibas.ch", "example.org"),
    route.replace("https://", "https://user:pass@"), route + "#fragment",
    route + "&cmd=delete", route + "&CMD=callLink", route + "&return=https://example.org",
    route.replace("callLink", "deleteLink"), route.replace("710002", "710003"),
    route.replace("720001", "not-numeric"), route.replace("ilObjLinkResourceGUI", "ilObjTestGUI"),
    route + "&item_ref_id=710003", route.replace("/ilias.php", "/logout.php"),
  ];
  assert.ok(webLinkLaunchUrl(valid.href, "710002"));
  for (const href of mutations) {
    assert.equal(webLinkLaunchUrl(href, "710002"), undefined, href);
    await assert.rejects(readWebLinkRedirect(href, "710002", {
      headers: async () => { throw new Error("cookies must not be read"); },
      fetch: async () => { throw new Error("must not fetch"); },
    }), /not a verified/);
  }
});

test("unsafe and unresolved destinations are not guessed or followed", async () => {
  for (const location of ["http://example.org/", "https://user:pass@example.org/", "javascript:alert(1)", "/go/webr/710002"]) {
    let calls = 0;
    const result = await readWebLinkRedirect(route, "710002", { headers: async () => ({}), fetch: async () => {
      calls++; return new Response(null, { status: 302, headers: { Location: location } });
    } });
    assert.equal(result, undefined);
    assert.equal(calls, 1);
  }
  assert.equal(await readWebLinkRedirect(route, "710002", { headers: async () => ({}), fetch: async () => new Response("not read") }), undefined);
  for (const status of [401, 403, 429, 503]) {
    await assert.rejects(readWebLinkRedirect(route, "710002", { headers: async () => ({}), fetch: async () => new Response(null, { status }) }));
  }
});

test("recognized ADAM and SWITCH authentication redirects remain unauthorized", async () => {
  for (const location of ["/login.php", "/shib_login.php", "/ilias.php?baseClass=ilStartUpGUI&cmd=showLogin", "https://login.eduid.ch/idp/profile/SAML2/Redirect/SSO", "https://wayf.switch.ch/", "https://aai.unibas.ch/"]) {
    await assert.rejects(readWebLinkRedirect(route, "710002", { headers: async () => ({}), fetch: async () =>
      new Response(null, { status: 302, headers: { Location: location } }) }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "unauthorized");
  }
});

test("vendor-signed query credentials and fragments are omitted without guessing key names", async () => {
  const result = await readWebLinkRedirect(route, "710002", { headers: async () => ({}), fetch: async () =>
    new Response(null, { status: 302, headers: { Location: "https://example.org/material.pdf?X-Amz-Signature=SECRET&X-Amz-Credential=CREDENTIAL&unknown_vendor_secret=HIDDEN#access_token=FRAGMENT" } }) });
  assert.equal(result?.url, "https://example.org/");
  assert.doesNotMatch(JSON.stringify(result), /SECRET|CREDENTIAL|HIDDEN|FRAGMENT/);
});

test("path bearer capabilities are not disclosed; only established public repository identities retain paths", async () => {
  for (const location of ["https://join.slack.com/t/workspace/shared_invite/zt-SECRET", "https://example.org/s/SECRET/material.pdf", "https://github.com/login/SECRET", "https://example.org/unknown-capability/SECRET"]) {
    const result = await readWebLinkRedirect(route, "710002", { headers: async () => ({}), fetch: async () =>
      new Response(null, { status: 302, headers: { Location: location } }) });
    assert.equal(new URL(result!.url).pathname, "/");
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
  const result = await readWebLinkRedirect(route, "710002", { headers: async () => ({}), fetch: async () =>
    new Response(null, { status: 302, headers: { Location: "https://github.com/example/teaching-materials?token=SECRET" } }) });
  assert.equal(result?.url, "https://github.com/example/teaching-materials");
});

test("cancelled credentials cannot trigger a late redirect request", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  const pending = readWebLinkRedirect(route, "710002", { headers: async () => { await gate; return {}; }, fetch: async () => { requests++; return new Response(); } }, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests, 0);
});

test("selected redirect resolution is capped and explicitly reports incomplete inventory", async () => {
  const links = Array.from({ length: 10 }, (_, index) => `<a href="${route.replace("720001", String(720001 + index))}">x</a>`).join("");
  const session = createMemorySession({ [capture.selected.url]: snapshotFromHtml(capture.selected.url, "x", `<main>${links}</main>`, "x") });
  let resolved = 0;
  session.resolveWebLink = async (sourceUrl) => { resolved++; return { url: "https://example.org/", sourceUrl }; };
  const provider = createBrowserProvider({ session });
  try {
    const result = await provider.readPage("710002", { type: "webr" });
    assert.equal(resolved, 8);
    assert.equal(result.destinations?.length, 8);
    assert.match(result.destinationNotice!, /may be incomplete/);
  } finally { await provider.close(); }
});
