import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "./errors.ts";
import { resolveAdamOrigin } from "./origin.ts";
import { paginate } from "./pagination.ts";
import { assertReadableObjectType } from "./policy.ts";
import { redactText, redactUrl } from "./redaction.ts";
import { canonicalUrl, objectTypeLabel, parseAdamRef } from "./urls.ts";

describe("canonicalUrl and parseAdamRef", () => {
  it("round-trips /go/{type}/{ref_id} URLs observed on ADAM", () => {
    const url = canonicalUrl("crs", "100001");
    assert.equal(url, "https://adam.unibas.ch/go/crs/100001");
    assert.deepEqual(parseAdamRef(url), { type: "crs", refId: "100001" });
  });

  it("parses public catalog go/cat links", () => {
    assert.deepEqual(parseAdamRef("https://adam.unibas.ch/go/cat/621897"), {
      type: "cat",
      refId: "621897",
    });
  });

  it("parses ILIAS GUI URLs that /go/ links redirect to", () => {
    const raw =
      "https://adam.unibas.ch/ilias.php?baseClass=ilrepositorygui&cmdClass=ilobjcategorygui&ref_id=621897&item_ref_id=0";
    assert.deepEqual(parseAdamRef(raw), { type: "cat", refId: "621897" });
  });

  it("treats a bare numeric id as unknown type until a provider resolves it", () => {
    assert.deepEqual(parseAdamRef("65"), { type: "unknown", refId: "65" });
  });

  it("parses ADAM goto permalinks", () => {
    assert.deepEqual(
      parseAdamRef("https://adam.unibas.ch/goto_adam_file_1428835_download.html"),
      { type: "file", refId: "1428835" },
    );
    assert.deepEqual(
      parseAdamRef("https://adam.unibas.ch/goto.php?target=crs_100001"),
      { type: "crs", refId: "100001" },
    );
  });

  it("labels object types for model-facing summaries", () => {
    assert.equal(objectTypeLabel("crs"), "Course");
    assert.equal(objectTypeLabel("fold"), "Folder");
  });
});

describe("paginate", () => {
  it("emits a next cursor until the last page", () => {
    const first = paginate(["a", "b", "c"], { limit: 2 });
    assert.deepEqual(first.items, ["a", "b"]);
    assert.equal(first.nextCursor, "2");
    const second = paginate(["a", "b", "c"], { cursor: first.nextCursor, limit: 2 });
    assert.deepEqual(second.items, ["c"]);
    assert.equal(second.nextCursor, undefined);
  });
});

describe("redaction", () => {
  it("removes emails, cookies, and token query values", () => {
    assert.equal(redactText("write student@unibas.ch"), "write [redacted-email]");
    assert.match(redactUrl("https://adam.unibas.ch/go/file/1?token=secret"), /\[redacted\]/);
    assert.match(redactText("Cookie: ILIASSESSID=abc"), /\[redacted\]/);
    assert.match(redactText("Authorization: Bearer super-secret"), /\[redacted\]/);
  });
});

describe("origin pin", () => {
  it("accepts the production ADAM origin", () => {
    assert.equal(resolveAdamOrigin("https://adam.unibas.ch"), "https://adam.unibas.ch");
  });

  it("rejects HTTP and foreign hosts", () => {
    assert.throws(() => resolveAdamOrigin("http://adam.unibas.ch"), AdamError);
    assert.throws(() => resolveAdamOrigin("https://evil.example"), AdamError);
  });
});

describe("object policy", () => {
  it("blocks tests from reaching the model", () => {
    assert.throws(() => assertReadableObjectType("tst", "9"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "unsupported_type");
      return true;
    });
    assert.doesNotThrow(() => assertReadableObjectType("crs", "1"));
  });
});
