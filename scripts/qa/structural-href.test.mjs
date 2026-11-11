import assert from "node:assert/strict";
import { test } from "node:test";
import { structuralHref } from "./structural-href.mjs";

test("QA inspector emits no arbitrary paths, hostnames, identities or parameter values", () => {
  const base = "https://adam.unibas.ch";
  for (const href of [
    "/private-course-name/private-username.pdf?ref_id=123456&cmdClass=private-class#private-fragment",
    "https://private-user:private-password@adam.unibas.ch/ilias.php?ref_id=123456&cmdClass=private-class",
    "https://private-host.invalid/private-destination?token=private-token",
    "/go/webr/123456?secret=private-value",
  ]) {
    const output = JSON.stringify(structuralHref(href, base));
    assert.doesNotMatch(output, /private-|123456/);
  }
  assert.equal(structuralHref("/ilias.php?ref_id=123", base).pathKind, "ilias.php");
  assert.equal(structuralHref("/go/webr/123", base).pathKind, "typed-object");
  assert.deepEqual(structuralHref("https://external.invalid/", base), { externalDestination: true });
});
