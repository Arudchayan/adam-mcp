import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CATALOG_ONLY_COURSE_ID,
  GOLDEN_TST_REF_ID,
  NEWS_OFF_COURSE_ID,
} from "adam-provider-fixture";
import { READ_ONLY_TOOLS, SESSION_TOOLS, UNTRUSTED_PAGE_NOTICE } from "./results.ts";
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
    protocolVersion?: string;
    capabilities?: Record<string, unknown>;
    serverInfo?: { name?: string; version?: string };
    tools?: Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean };
      inputSchema?: {
        required?: string[];
        properties?: Record<string, { const?: unknown; type?: string }>;
      };
      outputSchema?: { type?: string };
    }>;
    resources?: Array<{ uri?: string; name?: string }>;
    resourceTemplates?: Array<{ uriTemplate?: string; name?: string }>;
    prompts?: Array<{ name: string }>;
    content?: Array<{ type?: string; text?: string; uri?: string; name?: string }>;
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


function processHasListeningTcp(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false;
  }
  const listeningInodes = new Set<string>();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"] as const) {
    let body = "";
    try {
      body = readFileSync(table, "utf8");
    } catch {
      continue;
    }
    for (const line of body.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      // Linux TCP state 0A = LISTEN
      if (parts.length >= 10 && parts[3] === "0A") {
        listeningInodes.add(parts[9]!);
      }
    }
  }
  if (listeningInodes.size === 0) {
    return false;
  }
  let fds: string[] = [];
  try {
    fds = readdirSync(`/proc/${pid}/fd`);
  } catch {
    return false;
  }
  for (const fd of fds) {
    try {
      const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (match && listeningInodes.has(match[1]!)) {
        return true;
      }
    } catch {
      // ignore raced fds
    }
  }
  return false;
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

describe("B4 confirm RPC", () => {
  it("rejects omit/false and succeeds only with confirm: true for page and extract", async () => {
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
          clientInfo: { name: "b4-confirm-rpc-test", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const tools = await rpc(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      for (const name of ["adam_read_page", "adam_extract_file_text"] as const) {
        const tool = (tools.result?.tools ?? []).find((entry) => entry.name === name);
        assert.ok(tool, `missing ${name}`);
        assert.equal(tool.inputSchema?.required?.includes("confirm"), true, `${name} must require confirm`);
        assert.equal(tool.inputSchema?.properties?.confirm?.const, true, `${name} confirm const must be true`);
      }

      const pageOmit = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "adam_read_page", arguments: { refId: "100001" } },
      });
      assert.equal(pageOmit.result?.isError, true);
      assert.match(pageOmit.result?.content?.[0]?.text ?? "", /confirm/i);
      assert.equal(pageOmit.result?.structuredContent, undefined);

      const pageFalse = await rpc(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "adam_read_page", arguments: { refId: "100001", confirm: false } },
      });
      assert.equal(pageFalse.result?.isError, true);
      assert.match(pageFalse.result?.content?.[0]?.text ?? "", /confirm/i);
      assert.equal(pageFalse.result?.structuredContent, undefined);

      const pageOk = await rpc(child, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "adam_read_page", arguments: { refId: "100001", confirm: true } },
      });
      assert.equal(pageOk.error, undefined, pageOk.error?.message);
      assert.equal(pageOk.result?.isError, undefined);
      assert.equal(pageOk.result?.structuredContent?.untrusted, true);
      assert.equal(typeof pageOk.result?.structuredContent?.text, "string");

      const extractOmit = await rpc(child, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "adam_extract_file_text", arguments: { refId: "100011" } },
      });
      assert.equal(extractOmit.result?.isError, true);
      assert.match(extractOmit.result?.content?.[0]?.text ?? "", /confirm/i);
      assert.equal(extractOmit.result?.structuredContent, undefined);

      const extractFalse = await rpc(child, {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "adam_extract_file_text", arguments: { refId: "100011", confirm: false } },
      });
      assert.equal(extractFalse.result?.isError, true);
      assert.match(extractFalse.result?.content?.[0]?.text ?? "", /confirm/i);
      assert.equal(extractFalse.result?.structuredContent, undefined);

      const extractOk = await rpc(child, {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "adam_extract_file_text", arguments: { refId: "100011", confirm: true } },
      });
      assert.equal(extractOk.error, undefined, extractOk.error?.message);
      assert.equal(extractOk.result?.isError, undefined);
      assert.equal(extractOk.result?.structuredContent?.untrusted, true);
      assert.equal("bytes" in (extractOk.result?.structuredContent ?? {}), false);
      assert.equal(typeof extractOk.result?.structuredContent?.sha256, "string");
    } finally {
      child.kill();
    }
  });
});

