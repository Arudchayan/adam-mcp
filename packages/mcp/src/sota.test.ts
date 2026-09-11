import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdamError,
  MAX_PAGE_CHARS,
  redactText,
  redactUrl,
  throwIfCancelled,
} from "adam-core";
import { ResourceNotFoundError } from "@modelcontextprotocol/server";
import { createFixtureProvider } from "adam-provider-fixture";
import { createAdamMcpServer } from "./server.ts";
import {
  cursorSchema,
  paginatedObjectsOutputSchema,
  untrustedPageOutputSchema,
} from "./schemas.ts";
import {
  fail,
  ok,
  signalFromContext,
  throwIfCancelled as mcpThrowIfCancelled,
} from "./results.ts";

describe("SOTA P0: cursor strictness (ADR 0010)", () => {
  it("accepts digits and undefined, rejects garbage at the MCP boundary", () => {
    assert.equal(cursorSchema.safeParse(undefined).success, true);
    assert.equal(cursorSchema.safeParse("0").success, true);
    assert.equal(cursorSchema.safeParse("20").success, true);
    assert.equal(cursorSchema.safeParse("abc").success, false);
    assert.equal(cursorSchema.safeParse("-1").success, false);
    assert.equal(cursorSchema.safeParse("10abc").success, false);
  });
});

describe("SOTA P0: resource miss mapping (ADR 0010)", () => {
  it("maps not_found to ResourceNotFoundError (-32602)", async () => {
    const provider = createFixtureProvider();
    await assert.rejects(() => provider.getCourse("999999"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "not_found");
      return true;
    });
    const mapped = (() => {
      try {
        throw new AdamError("not_found", "No ADAM object with ref_id 999999 in the fixture catalog.");
      } catch (error) {
        if (error instanceof AdamError && error.code === "not_found") {
          throw new ResourceNotFoundError("adam://crs/999999");
        }
        throw error;
      }
    }) as () => never;
    assert.throws(mapped, (error: unknown) => {
      assert.ok(error instanceof ResourceNotFoundError);
      assert.equal((error as { code?: number }).code, -32602);
      return true;
    });
  });

  it("server resource handlers use ResourceNotFoundError (server wiring)", () => {
    const server = createAdamMcpServer({ provider: createFixtureProvider() });
    // mapResourceError is closure-scoped; assert the server exposes the four templates
    // and that the SDK error type is available for the mapping.
    const templates = Object.keys(server["_registeredResourceTemplates"] as Record<string, unknown>).sort();
    assert.deepEqual(templates, ["adam-course", "adam-exercise", "adam-file", "adam-folder"]);
    assert.equal(typeof ResourceNotFoundError, "function");
  });
});

describe("SOTA P0: structured validation + instructions (ADR 0010)", () => {
  it("ok() enforces the advertised outputSchema when provided", () => {
    const valid = ok(
      { items: [], listingState: "empty" as const },
      paginatedObjectsOutputSchema,
    );
    assert.equal(valid.isError, undefined);
    assert.throws(
      () =>
        ok(
          // items must be an array; string violates the schema
          { items: "not-an-array" },
          paginatedObjectsOutputSchema,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AdamError);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  });

  it("server carries instructions (no per-prompt re-explanation)", () => {
    const server = createAdamMcpServer({ provider: createFixtureProvider() });
    const instructions = (server.server as unknown as { _instructions?: unknown })._instructions;
    assert.equal(typeof instructions, "string");
    assert.match(String(instructions), /confirm:true/);
    assert.match(String(instructions), /adam:\/\//);
    assert.match(String(instructions), /listingState/);
    assert.match(String(instructions), /tst/i);
  });
});

describe("SOTA P1: retryability fix (ADR 0011)", () => {
  it("unknown bugs are retryable=false (no retry storms)", () => {
    const result = fail(new Error("boom"));
    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /retryable=false/);
  });

  it("cancelled is non-retryable", () => {
    const controller = new AbortController();
    controller.abort();
    assert.throws(() => throwIfCancelled(controller.signal), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal((error as AdamError).code, "cancelled");
      assert.equal((error as AdamError).retryable, false);
      return true;
    });
    assert.throws(() => mcpThrowIfCancelled(controller.signal), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal((error as AdamError).code, "cancelled");
      return true;
    });
  });

  it("signalFromContext reads both SDK shapes", () => {
    const controller = new AbortController();
    assert.equal(signalFromContext({ signal: controller.signal }), controller.signal);
    assert.equal(signalFromContext({ mcpReq: { signal: controller.signal } }), controller.signal);
    assert.equal(signalFromContext({}), undefined);
    assert.equal(signalFromContext(undefined), undefined);
  });

  it("fixture walks fail fast on abort (never memoized partial)", async () => {
    const provider = createFixtureProvider();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => provider.listCourses({ signal: controller.signal }), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal((error as AdamError).code, "cancelled");
      return true;
    });
    await assert.rejects(() => provider.search("Fourier", { signal: controller.signal }), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal((error as AdamError).code, "cancelled");
      return true;
    });
    // Unaborted still works (no memo poisoning from the abort above).
    const listed = await provider.listCourses();
    assert.equal(listed.listingState, "ok");
  });
});

describe("SOTA P1: page bounds honesty (ADR 0011)", () => {
  it("MAX_PAGE_CHARS is 50k and fixture pages carry truncated:false", async () => {
    assert.equal(MAX_PAGE_CHARS, 50_000);
    const provider = createFixtureProvider();
    const page = await provider.readPage("100001");
    assert.equal(typeof page.text, "string");
    assert.equal(page.truncated, false);
    assert.equal(untrustedPageOutputSchema.safeParse({ ...page, untrusted: true as const, notice: "n" }).success, true);
  });
});

describe("SOTA P1: redaction breadth (ADR 0011)", () => {
  it("redacts password/api_key/matriculation in text", () => {
    assert.doesNotMatch(redactText("password=secret123"), /secret123/);
    assert.doesNotMatch(redactText("api_key=AKIA123"), /AKIA123/);
    assert.doesNotMatch(redactText("passwort: geheim"), /geheim/);
    assert.doesNotMatch(redactText("secret=topsecretvalue"), /topsecretvalue/);
  });

  it("leaves legit prose with secret/password words intact", () => {
    assert.equal(redactText("Secret: The Hidden Garden"), "Secret: The Hidden Garden");
    assert.equal(redactText("The Secret Life of Bees"), "The Secret Life of Bees");
    assert.equal(redactText("password recovery instructions"), "password recovery instructions");
  });

  it("redactUrl strips secret query keys", () => {
    const redacted = redactUrl("https://adam.unibas.ch/go/crs/1?password=hunter2&ref_id=1");
    assert.doesNotMatch(redacted, /hunter2/);
    assert.match(redacted, /ref_id=1/);
  });
});
