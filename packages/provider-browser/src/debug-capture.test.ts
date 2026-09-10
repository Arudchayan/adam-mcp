import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildDebugCapture, patternizeHref, writeDebugCapture } from "./debug-capture.ts";
import type { SnapshotLink } from "./session-types.ts";

const origin = "https://adam.unibas.ch";

describe("patternizeHref", () => {
  it("masks numeric ids and keeps only provenance params", () => {
    assert.equal(patternizeHref("https://adam.unibas.ch/go/fold/2291290", origin), "/go/fold/{id}");
    assert.equal(
      patternizeHref(
        "https://adam.unibas.ch/ilias.php?ref_id=2291290&item_ref_id=0&cmdClass=ilobjfoldergui&sessid=SECRET",
        origin,
      ),
      "/ilias.php?ref_id={id}&item_ref_id={id}&cmdClass=ilobjfoldergui",
    );
    assert.equal(
      patternizeHref("https://adam.unibas.ch/goto.php?target=file_1428835&sessid=SECRET", origin),
      "/goto.php?target=file_{id}",
    );
  });

  it("masks filenames and non-structural values", () => {
    assert.equal(
      patternizeHref("https://adam.unibas.ch/goto.php?target=wiki_1_PageTitle", origin),
      "/goto.php?target={value}",
    );
    assert.equal(
      patternizeHref("https://adam.unibas.ch/data/1234/Student%20Notes.pdf", origin),
      "/data/{id}/{file}",
    );
  });

  it("collapses external hosts and unparseable URLs", () => {
    assert.equal(patternizeHref("https://login.switch.ch/idp?SAMLRequest=abc", origin), "[external] https://login.switch.ch");
    assert.equal(patternizeHref("http://[", origin), "[unparseable]");
  });
});

describe("buildDebugCapture", () => {
  it("records structure without page text, titles, or secret-bearing values", () => {
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
        frameOrigins: ["https://adam.unibas.ch", "https://adam.unibas.ch", "https://login.switch.ch"],
        skeleton: ["main#il_center_col", "  div.il-container"],
        links,
      },
      "2026-09-10T00:00:00.000Z",
    );
    assert.doesNotMatch(json, /SECRET/);
    assert.doesNotMatch(json, /Secret course material text/);
    const parsed = JSON.parse(json) as {
      capturedAt: string;
      titleLength: number;
      frameOrigins: string[];
      linkPatterns: string[];
      dom: { itemRows: number };
    };
    assert.equal(parsed.capturedAt, "2026-09-10T00:00:00.000Z");
    assert.equal(parsed.titleLength, 31);
    assert.deepEqual(parsed.frameOrigins, ["https://adam.unibas.ch", "https://login.switch.ch"]);
    assert.deepEqual(parsed.linkPatterns, [
      "/go/file/{id} [content]",
      "/goto.php?target=file_{id} [content]",
    ]);
    assert.equal(parsed.dom.itemRows, 0);
  });
});

describe("writeDebugCapture", () => {
  it("writes a timestamped capture and returns undefined instead of throwing on a bad dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adam-capture-"));
    try {
      const file = await writeDebugCapture("listing", '{"ok":true}', dir);
      assert.ok(file);
      assert.ok(file.startsWith(dir));
      assert.equal(await readFile(file, "utf8"), '{"ok":true}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const bad = join(tmpdir(), "adam-capture-missing", "nope", "\u0000invalid");
    assert.equal(await writeDebugCapture("listing", "{}", bad), undefined);
  });
});

