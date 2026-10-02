import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptedContent,
  CLIENT_CAPABILITIES_META_KEY,
  inputRequired,
  isInputRequiredResult,
} from "@modelcontextprotocol/server";
import { AdamError } from "adam-core";
import {
  clientSupportsElicitation,
  CONFIRM_ELICITATION_REQUESTED_SCHEMA,
  declineFallbackError,
  ELICITATION_ROUND_TIMEOUT_MS,
  elicitationOutcome,
  isElicitedYes,
  requestConfirmElicitation,
} from "./elicitation.ts";

describe("elicitation spike: timeout", () => {
  it("uses a 10-minute human-paced round timeout", () => {
    assert.equal(ELICITATION_ROUND_TIMEOUT_MS, 600_000);
  });
});

describe("elicitation spike: flat-primitive schema", () => {
  it("requests a boolean confirm only", () => {
    const schema = CONFIRM_ELICITATION_REQUESTED_SCHEMA as unknown as {
      type?: string;
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    assert.equal(schema.type, "object");
    assert.deepEqual(Object.keys(schema.properties ?? {}), ["confirm"]);
    assert.equal(schema.properties?.confirm?.type, "boolean");
    assert.match(String(schema.properties?.confirm?.description ?? ""), /Yes, open it/);
    assert.deepEqual(schema.required, ["confirm"]);
  });
});

describe("elicitation spike: write-once shape", () => {
  it("builds an elicitation/create inputRequired for confirm", () => {
    const result = requestConfirmElicitation("adam_read_page") as unknown as {
      resultType?: string;
      inputRequests?: Record<string, { method?: string; params?: Record<string, unknown> }>;
    };
    assert.equal(result.resultType, "input_required");
    const entry = result.inputRequests?.confirm;
    assert.equal(entry?.method, "elicitation/create");
    const params = entry?.params as { message?: string; requestedSchema?: unknown } | undefined;
    assert.match(String(params?.message ?? ""), /adam_read_page/);
    assert.ok(params?.requestedSchema, "requestedSchema must be present");
  });

  it("isInputRequiredResult is true for the write-once shape", () => {
    assert.equal(isInputRequiredResult(requestConfirmElicitation("adam_read_page")), true);
    assert.equal(isInputRequiredResult({ content: [] }), false);
  });

  it("modern envelope and legacy initialize paths build the same shape", () => {
    const modernCtx = {
      mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: { form: {} } } } },
    };
    const legacyServer = {
      server: { getClientCapabilities: () => ({ elicitation: { form: {} } }) },
    };
    assert.equal(clientSupportsElicitation(modernCtx), true);
    assert.equal(clientSupportsElicitation({}, legacyServer), true);
    const modernShape = requestConfirmElicitation("adam_get_exercise");
    const legacyShape = requestConfirmElicitation("adam_get_exercise");
    assert.deepEqual(modernShape, legacyShape);
    assert.equal(isInputRequiredResult(modernShape), true);
    assert.equal(isInputRequiredResult(legacyShape), true);
  });
});

describe("elicitation spike: untrusted boolean gate", () => {
  it("isElicitedYes accepts strict boolean true only", () => {
    assert.equal(isElicitedYes({ confirm: true }), true);
    assert.equal(isElicitedYes({ confirm: false }), false);
    assert.equal(isElicitedYes({ confirm: "true" }), false);
    assert.equal(isElicitedYes({ confirm: 1 }), false);
    assert.equal(isElicitedYes(undefined), false);
    assert.equal(isElicitedYes(null), false);
    assert.equal(isElicitedYes("yes"), false);
    // acceptedContent round-trips the boolean gate without echoing bodies.
    const yes = acceptedContent({ confirm: { action: "accept", content: { confirm: true } } }, "confirm");
    const no = acceptedContent({ confirm: { action: "accept", content: { confirm: false } } }, "confirm");
    assert.equal(isElicitedYes(yes), true);
    assert.equal(isElicitedYes(no), false);
    assert.equal(
      typeof yes === "object" && yes !== null ? (yes as { confirm?: unknown }).confirm : undefined,
      true,
    );
  });

  it("elicitationOutcome distinguishes accept, decline, cancel, and missing", () => {
    assert.equal(elicitationOutcome({ confirm: { action: "accept", content: { confirm: true } } }), "accepted-yes");
    assert.equal(elicitationOutcome({ confirm: { action: "accept", content: { confirm: false } } }), "accepted-no");
    assert.equal(elicitationOutcome({ confirm: { action: "accept", content: {} } }), "accepted-no");
    assert.equal(elicitationOutcome({ confirm: { action: "decline" } }), "declined");
    assert.equal(elicitationOutcome({ confirm: { action: "cancel" } }), "cancelled");
    assert.equal(elicitationOutcome(undefined), "missing");
    assert.equal(elicitationOutcome({}), "missing");
  });
});

describe("elicitation spike: capability gate", () => {
  it("supports elicitation via the modern per-request envelope", () => {
    const capable = {
      mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: { form: {} } } } },
    };
    assert.equal(clientSupportsElicitation(capable), true);
    const bareForm = {
      mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: {} } } },
    };
    assert.equal(clientSupportsElicitation(bareForm), true);
  });

  it("refuses modern envelope hosts without elicitation", () => {
    const without = {
      mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: {} } },
    };
    assert.equal(clientSupportsElicitation(without), false);
    const emptyEnvelope = { mcpReq: { envelope: {} } };
    assert.equal(clientSupportsElicitation(emptyEnvelope), false);
  });

  it("supports elicitation via legacy getClientCapabilities", () => {
    const form = { server: { getClientCapabilities: () => ({ elicitation: { form: {} } }) } };
    assert.equal(clientSupportsElicitation({}, form), true);
    const bare = { server: { getClientCapabilities: () => ({ elicitation: {} }) } };
    assert.equal(clientSupportsElicitation({}, bare), true);
  });

  it("fail-closes when capabilities are unknown; decline uses distinct safe text", () => {
    assert.equal(clientSupportsElicitation(undefined, undefined), false);
    assert.equal(clientSupportsElicitation({}, {}), false);
    assert.equal(
      clientSupportsElicitation({}, { server: { getClientCapabilities: () => ({}) } }),
      false,
    );
    for (const outcome of ["declined", "cancelled"] as const) {
      const error = declineFallbackError("adam_read_page", outcome);
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "confirmation_required");
      assert.match(error.message, new RegExp(outcome));
      assert.match(error.message, /confirm:true/);
      assert.doesNotMatch(error.message, /-32021/);
    }
    // inputRequired.elicit stays callable with the flat schema (no throw).
    const built = inputRequired.elicit({
      message: "probe",
      requestedSchema: CONFIRM_ELICITATION_REQUESTED_SCHEMA as unknown as {
        type: "object";
        properties: { confirm: { type: "boolean" } };
        required: ["confirm"];
      },
    });
    assert.equal(built.method, "elicitation/create");
  });
});
