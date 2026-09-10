import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDebugCapture, patternizeHref } from "./debug-capture.ts";
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

  it("collapses external hosts and unparseable URLs", () => {
    assert.equal(patternizeHref("https://login.switch.ch/idp?SAMLRequest=abc", origin), "[external] https://login.switch.ch");
    assert.equal(patternizeHref("http://[", origin), "[unparseable]");
  });
});

describe("buildDebugCapture", () => {
  it("records structure without page text or secret-bearing values", () => {
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
        title: "Content: 03 - Course & Notes",
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
      frameOrigins: string[];
      linkPatterns: string[];
      dom: { itemRows: number };
    };
    assert.equal(parsed.capturedAt, "2026-09-10T00:00:00.000Z");
    assert.deepEqual(parsed.frameOrigins, ["https://adam.unibas.ch", "https://login.switch.ch"]);
    assert.deepEqual(parsed.linkPatterns, [
      "/go/file/{id} [content]",
      "/goto.php?target=file_{id} [content]",
    ]);
    assert.equal(parsed.dom.itemRows, 0);
  });
});