describe("B6 untrusted notice on page/extract", () => {
  it("returns untrusted: true and a notice string for adam_read_page and adam_extract_file_text", async () => {
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
          clientInfo: { name: "b6-untrusted-test", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const page = await rpc(child, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "adam_read_page",
          arguments: { refId: "100001", confirm: true },
        },
      });
      assert.equal(page.error, undefined, page.error?.message);
      assert.equal(page.result?.isError, undefined);
      assert.equal(page.result?.structuredContent?.untrusted, true);
      assert.equal(typeof page.result?.structuredContent?.notice, "string");
      assert.ok(String(page.result?.structuredContent?.notice ?? "").length > 0);
      assert.equal(page.result?.structuredContent?.notice, UNTRUSTED_PAGE_NOTICE);
      assert.match(page.result?.content?.[0]?.text ?? "", /"untrusted": true/);
      assert.match(page.result?.content?.[0]?.text ?? "", /untrusted data/i);

      const extract = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "adam_extract_file_text",
          arguments: { refId: "100011", confirm: true },
        },
      });
      assert.equal(extract.error, undefined, extract.error?.message);
      assert.equal(extract.result?.isError, undefined);
      assert.equal(extract.result?.structuredContent?.untrusted, true);
      assert.equal(typeof extract.result?.structuredContent?.notice, "string");
      assert.ok(String(extract.result?.structuredContent?.notice ?? "").length > 0);
      assert.equal(extract.result?.structuredContent?.notice, UNTRUSTED_PAGE_NOTICE);
      assert.match(extract.result?.content?.[0]?.text ?? "", /"untrusted": true/);
      assert.match(extract.result?.content?.[0]?.text ?? "", /untrusted data/i);
      assert.equal("bytes" in (extract.result?.structuredContent ?? {}), false);
    } finally {
      child.kill();
    }
  });
});

describe("B10 tst deny fail-closed", () => {
  it("denies read/get for golden tst and keeps happy-path lists clean", async () => {
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
          clientInfo: { name: "b10-tst-deny-test", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const denied = await rpc(child, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "adam_read_page",
          arguments: { refId: GOLDEN_TST_REF_ID, confirm: true },
        },
      });
      assert.equal(denied.error, undefined, denied.error?.message);
      assert.equal(denied.result?.isError, true);
      const deniedText = denied.result?.content?.[0]?.text ?? "";
      assert.match(deniedText, /^unsupported_type:/);
      assert.match(deniedText, /tst/i);
      assert.match(deniedText, /not sent to the model/i);
      assert.doesNotMatch(deniedText, /DFT|Answer key|BLOCKED EXAM/i);
      assert.equal(denied.result?.structuredContent, undefined);

      const courseDenied = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "adam_get_course",
          arguments: { refId: GOLDEN_TST_REF_ID },
        },
      });
      assert.equal(courseDenied.result?.isError, true);
      assert.match(courseDenied.result?.content?.[0]?.text ?? "", /unsupported_type/);
      assert.match(courseDenied.result?.content?.[0]?.text ?? "", /tst/i);
      assert.doesNotMatch(courseDenied.result?.content?.[0]?.text ?? "", /DFT|Answer key|BLOCKED EXAM/i);

      const exerciseDenied = await rpc(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "adam_get_exercise",
          arguments: { refId: GOLDEN_TST_REF_ID },
        },
      });
      assert.equal(exerciseDenied.result?.isError, true);
      assert.match(exerciseDenied.result?.content?.[0]?.text ?? "", /unsupported_type|tst|blocked/i);
      assert.doesNotMatch(exerciseDenied.result?.content?.[0]?.text ?? "", /DFT|Answer key/i);

      const children = await rpc(child, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "adam_list_children",
          arguments: { refId: "100001" },
        },
      });
      assert.equal(children.error, undefined, children.error?.message);
      assert.equal(children.result?.isError, undefined);
      const items = children.result?.structuredContent?.items;
      assert.equal(Array.isArray(items), true);
      const listed = items as Array<{ refId?: string; type?: string; title?: string }>;
      assert.deepEqual(
        listed.map((item) => item.refId),
        ["100010", "100020", "100021"],
      );
      assert.equal(listed.some((item) => item.type === "tst"), false);

      const search = await rpc(child, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "adam_search",
          arguments: { query: "BLOCKED EXAM CONTENT" },
        },
      });
      assert.equal(search.error, undefined, search.error?.message);
      assert.equal(search.result?.isError, undefined);
      const searchItems = search.result?.structuredContent?.items;
      assert.equal(Array.isArray(searchItems), true);
      assert.equal((searchItems as unknown[]).length, 0);
    } finally {
      child.kill();
    }
  });
});

