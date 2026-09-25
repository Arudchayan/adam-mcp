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

  it("parses adam:// resource handles", () => {
    assert.deepEqual(parseAdamRef("adam://exc/100021"), { type: "exc", refId: "100021" });
    assert.deepEqual(parseAdamRef("adam://crs/100001"), { type: "crs", refId: "100001" });
  });

  it("rejects foreign origins, titles, and non-https ADAM hosts", () => {
    assert.equal(parseAdamRef("https://evil.example/go/crs/100001"), undefined);
    assert.equal(parseAdamRef("http://adam.unibas.ch/go/crs/100001"), undefined);
    assert.equal(parseAdamRef("Homework 1 — Fourier"), undefined);
    assert.equal(parseAdamRef("https://github.com/Arudchayan/adam-mcp"), undefined);
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

  it("redacts bare ILIASSESSID without leaving the value", () => {
    const redacted = redactText("ILIASSESSID=abc123");
    assert.match(redacted, /\[redacted\]/);
    assert.equal(redacted.includes("abc123"), false);
    assert.match(redactText("Cookie: PHPSESSID=sess-value"), /\[redacted\]/);
    assert.equal(redactText("Cookie: PHPSESSID=sess-value").includes("sess-value"), false);
    assert.match(redactText("PHPSESSID=php-value"), /PHPSESSID=\[redacted\]/);
    assert.equal(redactText("PHPSESSID=php-value").includes("php-value"), false);
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

  it("refuses ADAM_ALLOW_TEST_ORIGIN when the live browser provider is selected", () => {
    const prevAllow = process.env.ADAM_ALLOW_TEST_ORIGIN;
    const prevProvider = process.env.ADAM_PROVIDER;
    const prevOrigin = process.env.ADAM_ORIGIN;
    try {
      process.env.ADAM_ALLOW_TEST_ORIGIN = "1";
      process.env.ADAM_PROVIDER = "browser";
      process.env.ADAM_ORIGIN = "https://adam-test.example";
      assert.throws(
        () => resolveAdamOrigin("https://adam-test.example"),
        (error: unknown) => {
          assert.ok(error instanceof AdamError);
          assert.equal(error.code, "provider_unavailable");
          assert.match(error.message, /ADAM_ALLOW_TEST_ORIGIN/);
          assert.match(error.message, /browser/);
          return true;
        },
      );

      delete process.env.ADAM_PROVIDER;
      assert.throws(
        () => resolveAdamOrigin("https://adam-test.example"),
        (error: unknown) => {
          assert.ok(error instanceof AdamError);
          assert.match((error as AdamError).message, /ADAM_ALLOW_TEST_ORIGIN/);
          return true;
        },
      );

      process.argv.push("--browser");
      try {
        assert.throws(() => resolveAdamOrigin("https://adam-test.example"), AdamError);
      } finally {
        const idx = process.argv.lastIndexOf("--browser");
        if (idx >= 0) {
          process.argv.splice(idx, 1);
        }
      }
    } finally {
      restoreEnv("ADAM_ALLOW_TEST_ORIGIN", prevAllow);
      restoreEnv("ADAM_PROVIDER", prevProvider);
      restoreEnv("ADAM_ORIGIN", prevOrigin);
    }
  });

  it("allows ADAM_ALLOW_TEST_ORIGIN with the fixture provider", () => {
    const prevAllow = process.env.ADAM_ALLOW_TEST_ORIGIN;
    const prevProvider = process.env.ADAM_PROVIDER;
    try {
      process.env.ADAM_ALLOW_TEST_ORIGIN = "1";
      process.env.ADAM_PROVIDER = "fixture";
      assert.equal(resolveAdamOrigin("https://adam-test.example"), "https://adam-test.example");
    } finally {
      restoreEnv("ADAM_ALLOW_TEST_ORIGIN", prevAllow);
      restoreEnv("ADAM_PROVIDER", prevProvider);
    }
  });

  it("keeps the production pin when the test-origin flag is unset", () => {
    const prevAllow = process.env.ADAM_ALLOW_TEST_ORIGIN;
    const prevProvider = process.env.ADAM_PROVIDER;
    try {
      delete process.env.ADAM_ALLOW_TEST_ORIGIN;
      delete process.env.ADAM_PROVIDER;
      assert.equal(resolveAdamOrigin("https://adam.unibas.ch"), "https://adam.unibas.ch");
      assert.throws(() => resolveAdamOrigin("https://adam-test.example"), AdamError);
    } finally {
      restoreEnv("ADAM_ALLOW_TEST_ORIGIN", prevAllow);
      restoreEnv("ADAM_PROVIDER", prevProvider);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

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
    assert.equal(new AdamError("forbidden", "denied").retryable, false);
    assert.equal(new AdamError("stale_id", "mismatch").retryable, false);
    assert.equal(new AdamError("not_found", "gone", true).retryable, true);
  });
});

describe("resourceUri", () => {
  it("returns adam:// handles only for resource-backed types", () => {
    assert.equal(resourceUri("crs", "100001"), "adam://crs/100001");
    assert.equal(resourceUri("fold", "100020"), "adam://fold/100020");
    assert.equal(resourceUri("file", "100011"), "adam://file/100011");
    assert.equal(resourceUri("exc", "100021"), "adam://exc/100021");
    assert.equal(resourceUri("frm", "100040"), "adam://frm/100040");
    assert.equal(resourceUri("tst", "100030"), undefined);
    assert.equal(resourceUri("cat", "1"), undefined);
  });
});
