import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createFixtureProvider } from "adam-provider-fixture";
import { runStdio } from "./index.ts";

test("stdio EOF closes the MCP connection and configured provider exactly once", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdout.resume();
  let closes = 0;
  const provider = createFixtureProvider() as ReturnType<typeof createFixtureProvider> & { close(): Promise<void> };
  provider.close = async () => { closes++; };
  const serving = runStdio({ provider }, { stdin, stdout });

  stdin.end();
  await serving;
  assert.equal(closes, 1);
  assert.equal(process.listenerCount("SIGINT"), 0);
  assert.equal(process.listenerCount("SIGTERM"), 0);
});
