import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFixtureProvider } from "adam-provider-fixture";
import { createAdamMcpServer } from "./server.ts";
import {
  getExerciseInputSchema,
  getForumInputSchema,
  objectRefFieldsSchema,
  readPageInputSchema,
} from "./schemas.ts";
import { stripExerciseInstructionBodies } from "./results.ts";

describe("agent contracts: refId normalization", () => {
  it("accepts digits, adam:// handles, and pinned ADAM /go/ URLs", () => {
    assert.deepEqual(objectRefFieldsSchema.parse({ refId: "100021" }), {
      refId: "100021",
      type: undefined,
    });
    assert.deepEqual(objectRefFieldsSchema.parse({ refId: "adam://exc/100021" }), {
      refId: "100021",
      type: "exc",
    });
    assert.deepEqual(
      objectRefFieldsSchema.parse({ refId: "https://adam.unibas.ch/go/exc/100021" }),
      { refId: "100021", type: "exc" },
    );
    assert.deepEqual(
      objectRefFieldsSchema.parse({ refId: "adam://exc/100021", type: "exc" }),
      { refId: "100021", type: "exc" },
    );
  });

  it("rejects titles, foreign origins, and type conflicts", () => {
    assert.equal(objectRefFieldsSchema.safeParse({ refId: "Homework 1" }).success, false);
    assert.equal(
      objectRefFieldsSchema.safeParse({ refId: "https://evil.example/go/crs/100001" }).success,
      false,
    );
    assert.equal(
      objectRefFieldsSchema.safeParse({ refId: "adam://exc/100021", type: "fold" }).success,
      false,
    );
  });

  it("passes normalized type into confirm-gated schemas", () => {
    const parsed = readPageInputSchema.parse({
      refId: "https://adam.unibas.ch/go/crs/100001",
      confirm: true,
    });
    assert.equal(parsed.refId, "100001");
    assert.equal(parsed.type, "crs");
    assert.equal(parsed.confirm, true);
  });
});

describe("agent contracts: forum confirm schema", () => {
  it("allows summary without confirm; requires confirm:true with threadId", () => {
    assert.equal(getForumInputSchema.safeParse({ refId: "100040" }).success, true);
    assert.equal(
      getForumInputSchema.safeParse({ refId: "100040", threadId: "200001" }).success,
      false,
    );
    assert.equal(
      getForumInputSchema.safeParse({
        refId: "100040",
        threadId: "200001",
        confirm: false,
      }).success,
      false,
    );
    assert.equal(
      getForumInputSchema.safeParse({
        refId: "adam://frm/100040",
        threadId: "200001",
        confirm: true,
      }).success,
      true,
    );
  });
});

describe("agent contracts: exercise resource vs tool bodies", () => {
  it("stripExerciseInstructionBodies drops instructionText but keeps deadline/status", () => {
    const stripped = stripExerciseInstructionBodies({
      type: "exc",
      refId: "100021",
      title: "Homework",
      url: "https://adam.unibas.ch/go/exc/100021",
      breadcrumb: [],
      provenance: {
        sourceUrl: "https://adam.unibas.ch/go/exc/100021",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        provider: "fixture",
      },
      units: [
        {
          title: "Unit 1",
          deadline: "2026-06-01T12:00:00.000Z",
          instructionText: "SECRET BODY",
          ownStatus: "none",
        },
      ],
    });
    assert.equal("instructionText" in stripped.units[0]!, false);
    assert.equal(stripped.units[0]?.deadline, "2026-06-01T12:00:00.000Z");
    assert.equal(stripped.units[0]?.ownStatus, "none");
  });

  it("exercise tool schema still requires confirm:true", () => {
    assert.equal(getExerciseInputSchema.safeParse({ refId: "100021" }).success, false);
    assert.equal(
      getExerciseInputSchema.safeParse({ refId: "100021", confirm: true }).success,
      true,
    );
  });
});

describe("agent contracts: prompts require exercise confirm", () => {
  it("prepare_my_week and study_this mention adam_get_exercise with confirm", async () => {
    const server = createAdamMcpServer({ provider: createFixtureProvider() });
    const prompts = server["_registeredPrompts"] as Record<
      string,
      {
        handler: (args: Record<string, string | undefined>) => Promise<{
          messages: Array<{ content: { text: string } }>;
        }>;
      }
    >;
    const week = await prompts.prepare_my_week.handler({});
    const study = await prompts.study_this.handler({ refId: "100021" });
    assert.match(week.messages[0]!.content.text, /adam_get_exercise[^\n]*confirm\s*=\s*true/i);
    assert.match(study.messages[0]!.content.text, /adam_get_exercise[^\n]*confirm\s*=\s*true/i);
  });
});

describe("agent contracts: server instructions", () => {
  it("covers listingState, listingNotice, children vs files, calendar, search match, partial, login", () => {
    const server = createAdamMcpServer({ provider: createFixtureProvider() });
    const instructions = String(
      (server.server as unknown as { _instructions?: unknown })._instructions ?? "",
    );
    assert.match(instructions, /listingState/);
    assert.match(instructions, /listingNotice/);
    assert.match(instructions, /nextCursor/);
    assert.match(instructions, /adam_list_children/);
    assert.match(instructions, /adam_list_files/);
    assert.match(instructions, /lecture timetable/i);
    assert.match(instructions, /match=title\|body/);
    assert.match(instructions, /partial\/skipped/);
    assert.match(instructions, /adam-mcp login/);
    assert.match(instructions, /Resources are for handles/);
  });

  it("covers error recovery and get_course listing honesty", () => {
    const server = createAdamMcpServer({ provider: createFixtureProvider() });
    const instructions = String(
      (server.server as unknown as { _instructions?: unknown })._instructions ?? "",
    );
    assert.match(instructions, /unauthorized[^\n]*re-login|unauthorized → re-login/i);
    assert.match(instructions, /do not keep searching/i);
    assert.match(instructions, /forbidden[^\n]*not missing|forbidden → not missing/i);
    assert.match(instructions, /not_found → absent/);
    assert.match(instructions, /stale_id[^\n]*refresh the listing/i);
    assert.match(instructions, /provider_unavailable[^\n]*retry once/i);
    assert.match(instructions, /retryable=false → stop/);
    assert.match(instructions, /listingState,\s*truncated,\s*totalChildrenHint/);
    assert.match(instructions, /not 'no materials'/);

    const tools = server["_registeredTools"] as Record<string, { description?: string }>;
    assert.match(String(tools.adam_get_course?.description), /listingState,\s*truncated,\s*totalChildrenHint/);
    assert.match(String(tools.adam_list_children?.description), /stale_id[^\n]*refresh the listing/i);
    assert.doesNotMatch(
      String(tools.adam_list_children?.description),
      /not_found is the only missing-object error/,
    );
  });
});
