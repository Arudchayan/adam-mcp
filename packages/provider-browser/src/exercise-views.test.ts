import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdamError } from "adam-core";
import { createBrowserProvider } from "./browser-provider.ts";
import { exerciseViewUrl } from "./exercise-views.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

const route = (mode: string, extra = "", ref = "100021") =>
  `ilias.php?baseClass=ilexercisehandlergui&amp;cmdNode=cs:n1&amp;cmdClass=ilObjExerciseGUI&amp;cmd=showOverview&amp;ref_id=${ref}&amp;mode=${mode}&amp;from_overview=1${extra}`;
const modes = (actions: string[]) => `<div class="il-viewcontrol-mode">${actions.map((action, at) => `<button id="b${at}" data-action="${action}">x</button>`).join("")}</div>`;

describe("ADR 0052: exercise assignment views", () => {
  it("accepts only the advertised same-exercise showOverview route for the requested mode", () => {
    const html = modes([route("ongoing"), route("future"), route("past"), route("all")]);
    assert.match(exerciseViewUrl(html, "100021", "all") ?? "", /mode=all/);
    assert.match(exerciseViewUrl(html, "100021", "upcoming") ?? "", /mode=future/);
    assert.equal(exerciseViewUrl(modes([route("past")]), "100021", "all"), undefined, "not advertised");
  });

  it("rejects other exercises, commands, origins, extra or duplicate keys", () => {
    for (const action of [
      route("all", "", "100099"),
      route("all").replace("cmd=showOverview", "cmd=submit"),
      route("all").replace("ilObjExerciseGUI", "ilExSubmissionGUI"),
      "https://evil.example/" + route("all"),
      route("all", "&amp;ass_id=5"),
      route("all", "&amp;mode=past"),
      route("all").replace("cmdNode=cs:n1", "cmdNode=cs%22onload"),
    ]) assert.equal(exerciseViewUrl(modes([action]), "100021", "all"), undefined, action);
  });

  it("reads the requested view through the provider and echoes it", async () => {
    const origin = "https://adam.unibas.ch";
    const assignment = (title: string) => `<div class="il-item"><h4 class="il-item-title"><a href="/go/exc/100021/1">${title}</a></h4><div class="il-item-properties"><span class="il-item-property-name">Ended On</span><span class="il-item-property-value">1. Oct 2026, 12:00</span><span class="il-item-property-name">Status</span><span class="il-item-property-value">Passed</span></div></div>`;
    const allUrl = `${origin}/${route("all").replace(/&amp;/g, "&")}`;
    const session = createMemorySession({
      [`${origin}/go/exc/100021`]: snapshotFromHtml(`${origin}/go/exc/100021`, "Exercises", `<main><h1>Exercises</h1>${modes([route("ongoing"), route("all")])}<p>No assignments available.</p></main>`, "Exercises No assignments available."),
      [allUrl]: snapshotFromHtml(allUrl, "Exercises", `<main><h1>Exercises</h1>${assignment("Sheet 1")}</main>`, "Exercises Sheet 1"),
    });
    const provider = createBrowserProvider({ session, origin });
    const all = await provider.getExercise("100021", { type: "exc", view: "all" });
    assert.equal(all.view, "all");
    assert.deepEqual(all.units.map((unit) => [unit.title, unit.ownStatus, unit.deadline]), [["Sheet 1", "passed", "2026-10-01T10:00:00.000Z"]], "past cards use Ended On");
    assert.deepEqual((await provider.getExercise("100021", { type: "exc" })).units, [], "default view unchanged");
    await assert.rejects(() => provider.getExercise("100021", { type: "exc", view: "past" }), (error: unknown) =>
      error instanceof AdamError && error.code === "unsupported_type" && /does not offer the "past"/.test(error.message));
  });
});
