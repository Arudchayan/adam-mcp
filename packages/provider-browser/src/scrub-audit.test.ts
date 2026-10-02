import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildDebugCapture, patternizeHref } from "./debug-capture.ts";
import type { SnapshotLink } from "./session-types.ts";

/**
 * Scrub audit + capture hygiene (fix-20 / zeta R8 + H1-H3).
 *
 * READ-ONLY: readdir/readFile + regex asserts only. No writes, no live login,
 * no corpus promotion, no source edits. Scans the 5 committed scrubbed
 * fixtures under fixtures/live/ plus the capture/debug-capture sources.
 */

const srcDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(srcDir, "../fixtures/live");
const captureScriptPath = resolve(srcDir, "../../../scripts/capture-fixtures.mjs");
const debugCapturePath = join(srcDir, "debug-capture.ts");
const origin = "https://adam.unibas.ch";

type FixtureDoc = {
  name: string;
  kind: string;
  url: string;
  title: string;
  capturedAt: string;
  dom: { itemRows: number; emptyCopy: boolean; contentBlank: boolean };
  text: string;
  html: string;
};

const EXPECTED_FILES = [
  "course-analysis.json",
  "course-multimedia.json",
  "dashboard.json",
  "folder-blank-exercises.json",
  "folder-blank-notes.json",
];

const EXPECTED_TARGETS = [
  "dashboard",
  "course-multimedia",
  "course-analysis",
  "folder-blank-notes",
  "folder-blank-exercises",
];

const EXPECTED_KINDS: Record<string, string> = {
  dashboard: "dashboard",
  "course-multimedia": "course",
  "course-analysis": "blank-course",
  "folder-blank-notes": "blank-fold",
  "folder-blank-exercises": "blank-fold",
};

/** Live ref_ids used only by the capture script; must never reach fixtures. */
const BANNED_REAL_IDS = ["2206931", "2207365", "2291290", "2291292"];

const digitBoundary = (id: string): RegExp => new RegExp(`(?<!\\d)${id}(?!\\d)`);

/** Strip class tokens containing "toggle" (il-toggle-switch, dropdown-toggle, …). */
const stripToggleTokens = (raw: string): string => raw.replace(/[A-Za-z-]*toggle[A-Za-z-]*/g, "");

function loadFixtures(): Array<{ file: string; raw: string; doc: FixtureDoc }> {
  return readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(fixturesDir, file), "utf8");
      return { file, raw, doc: JSON.parse(raw) as FixtureDoc };
    });
}

function textNodes(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/>([^<]*)</g)) {
    const text = (match[1] ?? "").trim();
    if (text.length > 0) {
      out.push(text);
    }
  }
  return out;
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? "");
}

describe("R8 inventory: exact committed scrubbed corpus", () => {
  it("pins the exact 5 fixture files (deep-equal, sorted)", () => {
    const files = readdirSync(fixturesDir)
      .filter((file) => file.endsWith(".json"))
      .sort();
    assert.deepEqual(files, EXPECTED_FILES);
  });

  it("ships only non-empty JSON fixtures with the required keys", () => {
    const entries = loadFixtures();
    assert.equal(entries.length, 5);
    for (const { file, raw, doc } of entries) {
      assert.ok(raw.length > 1000, `${file} is unexpectedly small`);
      assert.deepEqual(Object.keys(doc).sort(), [
        "capturedAt",
        "dom",
        "html",
        "kind",
        "name",
        "text",
        "title",
        "url",
      ]);
    }
  });
});

describe("R8 titles: redacted", () => {
  it("redacts every fixture title", () => {
    for (const { file, doc } of loadFixtures()) {
      assert.equal(doc.title, "redacted", file);
      assert.ok(!doc.title.includes("@"), `${file} title leaks email`);
    }
  });
});

describe("R8 real-ID digit-boundary ban", () => {
  it("bans live ref_ids with digit boundaries in every raw fixture", () => {
    for (const { file, raw } of loadFixtures()) {
      for (const id of BANNED_REAL_IDS) {
        assert.ok(!digitBoundary(id).test(raw), `${file} leaks live id ${id}`);
      }
    }
  });

  it("keeps only remapped 900xxx ids in fixture urls", () => {
    for (const { file, doc } of loadFixtures()) {
      for (const id of BANNED_REAL_IDS) {
        assert.ok(!digitBoundary(id).test(doc.url), `${file} url leaks ${id}`);
      }
      if (doc.kind === "dashboard") {
        assert.ok(doc.url.startsWith(`${origin}/ilias.php`), file);
      } else {
        assert.match(doc.url, /^https:\/\/adam\.unibas\.ch\/go\/(crs|fold)\/900\d+$/, file);
      }
    }
  });
});

