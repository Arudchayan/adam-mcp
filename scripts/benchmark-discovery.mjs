import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createBrowserProvider } from "../packages/provider-browser/src/browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../packages/provider-browser/src/memory-session.ts";
import { WeightedQueue } from "../packages/core/src/weighted-queue.ts";

// Synthetic provider timings only; no Chrome, live ADAM, student data or model calls.
const factories = [["current", createBrowserProvider]];
if (process.argv[2]) factories.unshift(["baseline", (await import(pathToFileURL(resolve(process.argv[2])).href)).createBrowserProvider]);
const origin = "https://adam.unibas.ch";
function tree(folders) {
  const courseId = "100001", courseUrl = `${origin}/go/crs/${courseId}`;
  const pages = {
    [origin]: snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard", `<main><a href="/go/crs/${courseId}">Synthetic course</a></main>`, "Dashboard Abmelden"),
  };
  const folderLinks = Array.from({ length: folders }, (_, i) => {
    const id = String(200000 + i);
    pages[`${origin}/go/fold/${id}`] = snapshotFromHtml(`${origin}/go/fold/${id}`, `Folder ${i}`, `<main><h1>Folder ${i}</h1><a href="/go/file/${300000 + i}">Notes ${i}.pdf</a></main>`, `Folder ${i} Notes Abmelden`);
    return `<a href="/go/fold/${id}">Folder ${i}</a>`;
  }).join("");
  pages[courseUrl] = snapshotFromHtml(courseUrl, "Synthetic course", `<main><h1>Synthetic course</h1>${folderLinks}</main>`, "Synthetic course Abmelden");
  return pages;
}
const results = [];
for (const [name, factory] of factories) {
  for (const workload of ["cold-global-20-folders", "scoped-30-concurrent-calls", "partial-global-60-folders"]) {
    let navigations = 0, progressEvents = 0;
    const provider = factory({ session: createMemorySession(tree(workload.startsWith("partial") ? 60 : 20), { onOpen: () => navigations++ }) });
    const onProgress = () => { progressEvents++; };
    const started = performance.now();
    let partial;
    if (workload.startsWith("scoped")) {
      for (let batch = 0; batch < 10; batch++) {
        const options = { courseRefId: "100001", onProgress };
        await Promise.all([provider.search("Notes", options), provider.listNews(options), provider.listCalendar(options)]);
      }
    } else {
      const result = await provider.search("Notes", { onProgress });
      partial = result.partial ?? false;
      assert.equal(partial, workload.startsWith("partial"));
    }
    results.push({ name, workload, elapsedMs: Number((performance.now() - started).toFixed(3)), navigations, progressEvents, ...(partial === undefined ? {} : { partial }) });
    await provider.close();
  }
}

// Deterministic overload experiment: no parser cost or live file allocation.
const queue = new WeightedQueue({ maxPending: 8, maxBytes: 32 * 1024 * 1024, waitMs: 30_000 });
let release;
const gate = new Promise((done) => { release = done; });
const active = queue.enqueue(8 * 1024 * 1024, () => gate);
const waiting = Array.from({ length: 8 }, () => queue.enqueue(4 * 1024 * 1024, async () => "done"));
let rejected = false;
await queue.enqueue(1, async () => {}).catch(() => { rejected = true; });
assert.equal(rejected, true);
release(); await active; await Promise.all(waiting);
assert.equal(await queue.enqueue(1, async () => "recovered"), "recovered");
console.log(JSON.stringify({ node: process.version, platform: process.platform, synthetic: true, results, queuePressure: { active: 1, pending: 8, waitingBytes: 32 * 1024 * 1024, excessRefused: rejected, recovered: true } }, null, 2));