describe("B11 no deprecated MCP primitives", () => {
  it("initialize capabilities omit Sampling, Roots, and Logging; no HTTP listener", async () => {
    const child = spawnFixtureServer();
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    try {
      const init = await rpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "b11-deprecated-primitives", version: "0.0.1" },
        },
      });
      assert.equal(init.error, undefined, init.error?.message);
      const capabilities = init.result?.capabilities ?? {};
      assert.equal("sampling" in capabilities, false, "must not advertise sampling");
      assert.equal("roots" in capabilities, false, "must not advertise roots");
      assert.equal("logging" in capabilities, false, "must not advertise MCP logging");
      assert.equal("tools" in capabilities, true);
      assert.equal("resources" in capabilities, true);
      assert.equal("prompts" in capabilities, true);

      assert.equal(
        processHasListeningTcp(child.pid),
        false,
        "stdio MCP must not open an HTTP/SSE / Streamable HTTP listener",
      );
      assert.match(stderr, /adam-mcp running on stdio/);
      assert.doesNotMatch(stderr, /listen|http\+|streamable|sse/i);
    } finally {
      child.kill();
    }
  });
});

describe("B12 no MCP OAuth on stdio", () => {
  it("tools/list and fixture wiring expose no oauth/authorize endpoints", async () => {
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
          clientInfo: { name: "b12-no-oauth", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      const tools = await rpc(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const names = (tools.result?.tools ?? []).map((tool) => tool.name);
      assert.equal(
        names.some((name) => /oauth|authorize/i.test(name)),
        false,
        `unexpected oauth/authorize tools: ${names.join(",")}`,
      );
      assert.equal(names.includes("adam_login"), false, "fixture must not expose login/oauth tools");

      // Keep Domain lock: empty Exercises fold ≠ no deadlines.
      const children = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "adam_list_children", arguments: { refId: "100001" } },
      });
      const items = children.result?.structuredContent?.items as Array<{ refId?: string }> | undefined;
      assert.deepEqual(
        (items ?? []).map((item) => item.refId),
        ["100010", "100020", "100021"],
      );
      const emptyFold = await rpc(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "adam_list_children", arguments: { refId: "100020" } },
      });
      assert.equal(emptyFold.result?.isError, undefined);
      assert.deepEqual(emptyFold.result?.structuredContent?.items, []);
      const exercise = await rpc(child, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "adam_get_exercise", arguments: { refId: "100021" } },
      });
      assert.equal(exercise.error, undefined, exercise.error?.message);
      assert.equal(exercise.result?.isError, undefined);
      assert.equal(exercise.result?.structuredContent?.refId, "100021");
    } finally {
      child.kill();
    }
  });
});

function assertAdamAndHttps(structured: Record<string, unknown> | undefined, text: string) {
  assert.ok(structured, "missing structuredContent");
  const blob = `${JSON.stringify(structured)}\n${text}`;
  assert.match(blob, /adam:\/\/(crs|fold|file|exc)\/\d+/);
  assert.match(blob, /https:\/\/adam\.unibas\.ch\/go\/(crs|fold|file|exc)\/\d+/);
}

