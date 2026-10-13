import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "node:test";
import { isMainModule } from "./main-entry.ts";

it("recognizes a CLI entry through a directory symlink without treating another module as main", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "adam-main-entry-"));
  try {
    const actual = join(temporary, "actual"), alias = join(temporary, "alias");
    await mkdir(actual);
    const main = join(actual, "cli.mjs"), other = join(actual, "other.mjs");
    await writeFile(main, "// synthetic CLI");
    await writeFile(other, "// synthetic library");
    await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
    assert.equal(isMainModule(pathToFileURL(main).href, join(alias, "cli.mjs")), true);
    assert.equal(isMainModule(pathToFileURL(other).href, join(alias, "cli.mjs")), false);
    assert.equal(isMainModule(pathToFileURL(main).href, join(alias, "missing.mjs")), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
