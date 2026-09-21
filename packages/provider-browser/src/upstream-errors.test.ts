import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { adamErrorFromAuthorizedHttpStatus, adamErrorFromNavigationFailure } from "./upstream-errors.ts";

describe("ADR 0016 authorized HTTP status map", () => {
  it("maps 404 to not_found (non-retryable)", () => {
    const error = adamErrorFromAuthorizedHttpStatus(404, "fetch");
    assert.equal(error.code, "not_found");
    assert.equal(error.retryable, false);
  });

  it("maps 401 to unauthorized and 403 to forbidden", () => {
    const unauthorized = adamErrorFromAuthorizedHttpStatus(401, "probe");
    assert.equal(unauthorized.code, "unauthorized");
    assert.equal(unauthorized.retryable, false);
    const forbidden = adamErrorFromAuthorizedHttpStatus(403, "fetch");
    assert.equal(forbidden.code, "forbidden");
    assert.equal(forbidden.retryable, false);
    assert.doesNotMatch(forbidden.message, /does not exist|not return an object|not_found/i);
    assert.match(forbidden.message, /not reported as missing|Access is denied/i);
  });

  it("maps 429 and 5xx to retryable provider_unavailable", () => {
    for (const status of [429, 500, 502, 503]) {
      const error = adamErrorFromAuthorizedHttpStatus(status, "probe");
      assert.equal(error.code, "provider_unavailable", `status ${status}`);
      assert.equal(error.retryable, true, `status ${status}`);
    }
  });
});

describe("ADR 0016 navigation failure map", () => {
  it("maps Playwright timeout and net errors to retryable provider_unavailable", () => {
    const timeout = new Error("page.goto: Timeout 45000ms exceeded.");
    timeout.name = "TimeoutError";
    const mappedTimeout = adamErrorFromNavigationFailure(timeout);
    assert.ok(mappedTimeout);
    assert.equal(mappedTimeout.code, "provider_unavailable");
    assert.equal(mappedTimeout.retryable, true);

    const net = adamErrorFromNavigationFailure(new Error("net::ERR_CONNECTION_RESET at https://adam.unibas.ch/"));
    assert.ok(net);
    assert.equal(net.code, "provider_unavailable");
    assert.equal(net.retryable, true);
  });

  it("leaves unexpected bugs unmapped so ADR 0011 keeps retryable=false", () => {
    assert.equal(adamErrorFromNavigationFailure(new Error("boom in evaluate")), undefined);
    assert.equal(adamErrorFromNavigationFailure(new AdamError("not_found", "already typed")), undefined);
  });
});
