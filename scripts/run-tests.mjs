#!/usr/bin/env node
/**
 * Discover `.test.ts` files and pass them to Node's test runner.
 *
 * Quoted npm-script globs stay literal on Node 20 (the glob is treated as a
 * filename). `tsx --test src` treats the directory as one file, so suites
 * never run. Recursing here keeps Windows, macOS, Linux, Node 20, and Node 22
 * aligned.
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const searchRoot = resolve(root, process.argv[2] ?? "src");

async function collectTestFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return found;
    }
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectTestFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      found.push(path);
    }
  }
  return found;
}

const files = (await collectTestFiles(searchRoot)).sort();
if (files.length === 0) {
  console.error(`No *.test.ts files under ${searchRoot}`);
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
