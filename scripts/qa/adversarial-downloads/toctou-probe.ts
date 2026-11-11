import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { downloadDirectory, saveLocalDownload } from "../../../packages/provider-browser/src/local-download.ts";
import { file, session, temporary } from "./support.ts";

// These require an actor that can already mutate the destination. They are observations,
// not claims of an upstream-controlled filesystem boundary escape.
await temporary(async (directory) => {
  const result = await saveLocalDownload(session(async () => {
    await writeFile(join(directory, ".git"), "gitdir: synthetic");
    return new Response("synthetic bytes");
  }), file, directory);
  assert.equal(await readFile(result.path, "utf8"), "synthetic bytes");
  await assert.rejects(downloadDirectory(directory), /outside a Git checkout/);
  console.log(JSON.stringify({ observation: "Git initialized during transfer is not rechecked", saved: true, threat: "local destination writer required" }));
});

await temporary(async (directory) => {
  const destination = join(directory, "destination"), moved = join(directory, "moved"), replacement = join(directory, "replacement");
  await mkdir(destination); await mkdir(replacement);
  let renameSucceeded = false;
  await assert.rejects(saveLocalDownload(session(async () => {
    await rename(destination, moved);
    renameSucceeded = true;
    await symlink(replacement, destination, "junction");
    return new Response("synthetic bytes");
  }), file, destination), (error: NodeJS.ErrnoException) => ["ENOENT", "EPERM"].includes(error.code ?? ""));
  assert.deepEqual(await readdir(replacement), []);
  if (!renameSucceeded) {
    assert.deepEqual(await readdir(destination), []);
    console.log(JSON.stringify({ observation: "directory replacement blocked while temp handle is open", saved: false, strandedPartCount: 0, platform: process.platform }));
    return;
  }
  const stranded = await readdir(moved);
  assert.equal(stranded.length, 1); assert.match(stranded[0], /^\.adam-download-.*\.part$/);
  console.log(JSON.stringify({ observation: "destination replaced during transfer", saved: false, strandedPartCount: stranded.length, replacementEntries: 0, threat: "local destination writer required" }));
});
