import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { READ_ONLY_TOOLS, SESSION_TOOLS } from "./results.ts";
import { extractFileInputSchema, readPageInputSchema } from "./schemas.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

describe("adam_read_page confirmation", () => {
  it("rejects missing or false confirm", () => {
    assert.equal(readPageInputSchema.safeParse({ refId: "1" }).success, false);
    assert.equal(readPageInputSchema.safeParse({ refId: "1", confirm: false }).success, false);
    assert.equal(readPageInputSchema.safeParse({ refId: "1", confirm: true }).success, true);
  });
});

describe("adam_extract_file_text confirmation", () => {
  it("rejects missing or false confirm", () => {
    assert.equal(extractFileInputSchema.safeParse({ refId: "100011" }).success, false);
    assert.equal(extractFileInputSchema.safeParse({ refId: "100011", confirm: false }).success, false);
    assert.equal(extractFileInputSchema.safeParse({ refId: "100011", confirm: true }).success, true);
  });
});

describe("stdio hygiene", () => {
  it("prints the banner on stderr and JSON-RPC on stdout", async () => {
    const child = spawn(
      process.execPath,
      [resolve(repoRoot, "node_modules/tsx/dist/cli.mjs"), resolve(here, "index.ts")],
      {
        cwd: repoRoot,
        env: { ...process.env, ADAM_PROVIDER: "fixture" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "hygiene-test", version: "0.0.1" },
        },
      })}\n`,
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`stdio hygiene timed out. stderr=${stderr} stdout=${stdout}`));
      }, 12_000);
      const onData = () => {
        if (!stdout.includes("\n")) {
          return;
        }
        clearTimeout(timer);
        child.kill();
        resolve();
      };
      child.stdout.on("data", onData);
    });
    assert.match(stderr, /adam-mcp running on stdio/);
    assert.equal(stdout.trim().startsWith("{"), true);
    assert.doesNotMatch(stdout, /adam-mcp running on stdio/);
    const line = stdout.trim().split(/\r?\n/)[0] ?? "";
    const parsed = JSON.parse(line) as { jsonrpc?: string };
    assert.equal(parsed.jsonrpc, "2.0");
  });
});

type JsonRpc = {
  jsonrpc?: string;
  id?: number;
  error?: { code?: number; message?: string };
  result?: {
    tools?: Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean };
      outputSchema?: { type?: string };
    }>;
    resources?: Array<{ uri?: string; name?: string }>;
    resourceTemplates?: Array<{ uriTemplate?: string; name?: string }>;
    prompts?: Array<{ name: string }>;
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
};

function spawnFixtureServer(): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [resolve(repoRoot, "node_modules/tsx/dist/cli.mjs"), resolve(here, "index.ts")],
    {
      cwd: repoRoot,
      env: { ...process.env, ADAM_PROVIDER: "fixture" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

async function rpc(
  child: ChildProcessWithoutNullStreams,
  message: Record<string, unknown>,
): Promise<JsonRpc> {
  const id = message.id;
  let buffer = "";
  child.stdout.setEncoding("utf8");
  const reply = new Promise<JsonRpc>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`RPC timed out for ${String(message.method)}. stdout=${buffer}`));
    }, 12_000);
    const onData = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const parsed = JSON.parse(line) as JsonRpc;
        if (parsed.id === id) {
          clearTimeout(timer);
          child.stdout.off("data", onData);
          resolvePromise(parsed);
          return;
        }
      }
    };
    child.stdout.on("data", onData);
  });
  child.stdin.write(`${JSON.stringify(message)}\n`);
  return reply;
}

describe("MCP surface over stdio", () => {
  it("lists read-only tools, resources, and prompts after initialize", async () => {
    const child = spawnFixtureServer();
    child.stderr.resume();
    try {
      await rpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "surface-test", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      const tools = await rpc(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const listedTools = tools.result?.tools ?? [];
      const names = listedTools.map((tool) => tool.name);
      for (const expected of READ_ONLY_TOOLS) {
        assert.equal(names.includes(expected), true, `missing ${expected}`);
      }
      assert.equal(names.some((name) => name.includes("post") || name.includes("submit")), false);
      assert.equal(
        listedTools.every((tool) =>
          READ_ONLY_TOOLS.includes(tool.name as (typeof READ_ONLY_TOOLS)[number])
            ? tool.annotations?.readOnlyHint === true
            : true,
        ),
        true,
      );
      for (const expected of READ_ONLY_TOOLS) {
        const declared = listedTools.find((tool) => tool.name === expected);
        assert.equal(declared?.outputSchema?.type, "object", `${expected} must advertise an object outputSchema`);
      }
      const courses = await rpc(child, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "adam_list_courses", arguments: {} },
      });
      assert.equal(courses.error, undefined, courses.error?.message);
      assert.equal(courses.result?.isError, undefined);
      const items = courses.result?.structuredContent?.items;
      assert.equal(Array.isArray(items), true);
      assert.equal((items as Array<{ refId?: string }>)[0]?.refId, "100001");
      const missing = await rpc(child, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "adam_get_course", arguments: { refId: "999999" } },
      });
      assert.equal(missing.result?.isError, true);
      const resources = await rpc(child, { jsonrpc: "2.0", id: 3, method: "resources/list", params: {} });
      const uris = (resources.result?.resources ?? []).map((resource) => resource.uri ?? resource.name);
      assert.equal(uris.some((uri) => uri?.includes("adam://me/courses") || uri === "adam-courses"), true);
      const templates = await rpc(child, {
        jsonrpc: "2.0",
        id: 7,
        method: "resources/templates/list",
        params: {},
      });
      const templateUris = (templates.result?.resourceTemplates ?? []).map(
        (template) => template.uriTemplate ?? template.name,
      );
      for (const expected of ["adam://crs/{refId}", "adam://fold/{refId}", "adam://file/{refId}", "adam://exc/{refId}"]) {
        assert.equal(
          templateUris.some((uri) => uri?.includes(expected) || uri === expected),
          true,
          `missing resource template ${expected}; got ${templateUris.join(",")}`,
        );
      }
      const prompts = await rpc(child, { jsonrpc: "2.0", id: 4, method: "prompts/list", params: {} });
      const promptNames = (prompts.result?.prompts ?? []).map((prompt) => prompt.name);
      assert.equal(promptNames.includes("prepare_my_week"), true);
      assert.equal(promptNames.includes("what_changed"), true);
      assert.equal(promptNames.includes("study_this"), true);
      assert.deepEqual(
        SESSION_TOOLS.filter((name) => names.includes(name)),
        [],
      );
    } finally {
      child.kill();
    }
  });
});

