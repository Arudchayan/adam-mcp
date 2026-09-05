import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { parseProviderName } from "./providers.ts";
import { createAdamMcpServer } from "./server.ts";
import { createFixtureProvider } from "adam-provider-fixture";

describe("parseProviderName", () => {
  it("defaults to fixture and rejects unknown names", () => {
    assert.equal(parseProviderName(undefined), "fixture");
    assert.equal(parseProviderName("browser"), "browser");
    assert.throws(() => parseProviderName("scrape-everything"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      return true;
    });
  });
});

describe("session tools", () => {
  it("registers login tools only when a session controller is provided", () => {
    const withSession = createAdamMcpServer({
      provider: createFixtureProvider(),
      session: {
        async status() {
          return { loggedIn: false };
        },
        async login() {
          return { loggedIn: true };
        },
      },
    });
    const withoutSession = createAdamMcpServer({ provider: createFixtureProvider() });
    assert.equal(typeof withSession, "object");
    assert.equal(typeof withoutSession, "object");
  });
});
