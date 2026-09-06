import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const require = createRequire(import.meta.url);

class DocsSnapshot {
  static read(relPath: string): string {
    return readFileSync(resolve(repoRoot, relPath), "utf8");
  }

  static mustInclude(relPath: string, needles: string[]): void {
    const text = DocsSnapshot.read(relPath);
    for (const needle of needles) {
      assert.equal(
        text.includes(needle),
        true,
        `${relPath} must include: ${JSON.stringify(needle)}`,
      );
    }
  }

  static mustNotImplyOsPermissionOrEquateElicitation(relPath: string): void {
    const text = DocsSnapshot.read(relPath).toLowerCase();
    // FAIL shapes: OS permission dialog, or equating confirm/annotations to elicitation.
    assert.equal(
      /confirm[^\n]{0,120}os permission/.test(text) &&
        !/not[^\n]{0,40}os permission/.test(text),
      false,
      `${relPath} must not imply confirm is an OS permission`,
    );
    assert.equal(
      /confirm[^\n]{0,80}(is|=)[^\n]{0,40}elicitation/.test(text) &&
        !/not[^\n]{0,40}elicitation/.test(text),
      false,
      `${relPath} must not equate confirm to elicitation`,
    );
  }
}

describe("A3 docs: confirm vs elicitation", () => {
  it("architecture/AGENTS/scope state interim schema gate after student asked to read", () => {
    DocsSnapshot.mustInclude("docs/architecture.md", [
      "interim schema gate",
      "after the student asked to read",
      "OS permission dialog",
      "equated to tool annotations alone",
      "MCP **elicitation** when the host supports MRTR",
    ]);
    DocsSnapshot.mustInclude("AGENTS.md", [
      "interim schema gate after the student asked to read",
      "not OS permission",
      "not elicitation",
      "not equated to tool annotations alone",
      "MCP elicitation when host supports MRTR",
    ]);
    DocsSnapshot.mustInclude("docs/scope.md", [
      "interim schema gate",
      "after the student asked to read",
      "not** an OS permission dialog",
      "not** MCP elicitation",
      "not** equated to tool annotations alone",
      "MCP **elicitation** when the host supports MRTR",
    ]);
    DocsSnapshot.mustNotImplyOsPermissionOrEquateElicitation("docs/architecture.md");
    DocsSnapshot.mustNotImplyOsPermissionOrEquateElicitation("AGENTS.md");
    DocsSnapshot.mustNotImplyOsPermissionOrEquateElicitation("docs/scope.md");
  });
});

describe("A4 pin SDK/protocol", () => {
  it("architecture.md pins @modelcontextprotocol/server 2.x + protocol era; package dep matches", () => {
    DocsSnapshot.mustInclude("docs/architecture.md", [
      "@modelcontextprotocol/server",
      "2.x",
      "^2.0.0",
      "2025-03-26",
      "2026-07-28",
    ]);
    const pkg = JSON.parse(DocsSnapshot.read("packages/mcp/package.json")) as {
      dependencies?: Record<string, string>;
    };
    assert.equal(pkg.dependencies?.["@modelcontextprotocol/server"], "^2.0.0");
    const installed = require(
      resolve(repoRoot, "node_modules/@modelcontextprotocol/server/package.json"),
    ) as { version: string };
    assert.match(installed.version, /^2\./);
  });
});
