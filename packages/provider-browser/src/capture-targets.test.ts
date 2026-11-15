import assert from "node:assert/strict";
import { it } from "node:test";
// @ts-expect-error untyped dev script
import { parseTarget } from "../../../scripts/capture-fixtures.mjs";

it("capture --target parses name:kind:url and pins the ADAM origin", () => {
  assert.deepEqual(parseTarget("exc-detail:exercise:https://adam.unibas.ch/ilias.php?ref_id=1&cmd=showOverview"), {
    name: "exc-detail", kind: "exercise", requestUrl: "https://adam.unibas.ch/ilias.php?ref_id=1&cmd=showOverview",
  });
  for (const bad of [
    "no-colons",
    "Name:kind:https://adam.unibas.ch/",
    "name:kind:https://evil.example/",
    "name:kind:https://user:pw@adam.unibas.ch/",
    "name:kind:/go/crs/1",
    "name::https://adam.unibas.ch/",
  ]) assert.throws(() => parseTarget(bad), Error, bad);
});