describe("R8 secret and email bans (toggle-stripped)", () => {
  it("bans sessid/cookie/password/token in every raw fixture", () => {
    for (const { file, raw } of loadFixtures()) {
      for (const secret of ["sessid", "cookie", "set-cookie", "password", "token"]) {
        assert.ok(!new RegExp(secret, "i").test(raw), `${file} leaks ${secret}`);
      }
    }
  });

  it("bans SWITCH (after il-toggle-switch strip) and email @", () => {
    for (const { file, raw } of loadFixtures()) {
      const stripped = stripToggleTokens(raw);
      assert.ok(!/switch/i.test(stripped), `${file} leaks SWITCH outside toggle tokens`);
      assert.ok(!raw.includes("@"), `${file} leaks email @`);
    }
  });
});

describe("R8 html text-node and attribute allowlists", () => {
  it("allows only x or UI-chrome text nodes in scrubbed html", () => {
    const allowed = new Set([
      "x",
      "Search",
      "Logout",
      "Dashboard",
      "Repository",
      "Personal Workspace",
      "Communication",
      "ADAMtools",
      "Content",
      "Info",
    ]);
    for (const { file, doc } of loadFixtures()) {
      const nodes = textNodes(doc.html);
      assert.ok(nodes.length > 10, `${file} has no text skeleton`);
      for (const node of nodes) {
        assert.ok(allowed.has(node), `${file} free-text leak: ${JSON.stringify(node)}`);
      }
      assert.ok(Math.max(...nodes.map((node) => node.length)) <= 32, `${file} over-long text node`);
    }
  });

  it("keeps only structural attributes and allowlisted aria/type values", () => {
    const allowedAttrs = new Set([
      "class",
      "id",
      "role",
      "href",
      "aria-label",
      "type",
      "name",
      "colspan",
      "rowspan",
    ]);
    const allowedAria = /^(hauptnavigationsleiste|brotkrumen|breadcrumb|breadcrumbs)$/i;
    for (const { file, doc } of loadFixtures()) {
      for (const tag of doc.html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\s([^<>]*?)\s*\/?>/g)) {
        for (const attr of (tag[2] ?? "").matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"[^"]*"/g)) {
          assert.ok(allowedAttrs.has((attr[1] ?? "").toLowerCase()), `${file} attr leak: ${attr[1]}`);
        }
      }
      assert.ok(!/<[^>]+\son\w+\s*=/i.test(doc.html), `${file} inline handler leak`);
      assert.ok(!/\sstyle\s*=/i.test(doc.html), `${file} style attr leak`);
      for (const aria of doc.html.matchAll(/aria-label="([^"]*)"/g)) {
        const value = aria[1] ?? "";
        assert.ok(value === "x" || allowedAria.test(value), `${file} aria leak: ${value}`);
      }
    }
  });
});

describe("R8 x-shape text and stripped tags", () => {
  it("keeps top-level page text x-shaped", () => {
    for (const { file, doc } of loadFixtures()) {
      assert.match(doc.text, /^\s*x?\s*$/, `${file} text not x-shaped`);
      assert.ok(doc.text.length <= 8, `${file} text too long`);
    }
  });

  it("strips script/style/svg/comments/noscript from scrubbed html", () => {
    for (const { file, doc } of loadFixtures()) {
      assert.ok(!/<script/i.test(doc.html), `${file} script leak`);
      assert.ok(!/<style/i.test(doc.html), `${file} style leak`);
      assert.ok(!/<svg[\s>]/i.test(doc.html), `${file} svg leak`);
      assert.ok(!/<!--/.test(doc.html), `${file} comment leak`);
      assert.ok(!/<noscript/i.test(doc.html), `${file} noscript leak`);
    }
  });
});

