import assert from "node:assert/strict";
import { it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "../../provider-browser/src/browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "../../provider-browser/src/memory-session.ts";
import { createFixtureProvider } from "./fixture-provider.ts";

const origin = "https://adam.unibas.ch";
const courseUrl = `${origin}/go/crs/100001`;
const folderUrl = `${origin}/go/fold/100020`;
const html = (title: string) => `<main><h1>${title}</h1><p>This folder is empty</p><a href="/logout.php">Abmelden</a></main>`;
const browser = () => createBrowserProvider({ session: createMemorySession({
  [courseUrl]: snapshotFromHtml(courseUrl, "Course", html("Course"), "Course Abmelden"),
  [`${origin}/go/fold/100001`]: snapshotFromHtml(courseUrl, "Course", html("Course"), "Course Abmelden"),
  [folderUrl]: snapshotFromHtml(folderUrl, "Exercises", html("Exercises"), "Exercises This folder is empty Abmelden"),
  [`${origin}/go/exc/100020`]: snapshotFromHtml(folderUrl, "Exercises", html("Exercises"), "Exercises This folder is empty Abmelden"),
}) });
const unsupported = (error: unknown) => error instanceof AdamError && error.code === "unsupported_type";

it("both providers deny tst hints before returning page, listing or typed getter data", async () => {
  for (const provider of [createFixtureProvider(), browser()]) {
    for (const read of [
      () => provider.readPage("100001", { type: "tst" }),
      () => provider.listChildren("100001", { type: "tst" }),
      () => provider.listFiles("100001", { type: "tst" }),
      () => provider.getCourse("100001", { type: "tst" }),
      () => provider.getFile("100001", { type: "tst" }),
      () => provider.getExercise("100001", { type: "tst" }),
      () => provider.getForum("100001", { type: "tst" }),
    ]) await assert.rejects(read, unsupported);
    assert.equal((await provider.readPage("100001", { type: "unknown" })).type, "crs");
    assert.equal((await provider.readPage("100001", { type: "fold" })).type, "crs");
    await assert.rejects(() => provider.getExercise("100020", { type: "exc" }), unsupported);
  }
});

it("fixture resolves allowed hints while typed getters and golden identities stay distinct", async () => {
  const provider = createFixtureProvider();
  assert.equal((await provider.readPage("100001", { type: "fold" })).type, "crs");
  assert.equal((await provider.listChildren("100020", { type: "exc" })).listingState, "empty");
  await assert.rejects(() => provider.getExercise("100020", { type: "exc" }), unsupported);
  await assert.rejects(() => provider.getForum("100040", { type: "unknown" }), unsupported);
  assert.equal((await provider.listChildren("100020", { type: "unknown" })).listingState, "empty");
  assert.equal((await provider.getExercise("100021", { type: "unknown" })).units[0]?.deadline, "2026-09-22T21:59:00.000Z");
  await assert.rejects(() => provider.readPage("100030", { type: "unknown" }), unsupported);
});
