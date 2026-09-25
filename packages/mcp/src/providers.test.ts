import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import {
  closeConfiguredProvider,
  createConfiguredProvider,
  detectProviderName,
  parseProviderName,
  TEST_FIXTURE_HARNESS_ENV,
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

  it("defaults to browser and rejects fixture and unknown names", () => {
    assert.equal(parseProviderName(undefined), "browser");
    assert.equal(parseProviderName(""), "browser");
    assert.equal(parseProviderName("browser"), "browser");
    assert.throws(() => parseProviderName("fixture"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "provider_unavailable");
      assert.equal(error.retryable, false);
      assert.match(error.message, /not a runtime provider|test-only/i);
      return true;
    });
    assert.throws(() => parseProviderName("scrape-everything"), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      return true;
    });
  });
});

describe("detectProviderName", () => {
  it("selects browser by default and treats --browser as an alias", () => {
    assert.equal(detectProviderName({}, []), "browser");
    assert.equal(detectProviderName({ ADAM_PROVIDER: "browser" }, []), "browser");
    assert.equal(detectProviderName({ ADAM_PROVIDER: "fixture" }, ["--browser"]), "browser");
  });

  it("allows the test harness to select fixture", () => {
    assert.equal(detectProviderName({ [TEST_FIXTURE_HARNESS_ENV]: "1" }, []), "fixture");
    assert.equal(
      detectProviderName({ [TEST_FIXTURE_HARNESS_ENV]: "1", ADAM_PROVIDER: "fixture" }, []),
      "fixture",
    );
  });

  it("refuses ADAM_PROVIDER=fixture without the test harness", () => {
    assert.throws(() => detectProviderName({ ADAM_PROVIDER: "fixture" }, []), (error: unknown) => {
      assert.ok(error instanceof AdamError);
      assert.equal(error.code, "provider_unavailable");
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
      "static import would pull playwright-core on every in-process fixture boot",
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

  it("fake session surfaces adam_login/adam_session_status without cookies/passwords/profile path", async () => {
    const withSession = createAdamMcpServer({
      provider: createFixtureProvider(),
      session: {
        async status() {
          return {
            loggedIn: true,
            reason: "signed-in",
            origin: "https://adam.unibas.ch",
            checkedAt: "2026-01-01T00:00:00.000Z",
            holderPid: 4242,
          };
        },
        async login() {
          return { loggedIn: true, reason: "signed-in" };
        },
      },
    });
    const withoutSession = createAdamMcpServer({ provider: createFixtureProvider() });

    type ToolEntry = {
      handler: (args: Record<string, unknown>) => Promise<{
        content: Array<{ text?: string }>;
        structuredContent?: Record<string, unknown>;
      }>;
    };
    const withTools = withSession["_registeredTools"] as Record<string, ToolEntry>;
    const withoutTools = withoutSession["_registeredTools"] as Record<string, ToolEntry>;
    const withNames = Object.keys(withTools);
    const withoutNames = Object.keys(withoutTools);

    assert.equal(withNames.includes("adam_login"), true);
    assert.equal(withNames.includes("adam_session_status"), true);
    assert.equal(withoutNames.includes("adam_login"), false);
    assert.equal(withoutNames.includes("adam_session_status"), false);

    const status = await withTools.adam_session_status.handler({});
    const blob = `${JSON.stringify(status.structuredContent ?? {})}\n${status.content[0]?.text ?? ""}`;
    assert.doesNotMatch(blob, /cookie|password|profileDir|profile path|ILIASSESSID/i);
    assert.equal(status.structuredContent?.loggedIn, true);
    assert.equal(status.structuredContent?.origin, "https://adam.unibas.ch");
  });
});