describe("R8 href hygiene", () => {
  it("emits no insecure or live-absolute hrefs", () => {
    for (const { file, doc } of loadFixtures()) {
      for (const href of hrefs(doc.html)) {
        assert.ok(!/^http:\/\//i.test(href), `${file} insecure href: ${href}`);
        assert.ok(!href.startsWith("https://adam.unibas.ch"), `${file} live href: ${href}`);
        assert.ok(!/switch\.ch/i.test(href), `${file} idp href: ${href}`);
      }
    }
  });

  it("allows only same-origin paths or the external redacted placeholder", () => {
    for (const { file, doc } of loadFixtures()) {
      const all = hrefs(doc.html);
      assert.ok(all.length > 5, `${file} lost href skeleton`);
      for (const href of all) {
        assert.ok(
          href.startsWith("/") ||
            href === "https://external.invalid/redacted" ||
            href === "about:blank",
          `${file} odd href: ${href}`,
        );
      }
      assert.ok(
        all.some((href) => href === "https://external.invalid/redacted"),
        `${file} missing external redaction`,
      );
    }
  });
});

describe("R8 capturedAt and dom probe", () => {
  it("stamps every fixture with ISO-8601 UTC millis", () => {
    for (const { file, doc } of loadFixtures()) {
      assert.match(doc.capturedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, file);
      assert.ok(!Number.isNaN(Date.parse(doc.capturedAt)), `${file} unparseable capturedAt`);
    }
  });

  it("probes dom shape with blank/non-blank parity", () => {
    for (const { file, doc } of loadFixtures()) {
      assert.equal(typeof doc.dom.itemRows, "number", file);
      assert.ok(Number.isInteger(doc.dom.itemRows) && doc.dom.itemRows >= 0, file);
      assert.equal(typeof doc.dom.emptyCopy, "boolean", file);
      assert.equal(typeof doc.dom.contentBlank, "boolean", file);
      if (doc.kind === "blank-fold" || doc.kind === "blank-course") {
        assert.equal(doc.dom.contentBlank, true, file);
        assert.equal(doc.dom.itemRows, 0, file);
      } else {
        assert.ok(doc.dom.itemRows >= 1, `${file} expected content rows`);
      }
    }
  });
});

describe("H1 patterns-only debug capture", () => {
  it("emits link patterns without page text, titles, or secrets", () => {
    const links: SnapshotLink[] = [
      {
        href: "https://adam.unibas.ch/go/file/1428835?token=SECRET",
        text: "Secret course material text",
        inChrome: false,
        inBreadcrumb: false,
      },
      {
        href: "https://adam.unibas.ch/goto.php?target=file_1428835&sessid=SECRET",
        text: "Secret course material text",
        inChrome: false,
        inBreadcrumb: false,
      },
    ];
    const json = buildDebugCapture(
      {
        origin,
        url: "https://adam.unibas.ch/ilias.php?ref_id=2291290&cmdClass=ilobjfoldergui",
        titleLength: 31,
        dom: { itemRows: 0, emptyCopy: false },
        frameOrigins: [origin, origin, "https://login.switch.ch"],
        skeleton: ["main#il_center_col", "  div.il-container"],
        links,
      },
      "2026-09-10T00:00:00.000Z",
    );
    assert.ok(!json.includes("SECRET"), "secret value leaked");
    assert.ok(!json.includes("Secret course material text"), "page text leaked");
    const parsed = JSON.parse(json) as {
      capturedAt: string;
      titleLength: number;
      frameOrigins: string[];
      linkPatterns: string[];
      note: string;
    } & Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), [
      "capturedAt",
      "dom",
      "frameOrigins",
      "linkPatterns",
      "note",
      "origin",
      "skeleton",
      "titleLength",
      "url",
    ]);
    assert.equal(parsed.capturedAt, "2026-09-10T00:00:00.000Z");
    assert.equal(parsed.titleLength, 31);
    assert.deepEqual(parsed.frameOrigins, [origin, "https://login.switch.ch"]);
    assert.deepEqual(parsed.linkPatterns, ["/go/file/{id} [content]", "/goto.php?target=file_{id} [content]"]);
    assert.match(parsed.note, /No page text/);
  });

  it("masks ids in hrefs and pins the patterns-only source shape", () => {
    assert.equal(patternizeHref("https://adam.unibas.ch/go/fold/2291290", origin), "/go/fold/{id}");
    assert.equal(
      patternizeHref(
        "https://adam.unibas.ch/ilias.php?ref_id=2291290&cmdClass=ilobjfoldergui&sessid=SECRET",
        origin,
      ),
      "/ilias.php?ref_id={id}&cmdClass=ilobjfoldergui",
    );
    assert.equal(
      patternizeHref("https://login.switch.ch/idp?SAMLRequest=abc", origin),
      "[external] https://login.switch.ch",
    );
    const source = readFileSync(debugCapturePath, "utf8");
    assert.ok(source.includes("export function patternizeHref"), "patternizer missing");
    assert.ok(source.includes("export function buildDebugCapture"), "builder missing");
    assert.ok(source.includes("titleLength"), "must record title length, never the title");
    assert.ok(source.includes("No page text"), "redaction note missing");
  });
});

