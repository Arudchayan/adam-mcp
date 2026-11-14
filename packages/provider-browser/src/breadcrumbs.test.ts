import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { objectUrl, parseAdamRef, type AdamObjectType, type Breadcrumb } from "adam-core";
import { extractCatalog, orderBreadcrumbs } from "./extract.ts";
import { snapshotFromHtml } from "./memory-session.ts";

const crumb = (type: AdamObjectType, refId: string): Breadcrumb => ({ type, refId, title: refId, url: objectUrl(type, refId) });
const ids = (crumbs: Breadcrumb[]) => crumbs.map((item) => `${item.type}:${item.refId}`);

describe("#122 breadcrumb order", () => {
  it("reverses ILIAS 10.12 leaf-first trails and drops the current object", () => {
    const dom = [crumb("fold", "100030"), crumb("crs", "100001"), crumb("cat", "100002"), crumb("root", "1")];
    assert.deepEqual(ids(orderBreadcrumbs(dom, "100030")), ["root:1", "cat:100002", "crs:100001"]);
  });

  it("keeps root-first trails and still drops the current object", () => {
    const dom = [crumb("root", "1"), crumb("cat", "100002"), crumb("crs", "100001"), crumb("fold", "100030")];
    assert.deepEqual(ids(orderBreadcrumbs(dom, "100030")), ["root:1", "cat:100002", "crs:100001"]);
  });

  it("orients trails without a root crumb by the current object", () => {
    assert.deepEqual(ids(orderBreadcrumbs([crumb("fold", "100030"), crumb("crs", "100001")], "100030")), ["crs:100001"]);
    assert.deepEqual(ids(orderBreadcrumbs([crumb("cat", "100002"), crumb("crs", "100001")], "100030")), ["cat:100002", "crs:100001"]);
  });

  it("removes repeated refs", () => {
    const dom = [crumb("crs", "100001"), crumb("cat", "100002"), crumb("crs", "100001"), crumb("root", "1")];
    assert.deepEqual(ids(orderBreadcrumbs(dom)), ["root:1", "cat:100002", "crs:100001"]);
  });

  it("returns an empty trail when there are no crumbs", () => {
    assert.deepEqual(orderBreadcrumbs([], "100030"), []);
  });
});

describe("#122 breadcrumbs on scrubbed ILIAS 10.12 captures", () => {
  const dir = new URL("../fixtures/live/", import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) {
    const fixture = JSON.parse(readFileSync(new URL(name, dir), "utf8")) as { url: string; title: string; html: string; text: string };
    const current = parseAdamRef(fixture.url);
    if (!current || current.type === "unknown") continue;
    it(`${name}: children carry root → current, without duplicates`, () => {
      const catalog = extractCatalog(snapshotFromHtml(fixture.url, fixture.title, fixture.html, fixture.text), "2026-11-14T00:00:00Z");
      assert.ok(catalog.breadcrumbs.length > 0, "fixture has a breadcrumb trail");
      assert.equal(catalog.breadcrumbs[0].type, "root", "trail starts at the repository root");
      assert.equal(catalog.breadcrumbs.some((item) => item.refId === current.refId), false, "current object is not its own ancestor");
      assert.deepEqual(catalog.current?.breadcrumb, catalog.breadcrumbs);
      for (const child of catalog.objects) {
        const trail = ids(child.breadcrumb);
        assert.equal(new Set(trail).size, trail.length, `${child.refId}: no duplicated crumbs`);
        assert.equal(trail[0]?.startsWith("root:"), true, `${child.refId}: starts at root`);
        assert.equal(trail.at(-1), `${current.type}:${current.refId}`, `${child.refId}: ends at its container`);
      }
    });
  }
});