describe("A1 resource links in tool results", () => {
  it("tool results include adam:// handles and canonical HTTPS citations", async () => {
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
          clientInfo: { name: "a1-resource-links", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const courses = await rpc(child, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "adam_list_courses", arguments: {} },
      });
      assert.equal(courses.error, undefined, courses.error?.message);
      assert.equal(courses.result?.isError, undefined);
      const items = courses.result?.structuredContent?.items as Array<{
        resourceUri?: string;
        url?: string;
        refId?: string;
      }>;
      assert.equal(items[0]?.resourceUri, "adam://crs/100001");
      assert.equal(items[0]?.url, "https://adam.unibas.ch/go/crs/100001");
      assertAdamAndHttps(courses.result?.structuredContent, courses.result?.content?.[0]?.text ?? "");
      assert.equal(
        (courses.result?.content ?? []).some(
          (block) => block.type === "resource_link" && block.uri === "adam://crs/100001",
        ),
        true,
      );

      const course = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "adam_get_course", arguments: { refId: "100001" } },
      });
      assert.equal(course.result?.structuredContent?.resourceUri, "adam://crs/100001");
      assert.equal(course.result?.structuredContent?.url, "https://adam.unibas.ch/go/crs/100001");

      const exercise = await rpc(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "adam_get_exercise", arguments: { refId: "100021" } },
      });
      assert.equal(exercise.result?.structuredContent?.resourceUri, "adam://exc/100021");
      assert.equal(exercise.result?.structuredContent?.url, "https://adam.unibas.ch/go/exc/100021");

      const file = await rpc(child, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "adam_get_file", arguments: { refId: "100011" } },
      });
      assert.equal(file.result?.structuredContent?.resourceUri, "adam://file/100011");
      assert.equal(file.result?.structuredContent?.url, "https://adam.unibas.ch/go/file/100011");
    } finally {
      child.kill();
    }
  });
});

describe("A2 progress on long walks", () => {
  it("emits progress notifications for search / calendar / extract when progressToken is set", async () => {
    const child = spawnFixtureServer();
    child.stderr.resume();
    const progress: Array<{ progressToken?: string | number; progress?: number; message?: string }> = [];
    let buffer = "";
    child.stdout.setEncoding("utf8");
    const onData = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            method?: string;
            params?: { progressToken?: string | number; progress?: number; message?: string };
          };
          if (parsed.method === "notifications/progress") {
            progress.push(parsed.params ?? {});
          }
        } catch {
          // ignore partial JSON races
        }
      }
    };
    child.stdout.on("data", onData);
    try {
      await rpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "a2-progress", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const search = await rpc(child, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "adam_search",
          arguments: { query: "Fourier" },
          _meta: { progressToken: "search-walk" },
        },
      });
      assert.equal(search.error, undefined, search.error?.message);
      assert.equal(search.result?.isError, undefined);
      assert.ok(progress.some((p) => p.progressToken === "search-walk" && (p.progress ?? 0) >= 1));
      assert.ok(progress.some((p) => /search/i.test(String(p.message ?? ""))));

      const beforeCal = progress.length;
      const calendar = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "adam_list_calendar",
          arguments: {},
          _meta: { progressToken: "calendar-walk" },
        },
      });
      assert.equal(calendar.error, undefined, calendar.error?.message);
      assert.ok(progress.slice(beforeCal).some((p) => p.progressToken === "calendar-walk"));

      const beforeExtract = progress.length;
      const extract = await rpc(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "adam_extract_file_text",
          arguments: { refId: "100011", confirm: true },
          _meta: { progressToken: "extract-walk" },
        },
      });
      assert.equal(extract.error, undefined, extract.error?.message);
      assert.equal(extract.result?.isError, undefined);
      assert.ok(progress.slice(beforeExtract).some((p) => p.progressToken === "extract-walk"));
      assert.ok(progress.length >= 3);
    } finally {
      child.stdout.off("data", onData);
      child.kill();
    }
  });
});

