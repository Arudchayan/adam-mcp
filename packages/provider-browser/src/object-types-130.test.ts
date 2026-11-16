import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isDeniedObjectType, parseAdamRef } from "adam-core";
import { extractCatalog, rowIconTypes } from "./extract.ts";
import { snapshotFromHtml } from "./memory-session.ts";

// ADR 0057 (#130, #131): ILIAS 10.12 lab capture (tools/ilias-lab), lab seed data only.
const labCourse = () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/lab/course-student.json", import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", "https://adam.unibas.ch");
};

describe("ADR 0057: containers, scheduling and content-module types", () => {
  it("parses /go/, goto.php/{type}/{id} and the ILIAS 10.12 GUI classes", () => {
    const cases: Array<[string, string]> = [
      ["https://adam.unibas.ch/go/sess/5", "sess"],
      ["https://adam.unibas.ch/go/grp/5", "grp"],
      ["https://adam.unibas.ch/goto.php/book/5", "book"],
      ["https://adam.unibas.ch/goto.php/lso/5", "lso"],
      ["https://adam.unibas.ch/ilias.php?baseClass=ilWikiHandlerGUI&ref_id=5&cmd=view", "wiki"],
      ["https://adam.unibas.ch/ilias.php?baseClass=ilmediacasthandlergui&cmdClass=ilObjMediaCastGUI&cmd=showContent&ref_id=5", "mcst"],
      ["https://adam.unibas.ch/ilias.php?baseClass=ilrepositorygui&cmdClass=ilObjSessionGUI&ref_id=5", "sess"],
      ["https://adam.unibas.ch/ilias.php?baseClass=ilLMPresentationGUI&ref_id=5", "lm"],
      ["https://adam.unibas.ch/ilias.php?baseClass=ilrepositorygui&cmdClass=ilObjDataCollectionGUI&ref_id=5", "dcl"],
      ["https://adam.unibas.ch/ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=5", "unknown"],
      ["https://adam.unibas.ch/goto.php/zzz/5", "unknown"],
    ];
    for (const [url, type] of cases) assert.equal(parseAdamRef(url)?.type, type, url);
    // Tests reached through the new permalink form are still typed, so still denied.
    assert.equal(isDeniedObjectType(parseAdamRef("https://adam.unibas.ch/goto.php/tst/5")!.type), true);
    assert.equal(parseAdamRef("https://evil.example/goto.php/wiki/5"), undefined);
  });

  it("types every linked row of the lab course, using the row icon when the link has no type", () => {
    const html = labCourse();
    const catalog = extractCatalog(snapshotFromHtml("https://adam.unibas.ch/goto.php/crs/86", "Lab Course", html, ""), "2026-11-16T10:00:00.000Z");
    assert.equal(catalog.current?.type, "crs");
    const types = new Set(catalog.objects.map((item) => item.type));
    for (const type of ["sess", "bibl", "book", "copa", "glo", "lm", "lso", "mcst", "wiki", "exc", "fold", "frm", "file", "blog"]) {
      assert.ok(types.has(type as never), `lab course lists a ${type}`);
    }
    assert.equal(types.has("unknown"), false);
    const session = catalog.objects.find((item) => item.type === "sess");
    assert.ok(session);
    assert.equal(session.url, `https://adam.unibas.ch/go/sess/${session.refId}`);
  });

  it("reads row icons only for known types and never overrides a typed link", () => {
    const row = (ref: string, icon: string) => `<div class="ilContainerListItemOuter" id="lg_div_${ref}_pref_1"><img class="ilListItemIcon" src="./assets/images/standard/icon_${icon}.svg"></div>`;
    const icons = rowIconTypes(row("11", "sess") + row("12", "custom") + row("13", "tst") + `<div id="lg_div_14_pref_1"><img src="/data/custom_icon.svg"></div>`);
    assert.equal(icons.get("11"), "sess");
    assert.equal(icons.has("12"), false);
    assert.equal(icons.get("13"), "tst");
    assert.equal(icons.has("14"), false);

    const html = `<main>${row("21", "tst").replace("</div>", `<a class="il_ContainerItemTitle" href="https://adam.unibas.ch/ilias.php?baseClass=ilrepositorygui&amp;cmd=infoScreen&amp;ref_id=21">Exam</a></div>`)}</main>`;
    const catalog = extractCatalog(snapshotFromHtml("https://adam.unibas.ch/go/crs/1", "Course", html, ""), "2026-11-16T10:00:00.000Z");
    assert.equal(catalog.objects.find((item) => item.refId === "21")?.type, "tst", "a tst icon types the row so the deny policy can drop it");
  });
});
