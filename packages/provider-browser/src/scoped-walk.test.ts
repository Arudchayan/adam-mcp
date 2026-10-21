import assert from "node:assert/strict";
import { it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import { waitForSignal } from "./request-lifecycle.ts";

const origin = "https://adam.unibas.ch";
const scope = "100001";
const url = `${origin}/go/crs/${scope}`;
const course = (id: string, title: string) => snapshotFromHtml(`${origin}/go/crs/${id}`, title, `<main><h1>${title}</h1><a href="/go/file/${id}1">${title}.pdf</a><a href="/logout.php">Abmelden</a></main>`, `${title} Abmelden`);
function setup() {
  return {
    [origin]: snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard", '<main><a href="/go/crs/100001">A</a><a href="/go/crs/100002">B</a></main>', "Dashboard A B Abmelden"),
    [url]: course(scope, "Alpha"),
    [`${origin}/go/crs/100002`]: course("100002", "Beta"),
  };
}
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

for (const initiating of [true, false]) {
  it(`shares a scoped walk and isolates ${initiating ? "initiating" : "later"} caller cancellation`, async () => {
    const hold = gate(), entered = gate();
    let opens = 0;
    const memory = createMemorySession(setup());
    const provider = createBrowserProvider({ session: { ...memory, async open(target, options) {
      opens++;
      if (target === origin) { entered.resolve(); await waitForSignal(hold.promise, options?.signal); }
      return memory.open(target);
    } } });
    const firstController = new AbortController(), secondController = new AbortController();
    const first = provider.search("Alpha", { courseRefId: scope, signal: firstController.signal });
    await entered.promise;
    const second = provider.listCalendar({ courseRefId: scope, signal: secondController.signal });
    await new Promise<void>((done) => setImmediate(done));
    const cancelled = assert.rejects(initiating ? first : second, /cancelled/);
    (initiating ? firstController : secondController).abort(); await cancelled;
    hold.resolve(); await (initiating ? second : first);
    assert.equal(opens, 2);
    let progress = 0;
    await provider.listNews({ courseRefId: scope, onProgress: () => { progress++; } });
    assert.equal(opens, 2); assert.equal(progress, 0, "complete scoped memo emits no walk progress");
    await provider.close();
  });
}

it("keeps scoped and global results isolated and expires the scoped memo", async () => {
  const pages = setup();
  let clock = 0;
  const provider = createBrowserProvider({ clock: () => clock, session: createMemorySession(pages) });
  assert.equal((await provider.search("Beta", { courseRefId: scope })).items.length, 0);
  assert.ok((await provider.search("Beta", { courseRefId: "100002" })).items.length);
  assert.ok((await provider.search("Beta")).items.length);
  pages[url] = course(scope, "Gamma");
  assert.equal((await provider.search("Gamma", { courseRefId: scope })).items.length, 0);
  clock = 60_001;
  assert.ok((await provider.search("Gamma", { courseRefId: scope })).items.length);
  await provider.close();
});

it("refresh detaches scoped work and an old generation cannot replace fresh results", async () => {
  const pages = setup(), hold = gate(), entered = gate();
  let first = true;
  const memory = createMemorySession(pages);
  const provider = createBrowserProvider({ session: { ...memory, async open(target) {
    const snapshot = await memory.open(target);
    if (target === url && first) { first = false; entered.resolve(); await hold.promise; }
    return snapshot;
  } } });
  const old = provider.search("Alpha", { courseRefId: scope });
  await entered.promise;
  pages[url] = course(scope, "Gamma");
  assert.ok((await provider.search("Gamma", { courseRefId: scope, refresh: true })).items.length);
  hold.resolve(); assert.ok((await old).items.length);
  assert.equal((await provider.search("Alpha", { courseRefId: scope })).items.length, 0);
  assert.ok((await provider.search("Gamma", { courseRefId: scope })).items.length);
  await provider.close();
});

it("never memoizes a partial scoped walk and rechecks enrollment after login", async () => {
  const pages = setup();
  pages[url] = { ...pages[url]!, html: "<main><h1>Alpha</h1></main>", text: "Alpha", links: [], dom: { itemRows: 0, emptyCopy: false, contentBlank: true } };
  const provider = createBrowserProvider({ session: createMemorySession(pages) });
  assert.equal((await provider.search("Alpha", { courseRefId: scope })).partial, true);
  pages[url] = course(scope, "Gamma");
  assert.ok((await provider.search("Gamma", { courseRefId: scope })).items.length);
  pages[origin] = snapshotFromHtml(`${origin}/ilias.php?baseClass=ilDashboardGUI`, "Dashboard", '<main><a href="/go/crs/100002">B</a></main>', "Dashboard B Abmelden");
  await provider.login();
  await assert.rejects(provider.search("Gamma", { courseRefId: scope }), /not in the verified enrolled/);
  await provider.close();
});

it("login cancels old work detached by refresh as well as currently shared work", async () => {
  const entered = gate();
  let blocked = true;
  const memory = createMemorySession(setup());
  const provider = createBrowserProvider({ session: { ...memory, async open(target, options) {
    if (target === url && blocked) {
      entered.resolve();
      await waitForSignal(new Promise<void>(() => {}), options?.signal);
    }
    return memory.open(target);
  } } });
  const old = provider.search("Alpha", { courseRefId: scope });
  const rejected = assert.rejects(old, /cancelled/);
  await entered.promise;
  blocked = false;
  assert.ok((await provider.search("Alpha", { courseRefId: scope, refresh: true })).items.length);
  await provider.login();
  await rejected;
  assert.ok((await provider.search("Alpha", { courseRefId: scope })).items.length);
  await provider.close();
});