describe("A6 resources for read-by-id", () => {
  it("reads crs/fold/file/exc by adam:// resource URI and keeps get tools non-duplicative", async () => {
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
          clientInfo: { name: "a6-resources-read", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const tools = await rpc(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const names = (tools.result?.tools ?? []).map((tool) => tool.name).sort();
      assert.deepEqual(
        names.filter((name) => name.startsWith("adam_get_")),
        ["adam_get_course", "adam_get_exercise", "adam_get_file"],
      );

      const course = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: "adam://crs/100001" },
      });
      assert.equal(course.error, undefined, course.error?.message);
      const courseText = (course.result as { contents?: Array<{ text?: string; uri?: string }> } | undefined)
        ?.contents?.[0]?.text ?? "";
      assert.match(courseText, /"refId": "100001"/);
      assert.match(courseText, /https:\/\/adam\.unibas\.ch\/go\/crs\/100001/);

      const folder = await rpc(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "resources/read",
        params: { uri: "adam://fold/100020" },
      });
      assert.equal(folder.error, undefined, folder.error?.message);
      const folderText = (folder.result as { contents?: Array<{ text?: string }> } | undefined)
        ?.contents?.[0]?.text ?? "";
      assert.match(folderText, /"items"/);

      const file = await rpc(child, {
        jsonrpc: "2.0",
        id: 5,
        method: "resources/read",
        params: { uri: "adam://file/100011" },
      });
      assert.equal(file.error, undefined, file.error?.message);
      const fileText = (file.result as { contents?: Array<{ text?: string }> } | undefined)
        ?.contents?.[0]?.text ?? "";
      assert.match(fileText, /"refId": "100011"/);

      const exercise = await rpc(child, {
        jsonrpc: "2.0",
        id: 6,
        method: "resources/read",
        params: { uri: "adam://exc/100021" },
      });
      assert.equal(exercise.error, undefined, exercise.error?.message);
      const exerciseText = (exercise.result as { contents?: Array<{ text?: string }> } | undefined)
        ?.contents?.[0]?.text ?? "";
      assert.match(exerciseText, /"refId": "100021"/);

      // A1 tie-in: get-course tool result cites the same resource handle.
      const viaTool = await rpc(child, {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "adam_get_course", arguments: { refId: "100001" } },
      });
      assert.equal(viaTool.result?.structuredContent?.resourceUri, "adam://crs/100001");
    } finally {
      child.kill();
    }
  });
});


