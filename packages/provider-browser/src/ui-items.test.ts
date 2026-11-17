import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeEntities, textOf } from "./ui-items.ts";

describe("decodeEntities (news and item text)", () => {
  it("decodes named, numeric and ILIAS double-escaped entities", () => {
    assert.equal(decodeEntities("A &amp; B"), "A & B");
    assert.equal(decodeEntities("A &amp;amp; B"), "A & B");
    assert.equal(decodeEntities("&#228;&#x2013;&quot;"), "ä–\"");
    assert.equal(textOf("<p>Tom&nbsp;&amp;&nbsp;Jerry</p>"), "Tom & Jerry");
  });
  it("leaves unknown or invalid entities alone", () => {
    assert.equal(decodeEntities("&bogus; &#0; &#xD800;"), "&bogus; &#0; &#xD800;");
  });
});
