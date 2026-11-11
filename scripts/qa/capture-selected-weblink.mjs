import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createPlaywrightSession } from "../../packages/provider-browser/src/playwright-session.ts";

const [courseId, selectedId] = process.argv.slice(2);
if (!/^\d+$/.test(courseId ?? "") || !/^\d+$/.test(selectedId ?? "") || !process.argv.includes("--confirm")) {
  throw new Error("Provide the previously selected course and Web Link IDs, plus --confirm after permission to inspect both pages.");
}
const session = createPlaywrightSession();
try {
  if (!(await session.status()).loggedIn) throw new Error("Login and recheck status first.");
  await session.open(`https://adam.unibas.ch/go/crs/${courseId}`);
  const page = Reflect.get(session, "page");
  // Project only the selected row's structural elements. Never save raw HTML,
  // titles, destination values, arbitrary attributes or private object IDs.
  const project = ({ selector, selectedId }) => {
    const anchor = [...document.querySelectorAll(selector)].find((a) => {
      try { return new URL(a.href).searchParams.get("ref_id") === selectedId; } catch { return false; }
    });
    if (!anchor) throw new Error("Selected Web Link anchor is not present.");
    const row = anchor.closest(".ilContainerListItemOuter, .il-item, table");
    if (!row) throw new Error("Selected anchor has no recognized containing row/table.");
    const classes = new Set(["ilContainerListItemOuter", "il_ContainerItemTitle", "il-item", "table", "table-striped", "fullwidth"]);
    const tags = new Set(["DIV", "SPAN", "A", "TABLE", "TBODY", "THEAD", "TR", "TD", "TH", "P", "H3", "H4"]);
    const escape = (s) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const serialize = (element) => {
      if (element.nodeType === Node.TEXT_NODE) return element.textContent.trim() ? "x" : "";
      if (element.nodeType !== Node.ELEMENT_NODE || !tags.has(element.tagName)) return "";
      let attrs = "";
      const keptClasses = [...element.classList].filter((c) => classes.has(c));
      if (keptClasses.length) attrs += ` class="${keptClasses.join(" ")}"`;
      if (element.tagName === "A") {
        if (element !== anchor) return "";
        const u = new URL(element.href);
        if (u.origin !== "https://adam.unibas.ch" || u.pathname !== "/ilias.php") throw new Error("Unexpected link route.");
        const safe = new URL("https://adam.unibas.ch/ilias.php");
        for (const [key, value] of u.searchParams) {
          if (key === "ref_id") safe.searchParams.set(key, "710002");
          else if (key === "link_id") safe.searchParams.set(key, "720001");
          else if (key === "cmdNode") safe.searchParams.set(key, "aa:bb");
          else if (["baseClass", "cmdClass", "cmd"].includes(key) && /^(?:ilLinkResourceHandlerGUI|ilObjLinkResourceGUI|calldirectlink|callLink)$/i.test(value)) safe.searchParams.set(key, value);
          else throw new Error("Unexpected parameter; extend the scrubber only after review.");
        }
        attrs += ` href="${escape(safe.pathname + safe.search)}"`;
      }
      const tag = element.tagName.toLowerCase();
      return `<${tag}${attrs}>${[...element.childNodes].map(serialize).join("")}</${tag}>`;
    };
    return `<main><div id="il_center_col">${serialize(row)}</div></main>`;
  };
  const listingHtml = await page.evaluate(project, { selector: "main a[href], #il_center_col a[href]", selectedId });
  await session.open(`https://adam.unibas.ch/go/webr/${selectedId}`);
  const selectedHtml = await page.evaluate(project, { selector: "#il_center_col table a[href]", selectedId });
  const directory = new URL("../../packages/provider-browser/qa/weblink-captures/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("selected-link.json", directory), JSON.stringify({
    capturedAt: new Date().toISOString(), iliasVersion: "10.12", approval: "selected course listing and Web Link page",
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    captureScript: "scripts/qa/capture-selected-weblink.mjs", syntheticIds: true, rawHtmlSaved: false, externalNavigation: false,
    notice: "Structural projection of a permitted live row and selected content table; wrapper reconstructed, all text masked, identities remapped. Not a full page capture.",
    listing: { url: "https://adam.unibas.ch/go/crs/710001", html: listingHtml },
    selected: { url: "https://adam.unibas.ch/go/webr/710002", html: selectedHtml },
  }, null, 2) + "\n");
  console.log("Saved only scrubbed structural projections; no raw HTML or external destination values.");
} finally { await session.close(); }