describe("AT1/AT2 adam_list_calendar cross-course deadlines", () => {
  it("aggregates deadlines with provenance, adam:// cites, and progress", async () => {
    const child = spawnFixtureServer();
    child.stderr.resume();
    const progress: Array<{ progressToken?: string | number; progress?: number }> = [];
    let buffer = "";
    child.stdout.setEncoding("utf8");
    const onData = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            method?: string;
            params?: { progressToken?: string | number; progress?: number };
          };
          if (parsed.method === "notifications/progress") {
            progress.push(parsed.params ?? {});
          }
        } catch {
          // ignore
        }
      }
    };
    child.stdout.on("data", onData);
    try {
      await rpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "at1-at2-deadlines", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      // Domain lock: empty Exercises fold ≠ no deadlines.
      const emptyFold = await rpc(child, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "adam_list_children", arguments: { refId: "100020" } },
      });
      assert.deepEqual(emptyFold.result?.structuredContent?.items, []);

      const calendar = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "adam_list_calendar",
          arguments: {},
          _meta: { progressToken: "deadline-walk" },
        },
      });
      assert.equal(calendar.error, undefined, calendar.error?.message);
      assert.equal(calendar.result?.isError, undefined);
      assert.ok(progress.some((p) => p.progressToken === "deadline-walk"));

      const items = calendar.result?.structuredContent?.items as Array<{
        title?: string;
        startsAt?: string;
        source?: string;
        confidence?: string;
        objectRefId?: string;
        url?: string;
        resourceUri?: string;
        provenance?: {
          sourceUrl?: string;
          fetchedAt?: string;
          provider?: string;
          freshness?: string;
          iliasVersion?: string;
        };
      }>;
      assert.ok(items && items.length >= 4);

      const sources = new Set(items.map((item) => item.source));
      assert.equal(sources.has("exc"), true);
      assert.equal(sources.has("page"), true);
      assert.equal(sources.has("calendar"), true);

      const exc = items.find((item) => item.objectRefId === "100021" && item.source === "exc");
      assert.ok(exc);
      assert.equal(exc?.startsAt, "2026-09-22T21:59:00.000Z");
      assert.equal(exc?.confidence, "explicit");
      assert.equal(exc?.url, "https://adam.unibas.ch/go/exc/100021");
      assert.equal(exc?.resourceUri, "adam://exc/100021");
      assert.equal(exc?.provenance?.provider, "fixture");
      assert.ok(exc?.provenance?.sourceUrl);
      assert.ok(exc?.provenance?.fetchedAt);
      assert.ok(exc?.provenance?.iliasVersion || exc?.provenance?.freshness);

      const crossCourse = items.find((item) => item.objectRefId === "100121" && item.source === "exc");
      assert.ok(crossCourse, "second enrolled course deadline must surface");
      assert.equal(crossCourse?.resourceUri, "adam://exc/100121");
      assert.equal(crossCourse?.url, "https://adam.unibas.ch/go/exc/100121");

      const undated = items.find(
        (item) => item.objectRefId === "100101" && item.source === "page" && item.startsAt === undefined,
      );
      assert.ok(undated, "honest omit when page date has no iso");

      assert.equal(items.some((item) => item.objectRefId === "100020"), false);

      // A6 freeze: no new get-by-id deadline tool.
      const tools = await rpc(child, { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} });
      const names = (tools.result?.tools ?? []).map((tool) => tool.name);
      assert.equal(names.includes("adam_list_calendar"), true);
      assert.equal(
        names.some((name) => /adam_get_deadline|adam_list_deadline/i.test(name)),
        false,
      );

      assertAdamAndHttps(calendar.result?.structuredContent, calendar.result?.content?.[0]?.text ?? "");
      assert.equal(
        (calendar.result?.content ?? []).some(
          (block) => block.type === "resource_link" && block.uri === "adam://exc/100021",
        ),
        true,
      );
    } finally {
      child.stdout.off("data", onData);
      child.kill();
    }
  });
});

describe("AT3 adam_search enrolled-tree ranking", () => {
  it("scopes to enrolled trees, ranks title before body, keeps A1/A2/B10", async () => {
    const child = spawnFixtureServer();
    child.stderr.resume();
    const progress: Array<{ progressToken?: string | number; progress?: number; message?: string }> = [];
    let buffer = "";
    child.stdout.setEncoding("utf8");
    const onData = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            method?: string;
            params?: { progressToken?: string | number; progress?: number; message?: string };
          };
          if (parsed.method === "notifications/progress") {
            progress.push(parsed.params ?? {});
          }
        } catch {
          // ignore
        }
      }
    };
    child.stdout.on("data", onData);
    try {
      await rpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "at3-search-ranking", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const tools = await rpc(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const names = (tools.result?.tools ?? []).map((tool) => tool.name);
      assert.equal(names.includes("adam_search"), true);
      assert.equal(names.some((name) => /adam_search_|adam_find_|adam_get_search/i.test(name)), false);

      const fourier = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "adam_search",
          arguments: { query: "Fourier" },
          _meta: { progressToken: "search-at3" },
        },
      });
      assert.equal(fourier.error, undefined, fourier.error?.message);
      assert.equal(fourier.result?.isError, undefined);
      assert.ok(progress.some((p) => p.progressToken === "search-at3"));

      const items = fourier.result?.structuredContent?.items as Array<{
        refId?: string;
        type?: string;
        url?: string;
        resourceUri?: string;
      }>;
      assert.ok(Array.isArray(items));
      assert.ok(items.some((item) => item.refId === "100001"));
      assert.equal(
        items.some((item) => item.refId === CATALOG_ONLY_COURSE_ID),
        false,
        "catalog-only course must not appear",
      );
      assert.equal(items.some((item) => item.type === "tst"), false);

      const exercises = await rpc(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "adam_search", arguments: { query: "Exercises" } },
      });
      assert.equal(exercises.error, undefined, exercises.error?.message);
      const exerciseItems = exercises.result?.structuredContent?.items as Array<{ refId?: string }>;
      const ids = exerciseItems.map((item) => item.refId);
      assert.ok(ids.includes("100020"));
      assert.ok(ids.includes("100001"));
      assert.ok((ids.indexOf("100020") as number) < (ids.indexOf("100001") as number));

      const blocked = await rpc(child, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "adam_search", arguments: { query: "BLOCKED EXAM CONTENT" } },
      });
      assert.equal((blocked.result?.structuredContent?.items as unknown[]).length, 0);

      // Domain lock regressions.
      const emptyFold = await rpc(child, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "adam_list_children", arguments: { refId: "100020" } },
      });
      assert.deepEqual(emptyFold.result?.structuredContent?.items, []);
      const exercise = await rpc(child, {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "adam_get_exercise", arguments: { refId: "100021" } },
      });
      assert.equal(exercise.result?.structuredContent?.type, "exc");

      assertAdamAndHttps(fourier.result?.structuredContent, fourier.result?.content?.[0]?.text ?? "");
      const hit = items.find((item) => item.refId === "100001");
      assert.equal(hit?.url, "https://adam.unibas.ch/go/crs/100001");
      assert.equal(hit?.resourceUri, "adam://crs/100001");
      assert.equal(
        (fourier.result?.content ?? []).some(
          (block) => block.type === "resource_link" && block.uri === "adam://crs/100001",
        ),
        true,
      );
    } finally {
      child.stdout.off("data", onData);
      child.kill();
    }
  });
});

