import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionFeedbackDocument } from "./session-feedback.ts";

describe("session feedback page", () => {
  it("renders a signed-in page without claiming to be a University service", () => {
    const html = sessionFeedbackDocument(
      "success",
      "You're signed in to ADAM",
      "Your editor can list courses now.",
    );
    assert.match(html, /You're signed in to ADAM/);
    assert.match(html, /ADAM MCP/);
    assert.match(html, /Not a University of Basel service/);
    assert.match(html, /Closes in/);
    assert.doesNotMatch(html, /password|PHPSESSID|cookie=/i);
  });

  it("renders a failure page for stale or unfinished SWITCH", () => {
    const html = sessionFeedbackDocument(
      "error",
      "ADAM sign-in did not finish",
      "Sign-in did not finish in time. If SWITCH said the request was too old, that form expired — run login again.",
    );
    assert.match(html, /did not finish/);
    assert.match(html, /too old|expired/);
    assert.doesNotMatch(html, /<script src=/);
  });
});
