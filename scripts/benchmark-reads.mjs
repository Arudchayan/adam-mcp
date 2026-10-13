import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createBrowserProvider } from "../packages/provider-browser/src/browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../packages/provider-browser/src/memory-session.ts";

// Measures the provider's hot snapshot/parse path, not live ADAM network latency.
const factories = [["current", createBrowserProvider]];
if (process.argv[2]) factories.unshift(["baseline", (await import(pathToFileURL(resolve(process.argv[2])).href)).createBrowserProvider]);
const results = [];
for (const [name, factory] of factories) {
  const origin = "https://adam.unibas.ch", url = `${origin}/go/crs/100001`;
  const links = Array.from({ length: 100 }, (_, i) => `<a href="/go/file/${100010 + i}">Notes ${i}.pdf</a>`).join("");
  let navigations = 0, htmlAccesses = 0;
  const snapshot = new Proxy(snapshotFromHtml(url, "Synthetic course", `<main><h1>Synthetic course</h1>${links}<a href="/logout.php">Abmelden</a></main>`, `Synthetic course ${"Fourier linear algebra lecture notes. ".repeat(1400)} Abmelden`), {
    get(target, key, receiver) { if (key === "html") htmlAccesses++; return Reflect.get(target, key, receiver); },
  });
  const provider = factory({ origin, session: createMemorySession({ [url]: snapshot }, { onOpen: () => navigations++ }) });
  const batch = async () => {
    await provider.getCourse("100001");
    await provider.listChildren("100001", { type: "crs" });
    await provider.listFiles("100001", { type: "crs" });
    await provider.readPage("100001", { type: "crs" });
  };
  const coldStart = performance.now(); await batch(); const coldMs = performance.now() - coldStart;
  for (let i = 0; i < 10; i++) await batch();
  const beforeHtml = htmlAccesses, beforeNav = navigations;
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const started = performance.now(); await batch(); samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  results.push({ name, measuredCalls: 200, coldFourCallBatchMs: Number(coldMs.toFixed(3)), warmBatchP50Ms: Number(samples[25].toFixed(3)), warmBatchP95Ms: Number(samples[47].toFixed(3)), warmNavigations: navigations - beforeNav, warmHtmlAccesses: htmlAccesses - beforeHtml, totalNavigations: navigations });
  await provider.close();
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, workload: "100 file links and about 50k text characters; 50 warm batches of four calls", results }, null, 2));