describe("AT4 adam_list_news reliability", () => {
  it("scopes to news-on enrolled courses with A1 cites, since, and A2 progress", async () => {
    const child = spawnFixtureServer();
    child.stderr.resume();
    const progress: Array<{ progressToken?: string | number; progress?: number; message?: string }> = [];
    let buffer = "";
    child.stdout.setEncoding("utf8");
    const onData = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            method?: string;
            params?: { progressToken?: string | number; progress?: number; message?: string };
          };
          if (parsed.method === "notifications/progress") {
            progress.push(parsed.params ?? {});
          }
        } catch {
          // ignore
        }
      }
    };
    child.stdout.on("data", onData);
    try {
      await rpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "at4-news-reliability", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const tools = await rpc(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const names = (tools.result?.tools ?? []).map((tool) => tool.name);
      assert.equal(names.includes("adam_list_news"), true);
      assert.equal(
        names.some((name) => /adam_get_news|adam_list_announcement|adam_news_/i.test(name)),
        false,
        "no new news get-by-id / list tool",
      );

      const news = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "adam_list_news",
          arguments: {},
          _meta: { progressToken: "news-at4" },
        },
      });
      assert.equal(news.error, undefined, news.error?.message);
      assert.equal(news.result?.isError, undefined);
      assert.ok(progress.some((p) => p.progressToken === "news-at4"));

      const items = news.result?.structuredContent?.items as Array<{
        title?: string;
        url?: string;
        courseRefId?: string;
        resourceUri?: string;
        provenance?: {
          provider?: string;
          sourceUrl?: string;
          fetchedAt?: string;
          iliasVersion?: string;
          freshness?: string;
        };
      }>;
      assert.ok(Array.isArray(items));
      assert.ok(items.length >= 1);
      assert.ok(items.every((item) => item.courseRefId === "100001"));
      assert.equal(items.some((item) => item.courseRefId === NEWS_OFF_COURSE_ID), false);
      assert.equal(items.some((item) => item.courseRefId === CATALOG_ONLY_COURSE_ID), false);

      const fileNews = items.find((item) => item.url?.includes("/go/file/100011"));
      assert.ok(fileNews, "news-on resource-backed item");
      assert.equal(fileNews?.url, "https://adam.unibas.ch/go/file/100011");
      assert.equal(fileNews?.resourceUri, "adam://file/100011");
      assert.equal(fileNews?.provenance?.provider, "fixture");
      assert.ok(fileNews?.provenance?.sourceUrl);
      assert.ok(fileNews?.provenance?.fetchedAt);
      assert.ok(fileNews?.provenance?.iliasVersion || fileNews?.provenance?.freshness);

      assertAdamAndHttps(news.result?.structuredContent, news.result?.content?.[0]?.text ?? "");
      assert.equal(
        (news.result?.content ?? []).some(
          (block) => block.type === "resource_link" && block.uri === "adam://file/100011",
        ),
        true,
      );

      const recent = await rpc(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "adam_list_news",
          arguments: { since: "2026-09-01T00:00:00.000Z" },
        },
      });
      const recentItems = recent.result?.structuredContent?.items as Array<{ title?: string; url?: string }>;
      assert.ok(recentItems.some((item) => item.url?.includes("/go/file/100011")));
      assert.equal(recentItems.some((item) => /kickoff/i.test(item.title ?? "")), false);

      // Domain lock regressions.
      const emptyFold = await rpc(child, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "adam_list_children", arguments: { refId: "100020" } },
      });
      assert.deepEqual(emptyFold.result?.structuredContent?.items, []);
      const exercise = await rpc(child, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "adam_get_exercise", arguments: { refId: "100021" } },
      });
      assert.equal(exercise.result?.structuredContent?.type, "exc");
      const denied = await rpc(child, {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "adam_read_page", arguments: { refId: GOLDEN_TST_REF_ID, confirm: true } },
      });
      assert.equal(denied.result?.isError, true);
    } finally {
      child.stdout.off("data", onData);
      child.kill();
    }
  });
});

