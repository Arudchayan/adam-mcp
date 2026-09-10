import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "./errors.ts";
import { resolveAdamOrigin } from "./origin.ts";
import { paginate } from "./pagination.ts";
import { assertReadableObjectType } from "./policy.ts";
import { redactText, redactUrl } from "./redaction.ts";
import { canonicalUrl, objectTypeLabel, parseAdamRef, resourceUri } from "./urls.ts";

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
    assert.deepEqual(
      parseAdamRef(
        "https://adam.unibas.ch/ilias.php?baseClass=ilrepositorygui&cmdClass=ilrepositorygui&cmdClass=ilexercisehandlergui&ref_id=100021",
      ),
      { type: "exc", refId: "100021" },
    );
    assert.deepEqual(
      parseAdamRef(
        "https://adam.unibas.ch/ilias.php?cmdClass=ilobjfoldergui&ref_id=2291290&item_ref_id=2291904",
      ),
      // Child id, parent type unknowable → unknown (needs-resolve, ADR 0005).
      { type: "unknown", refId: "2291904" },
    );
    assert.deepEqual(
      parseAdamRef(
        "https://adam.unibas.ch/ilias.php?baseClass=ilrepositorygui&cmdClass=ilobjcoursegui&ref_id=100001&item_ref_id=2291904",
      ),
      { type: "unknown", refId: "2291904" },
    );
    assert.deepEqual(
      parseAdamRef("https://adam.unibas.ch/ilias.php?cmdClass=ilobjfoldergui&ref_id=10"),
      { type: "fold", refId: "10" },
    );
    assert.deepEqual(
      parseAdamRef("https://adam.unibas.ch/ilias.php?cmdClass=ilobjfilegui&ref_id=11"),
      { type: "file", refId: "11" },
    );
    assert.deepEqual(
      parseAdamRef("https://adam.unibas.ch/ilias.php?cmdClass=ilobjbloggui&ref_id=12"),
      { type: "blog", refId: "12" },
    );
    assert.deepEqual(
      parseAdamRef("https://adam.unibas.ch/ilias.php?cmdClass=iltestplayergui&ref_id=13"),
      { type: "tst", refId: "13" },
    );
  });

  it("treats a bare numeric id as unknown type until a provider resolves it", () => {
    assert.deepEqual(parseAdamRef("65"), { type: "unknown", refId: "65" });
    assert.equal(parseAdamRef("http://["), undefined);
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
    assert.match(redactText("PHPSESSID=abc"), /\[redacted\]/);
    assert.match(redactText("Authorization: Bearer super-secret"), /\[redacted\]/);
    assert.match(redactText("Authorization: Basic dXNlcjpwYXNz"), /\[redacted\]/);
    assert.match(redactText("SAMLResponse=PHNhbWw+Q29va2ll"), /\[redacted\]/);
    assert.match(redactText("_shibsession_abc123=xyz"), /\[redacted\]/);
    assert.match(redactUrl("https://adam.unibas.ch/login.php?SAMLRequest=abc"), /\[redacted\]/);
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
    assert.throws(() => assertReadableObjectType("tst"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.message.includes("(undefined)"), false);
      assert.match(error.message, /blocked/);
      return true;
    });
  });

  it("marks transient failures retryable and user-action failures not retryable", () => {
    assert.equal(new AdamError("provider_unavailable", "chrome missing").retryable, true);
    assert.equal(new AdamError("not_found", "gone").retryable, false);
    assert.equal(new AdamError("unauthorized", "login").retryable, false);
    assert.equal(new AdamError("not_found", "gone", true).retryable, true);
  });
});

describe("resourceUri", () => {
  it("returns adam:// handles only for resource-backed types", () => {
    assert.equal(resourceUri("crs", "100001"), "adam://crs/100001");
    assert.equal(resourceUri("fold", "100020"), "adam://fold/100020");
    assert.equal(resourceUri("file", "100011"), "adam://file/100011");
    assert.equal(resourceUri("exc", "100021"), "adam://exc/100021");
    assert.equal(resourceUri("tst", "100030"), undefined);
    assert.equal(resourceUri("cat", "1"), undefined);
  });
});