describe("H2 KEEP_TEXT allowlist stability", () => {
  it("keeps the KEEP_TEXT delta within 4 with anchored patterns", () => {
    const script = readFileSync(captureScriptPath, "utf8");
    const block = script.match(/const KEEP_TEXT = \[([\s\S]*?)\];/)?.[1];
    assert.ok(block, "KEEP_TEXT block missing");
    const patterns = block.match(/\/\^[^/]*\/[a-z]*/g) ?? [];
    assert.ok(
      patterns.length >= 6 && patterns.length <= 14,
      `KEEP_TEXT drifted beyond 4: found ${patterns.length}, want 6..14`,
    );
    for (const pattern of patterns) {
      assert.ok(pattern.startsWith("/^"), `unanchored KEEP_TEXT pattern: ${pattern}`);
    }
    for (const pin of [
      "this (folder|object) is empty",
      "no (items|materials) available",
      "keine eintr",
      "keine objekte gefunden",
      "(content|inhalt|info)",
      "(abmelden|log ?out|logout)",
      "(dashboard|schreibtisch)",
      "(suche|search)",
      "(repository|personal workspace|communication|adamtools)",
      "(tipps & tricks|help & support|sprache|deutsch|english)",
    ]) {
      assert.ok(script.includes(pin), `KEEP_TEXT lost pinned fragment: ${pin}`);
    }
  });

  it("keeps UI chrome per pattern and masks student-like copy", () => {
    const keep: RegExp[] = [
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
    const maskText = (value: string): string => {
      const text = value.replace(/\s+/g, " ").trim();
      if (!text) {
        return "";
      }
      return keep.some((pattern) => pattern.test(text)) ? text : "x";
    };
    const positive = [
      "This folder is empty",
      "no MATERIALS available",
      "keine Einträge vorhanden",
      "keine Objekte gefunden",
      "Content",
      "Abmelden",
      "Dashboard",
      "Search",
      "Personal Workspace",
      "Help & Support",
    ];
    for (const sample of positive) {
      assert.equal(maskText(sample), sample, `KEEP_TEXT dropped UI copy: ${sample}`);
    }
    for (const sample of [
      "Prof. Student Secret 12345",
      "My Grades HS2026",
      "Contents",
      "Searching",
      "Dashboards",
    ]) {
      assert.equal(maskText(sample), "x", `KEEP_TEXT leaked student copy: ${sample}`);
    }
  });
});

describe("H3 capture targets and corpus parity", () => {
  it("pins the exact 5 capture targets against the pinned origin", () => {
    const script = readFileSync(captureScriptPath, "utf8");
    assert.ok(script.includes('const origin = "https://adam.unibas.ch"'), "origin drift");
    const block = script.match(/const targets = \[([\s\S]*?)\];/)?.[1];
    assert.ok(block, "targets block missing");
    const names = [...block.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
    assert.deepEqual(names, EXPECTED_TARGETS);
    assert.equal((block.match(/requestUrl:/g) ?? []).length, 5, "want 5 requestUrls");
  });

  it("matches the committed corpus file-for-file with kind parity", () => {
    const script = readFileSync(captureScriptPath, "utf8");
    const block = script.match(/const targets = \[([\s\S]*?)\];/)?.[1];
    assert.ok(block, "targets block missing");
    const names = [...block.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1] ?? "").sort();
    const files = readdirSync(fixturesDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    assert.deepEqual(files, names, "corpus drifted from capture targets");
    for (const { file, doc } of loadFixtures()) {
      const stem = file.replace(/\.json$/, "");
      assert.equal(doc.name, stem, file);
      assert.equal(doc.kind, EXPECTED_KINDS[stem], `${file} kind drift`);
    }
  });
});