describe("AT5 adam_get_exercise harden", () => {
  it("surfaces labeled synthetic 100021 with A1 cites; keeps 100020 empty; no new tool", async () => {
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
          clientInfo: { name: "at5-get-exercise", version: "0.0.1" },
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );

      const tools = await rpc(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const names = (tools.result?.tools ?? []).map((tool) => tool.name);
      assert.equal(names.includes("adam_get_exercise"), true);
      assert.equal(
        names.some((name) => /adam_get_exercise_by|adam_list_exercise|adam_get_exc\b/i.test(name)),
        false,
        "no new exercise get-by-id / list tool",
      );

      const exercise = await rpc(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "adam_get_exercise", arguments: { refId: "100021" } },
      });
      assert.equal(exercise.error, undefined, exercise.error?.message);
      assert.equal(exercise.result?.isError, undefined);
      const structured = exercise.result?.structuredContent as {
        type?: string;
        refId?: string;
        url?: string;
        resourceUri?: string;
        units?: Array<{ deadline?: string; ownStatus?: string }>;
        provenance?: {
          provider?: string;
          freshness?: string;
          sourceUrl?: string;
          fetchedAt?: string;
        };
      };
      assert.equal(structured?.type, "exc");
      assert.equal(structured?.refId, "100021");
      assert.equal(structured?.url, "https://adam.unibas.ch/go/exc/100021");
      assert.equal(structured?.resourceUri, "adam://exc/100021");
      assert.equal(structured?.units?.[0]?.deadline, "2026-09-22T21:59:00.000Z");
      assert.equal(structured?.provenance?.provider, "fixture");
      assert.equal(structured?.provenance?.freshness, "synthetic");
      assert.ok(structured?.provenance?.sourceUrl);
      assert.ok(structured?.provenance?.fetchedAt);
      assertAdamAndHttps(exercise.result?.structuredContent, exercise.result?.content?.[0]?.text ?? "");
      assert.equal(
        (exercise.result?.content ?? []).some(
          (block) => block.type === "resource_link" && block.uri === "adam://exc/100021",
        ),
        true,
      );

      // Fail-closed: fold is not an exercise.
      const fold = await rpc(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "adam_get_exercise", arguments: { refId: "100020" } },
      });
      assert.equal(fold.result?.isError, true);
      assert.match(fold.result?.content?.[0]?.text ?? "", /unsupported_type|fold/i);

      // Domain lock + B10 regressions.
      const emptyFold = await rpc(child, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "adam_list_children", arguments: { refId: "100020" } },
      });
      assert.deepEqual(emptyFold.result?.structuredContent?.items, []);
      const denied = await rpc(child, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "adam_read_page", arguments: { refId: GOLDEN_TST_REF_ID, confirm: true } },
      });
      assert.equal(denied.result?.isError, true);
    } finally {
      child.kill();
    }
  });
});
