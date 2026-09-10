#!/usr/bin/env node
/**
 * Capture scrubbed live-ADAM fixtures for replay tests (ADR 0008, W5).
 *
 * Connects over CDP to the running headless session holder, opens a fresh tab
 * per target, captures the DOM, and writes a redacted fixture:
 *   - scripts/styles/svg/comments removed, attributes reduced to structure
 *   - every ref_id remapped to a stable fake id (relationships preserved)
 *   - text masked except known UI/empty-copy strings
 *   - no cookies, no storage state, no names/titles
 *
 * Usage: node scripts/capture-fixtures.mjs [--profile <dir>] [--out <dir>]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const profileDir = resolve(flag("--profile", join(homedir(), ".adam-mcp", "chrome-profile")));
const outDir = resolve(flag("--out", "packages/provider-browser/fixtures/live"));
const origin = "https://adam.unibas.ch";

const targets = [
  {
    name: "dashboard",
    kind: "dashboard",
    requestUrl: `${origin}/ilias.php?baseClass=ilDashboardGUI&cmd=jumpToSelectedItems`,
  },
  { name: "course-multimedia", kind: "course", requestUrl: `${origin}/go/crs/2206931` },
  { name: "course-analysis", kind: "blank-course", requestUrl: `${origin}/go/crs/2207365` },
  { name: "folder-blank-notes", kind: "blank-fold", requestUrl: `${origin}/go/fold/2291290` },
  { name: "folder-blank-exercises", kind: "blank-fold", requestUrl: `${origin}/go/fold/2291292` },
];

const KEEP_TEXT = [
  /^this (folder|object) is empty/i,
  /^no (items|materials) available/i,
  /^keine eintr/i,
  /^keine objekte gefunden/i,
  /^(content|inhalt|info)$/i,
  /^(abmelden|log ?out|logout)$/i,
  /^(dashboard|schreibtisch)$/i,
  /^(suche|search)$/i,
  /^(repository|personal workspace|communication|adamtools)$/i,
  /^(tipps & tricks|help & support|sprache|deutsch|english)$/i,
];

const KEEP_ARIA = /^(hauptnavigationsleiste|brotkrumen|breadcrumb|breadcrumbs)$/i;

function maskText(value) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return KEEP_TEXT.some((pattern) => pattern.test(text)) ? text : "x";
}

async function main() {
  const portRaw = await readFile(join(profileDir, "DevToolsActivePort"), "utf8");
  const port = Number.parseInt(portRaw.split(/\r?\n/)[0], 10);
  if (!Number.isFinite(port)) {
    throw new Error(`No DevToolsActivePort in ${profileDir}`);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("No browser context on the CDP endpoint.");
  }

  const idMap = new Map();
  const mapId = (digits) => {
    if (!idMap.has(digits)) {
      idMap.set(digits, String(900000 + idMap.size + 1));
    }
    return idMap.get(digits);
  };
  const mapIds = (value) => String(value).replace(/\d+/g, (digits) => mapId(digits));

  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const target of targets) {
    const page = await context.newPage();
    try {
      await page.goto(target.requestUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(1_500);
      const raw = await page.evaluate(() => ({
        html: document.documentElement.outerHTML,
        title: document.title,
        text: document.body ? document.body.innerText : "",
        probe: (() => {
          const root =
            document.querySelector("main #il_center_col") ??
            document.querySelector("#il_center_col") ??
            document.querySelector("main") ??
            document.body;
          const items = root
            ? root.querySelectorAll(
                ".ilContainerListItemOuter, a.il_ContainerItemTitle, .il-item, .il-item-title, .il-std-item-container, #il_center_col a[href*='ref_id='], a[href*='cmdClass=ilobjfilegui'], a[href*='/go/file/'], a[href*='/go/exc/'], a[href*='/go/fold/']",
              )
            : [];
          const rows = new Set();
          for (const item of items) {
            rows.add(item.closest(".ilContainerListItemOuter, .il-item, .il-std-item-container, li, tr") ?? item);
          }
          const text = root ? root.innerText || "" : "";
          const content =
            document.querySelector("#il_center_col") ?? document.querySelector("#ilContentContainer");
          return {
            itemRows: rows.size,
            emptyCopy: /this (?:folder|object) is empty|dieser ordner ist leer|no items available|no materials available|keine eintr[äa]ge(?: vorhanden)?|keine objekte gefunden/i.test(
              text,
            ),
            contentBlank:
              Boolean(content) && content.childElementCount === 0 && (content.innerText || "").trim().length === 0,
          };
        })(),
      }));
      const html = scrubHtml(raw.html, mapIds, maskText);
      const text = maskText(raw.text);
      const fixture = {
        name: target.name,
        kind: target.kind,
        url: mapIds(target.requestUrl),
        title: "redacted",
        capturedAt: new Date().toISOString(),
        dom: raw.probe,
        text,
        html,
      };
      const file = join(outDir, `${target.name}.json`);
      await writeFile(file, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
      written.push({ file, bytes: html.length, rows: raw.probe.itemRows, blank: raw.probe.contentBlank });
      console.error(`captured ${target.name}: html=${html.length}b rows=${raw.probe.itemRows} blank=${raw.probe.contentBlank}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  console.log(JSON.stringify({ outDir, fixtures: written }, null, 2));
  process.exit(0);
}

function scrubHtml(html, mapIds, maskTextValue) {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "");
  out = out.replace(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g, (tag, name, attrs, selfClose) => {
    const kept = [];
    const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = attrPattern.exec(attrs)) !== null) {
      const key = match[1].toLowerCase();
      const value = match[2];
      if (key === "class" || key === "id" || key === "role") {
        kept.push(`${key}="${mapIds(value)}"`);
      } else if (key === "href") {
        kept.push(`href="${scrubHref(value, mapIds)}"`);
      } else if (key === "aria-label") {
        kept.push(`aria-label="${KEEP_ARIA.test(value.trim()) ? value.trim() : "x"}"`);
      } else if (key === "type" || key === "name" || key === "colspan" || key === "rowspan") {
        kept.push(`${key}="${maskTextValue(value)}"`);
      }
    }
    return `<${name}${kept.length ? ` ${kept.join(" ")}` : ""}${selfClose ? " /" : ""}>`;
  });
  out = out.replace(/>([^<]+)</g, (chunk, text) => `>${maskTextValue(text)}<`);
  return out.length > 300_000 ? out.slice(0, 300_000) : out;
}

function scrubHref(href, mapIds) {
  try {
    const url = new URL(href, "https://adam.unibas.ch");
    if (url.hostname !== "adam.unibas.ch") {
      return `${url.protocol}//external.invalid/redacted`;
    }
    const kept = [];
    for (const key of ["ref_id", "item_ref_id", "cmdClass", "baseClass", "target"]) {
      const value = url.searchParams.get(key);
      if (value) {
        kept.push(`${key}=${mapIds(value)}`);
      }
    }
    const path = mapIds(url.pathname);
    return `${path}${kept.length ? `?${kept.join("&")}` : ""}`;
  } catch {
    return "about:blank";
  }
}

void main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
