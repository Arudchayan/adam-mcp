import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AdamError } from "adam-core";
import { formatCliError } from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

describe("CLI startup errors", () => {
  it("includes the AdamError code and retryable flag", () => {
    const line = formatCliError(
      new AdamError(
        "provider_unavailable",
        'ADAM_PROVIDER="fixture" is not a runtime provider. The synthetic catalog is test-only.',
        false,
      ),
    );
    assert.match(line, /^provider_unavailable:/);
    assert.match(line, /retryable=false/);
  });

  it("refuses ADAM_PROVIDER=fixture on stderr and exits non-zero", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, ADAM_PROVIDER: "fixture" };
    delete env.ADAM_MCP_TEST_FIXTURE;
    const child = spawn(
      process.execPath,
      [resolve(repoRoot, "node_modules/tsx/dist/cli.mjs"), resolve(here, "index.ts")],
      {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const code = await new Promise<number | null>((resolveCode, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`fixture refusal timed out. stderr=${stderr}`));
      }, 30_000);
      child.on("exit", (exitCode) => {
        clearTimeout(timer);
        resolveCode(exitCode);
      });
    });
    assert.equal(code, 1);
    assert.match(stderr, /provider_unavailable/);
    assert.match(stderr, /retryable=false/);
    assert.match(stderr, /not a runtime provider/);
  });
});
