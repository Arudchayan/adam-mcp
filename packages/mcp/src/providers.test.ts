import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import {
  closeConfiguredProvider,
  createConfiguredProvider,
  parseProviderName,
} from "./providers.ts";
import { createAdamMcpServer } from "./server.ts";
import { createFixtureProvider } from "adam-provider-fixture";

const here = dirname(fileURLToPath(import.meta.url));

describe("parseProviderName", () => {
  it("refuses soap and html at boot (fail-closed, non-retryable)", () => {
    for (const name of ["soap", "html"] as const) {
      assert.throws(() => parseProviderName(name), (error: unknown) => {
        assert.ok(error instanceof AdamError);
        assert.equal(error.code, "provider_unavailable");
        assert.equal(error.retryable, false);
        assert.match(error.message, /disabled|fail-closed|ADR/i);
        return true;
      });
    }
  });

  it("defaults to fixture and rejects unknown names", () => {
    assert.equal(parseProviderName(undefined), "fixture");
    assert.equal(parseProviderName("browser"), "browser");
    assert.throws(() => parseProviderName("scrape-everything"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      return true;
    });
  });
});

describe("lazy browser provider", () => {
  it("providers.ts has no top-level adam-provider-browser import", () => {
    const source = readFileSync(resolve(here, "providers.ts"), "utf8");
    assert.doesNotMatch(
      source,
      /^import\s+[^;]*from\s+["']adam-provider-browser["']/m,
      "static import would pull playwright-core on every fixture boot",
    );
    assert.match(source, /await\s+import\(\s*["']adam-provider-browser["']\s*\)/);
  });

  it("createConfiguredProvider('fixture') returns fixture tools without loading browser", async () => {
    const configured = await createConfiguredProvider("fixture");
    assert.equal(configured.session, undefined);
    const server = createAdamMcpServer(configured);
    const toolNames = Object.keys(server["_registeredTools"] as Record<string, unknown>);
    assert.ok(toolNames.includes("adam_list_courses"));
    assert.equal(toolNames.includes("adam_login"), false);
    await closeConfiguredProvider(configured);
  });

  it("createConfiguredProvider refuses soap/html without loading browser", async () => {
    for (const name of ["soap", "html"] as const) {
      await assert.rejects(
        () => createConfiguredProvider(name),
        (error: unknown) => {
          assert.ok(error instanceof AdamError);
          assert.equal(error.code, "provider_unavailable");
          return true;
        },
      );
    }
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
