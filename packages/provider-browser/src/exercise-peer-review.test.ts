import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createBrowserProvider } from "./browser-provider.ts";
import { exercisePeerReviewUrl, parseGivenFeedback, parsePeerReviewPanel, parseReceivedFeedback, peerReviewRoutes, PEER_REVIEW_TEXT_CAP } from "./exercise-peer-review.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";

/**
 * #165: captures from the local ILIAS 10.12 lab (tools/ilias-lab, seed-peer-review.mjs), lab-only
 * users. The lab serves http://localhost:8080; pages are rebased onto ADAM's pinned origin so the
 * allowlist sees what it would see on ADAM.
 */
const origin = "https://adam.unibas.ch";
const REF = "106";
const ASS = "6";
const LAB_NAMES = ["lab.student", "lab.student2", "lab.tutor", "lab.admin", "Lab Student", "Lab Student Two", "Lab Tutor", "Lab Course Admin"];
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { url: string; html: string };
const rebased = (name: string) => {
  const { url, html } = fixture(name);
  return { url: url.replaceAll("http://localhost:8080", origin), html: html.replaceAll("http://localhost:8080", origin) };
};
const absolute = (route: string) => new URL(route.replace(/&amp;/g, "&"), origin).href;

describe("#165: lab-verified exercise peer review", () => {
  const now = new Date("2026-11-17T10:00:00Z");

  it("reads the Peer-Feedback panel: deadline and the advertised ilExPeerReviewGUI routes", () => {
    const { html } = rebased("exercise-peer-review-student");
    const panel = parsePeerReviewPanel(html, now);
    assert.ok(panel);
    assert.match(panel.deadlineText ?? "", /^\d{1,2}\. \w{3} 2026, \d{2}:\d{2}$/);
    assert.ok(panel.deadline);
    const routes = peerReviewRoutes(html);
    const given = routes.map((href) => exercisePeerReviewUrl(href, REF, ASS, "editpeerreview")).find(Boolean);
    assert.ok(given, "the Give Feedback route is allowed");
    assert.match(given, /cmd=editPeerReview/i);
  });

  it("reads one anonymous given item per peer, with completion from ADAM's Valid column", () => {
    const { html } = rebased("exercise-peer-review-given-student");
    const given = parseGivenFeedback(html);
    assert.ok(given);
    assert.equal(given.given.length, 1);
    assert.deepEqual(given.given[0], { reviewee: "Peer 1", completed: true });
  });

  it("reads received reviews as capped text, skipping the submission panel and its download link", () => {
    const { html } = rebased("exercise-peer-review-received-student");
    const received = parseReceivedFeedback(html);
    assert.ok(received);
    assert.deepEqual(received.map((item) => item.reviewer), ["Peer 1"]);
    assert.match(received[0]?.text ?? "", /^Lab review: the file is complete and easy to follow\.$/);
    assert.doesNotMatch(JSON.stringify(received), /download|Your Submission/i);
  });

  it("caps long peer text and redacts e-mail addresses in it", () => {
    const long = `Contact reviewer@example.org ${"x".repeat(PEER_REVIEW_TEXT_CAP * 2)}`;
    const html = `<div class="panel panel-sub"><div class="panel-heading"><h3>Feedback Giver: 1</h3></div><div class="panel-body"><div class="row"><div class="control-label"><p>&nbsp;</p></div><div class="col"><p>${long}</p></div></div></div></div>`;
    const [item] = parseReceivedFeedback(html) ?? [];
    assert.ok(item);
    assert.match(item.text, /\[redacted-email\]/);
    assert.doesNotMatch(item.text, /reviewer@example\.org/);
    assert.ok(item.text.length <= PEER_REVIEW_TEXT_CAP + 1);
  });

  it("keeps peer identities anonymous: no lab user names or logins in any parsed output", () => {
    const detail = parsePeerReviewPanel(rebased("exercise-peer-review-student").html, now);
    const given = parseGivenFeedback(rebased("exercise-peer-review-given-student").html);
    const received = parseReceivedFeedback(rebased("exercise-peer-review-received-student").html);
    const output = JSON.stringify({ detail, given, received });
    for (const name of LAB_NAMES) assert.equal(output.includes(name), false, name);
    assert.match(output, /Peer 1/);
  });

  it("is absent when the page carries no peer-review panel or list", () => {
    const overview = rebased("exercise-student").html;
    assert.equal(parsePeerReviewPanel(overview, now), undefined);
    assert.equal(parseGivenFeedback(overview), undefined);
    assert.equal(parseReceivedFeedback(overview), undefined);
    // The given overview has no Received Feedbacks panel; the received view has no given list.
    assert.equal(parseReceivedFeedback(rebased("exercise-peer-review-given-student").html), undefined);
    assert.equal(parseGivenFeedback(rebased("exercise-peer-review-received-student").html), undefined);
    assert.equal(parsePeerReviewPanel("<main><p>Nothing here</p></main>", now), undefined);
  });

  it("follows only the ilExPeerReviewGUI overview and received views of this exercise and assignment", () => {
    const base = `/ilias.php?baseClass=ilexercisehandlergui&cmdNode=cc:mb:4q:c2:bz&cmdClass=ilExPeerReviewGUI&ref_id=${REF}&ass_id=${ASS}`;
    assert.match(exercisePeerReviewUrl(`${base}&cmd=editPeerReview`, REF, ASS, "editpeerreview") ?? "", /editPeerReview/);
    assert.match(exercisePeerReviewUrl(`${base}&amp;cmd=showReceivedPeerReview&amp;mode=past`, REF, ASS, "showreceivedpeerreview") ?? "", /mode=past/);
    for (const [href, view] of [
      [`${base}&cmd=editPeerReviewItem&peer_id=316`, "editpeerreview"],
      [`${base}&cmd=updatePeerReview`, "editpeerreview"],
      [`${base}&cmd=showReceivedPeerReview`, "editpeerreview"],
      [`${base}&cmd=editPeerReview&peer_id=316`, "editpeerreview"],
      [`${base}&cmd=editPeerReview&rtoken=abc`, "editpeerreview"],
      [`${base}&cmd=editPeerReview&mode=evil`, "editpeerreview"],
      [`${base}&cmd=editPeerReview&ass_id=7`, "editpeerreview"],
      [`${base}&cmd=editPeerReview&ref_id=100021`, "editpeerreview"],
      [`${base}&cmd=editPeerReview&cmd=editPeerReview`, "editpeerreview"],
      [`/ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilExSubmissionFileGUI&cmd=submissionScreen&ref_id=${REF}&ass_id=${ASS}`, "editpeerreview"],
      [`https://evil.example${base}&cmd=editPeerReview`, "editpeerreview"],
      [undefined, "editpeerreview"],
    ] as const) {
      assert.equal(exercisePeerReviewUrl(href, REF, ASS, view), undefined, String(href));
    }
  });

  it("returns the peer-review panel through getExercise({ detail: true }) and nothing extra by default", async () => {
    const overviewUrl = `${origin}/go/exc/${REF}`;
    const detail = rebased("exercise-peer-review-student");
    const received = rebased("exercise-peer-review-received-student");
    // The open-phase overview has no Received Feedbacks tab; the tab appears once the window closes.
    const givenBase = rebased("exercise-peer-review-given-student");
    const given = { html: `${givenBase.html}<a href="${received.url.replace(origin, "")}">Received Feedbacks</a>` };
    const overviewHtml = `<main><h1>Exercises</h1><div class="il-item"><h4 class="il-item-title"><a href="${detail.url.replace(origin, "")}">Lab sheet 3 (peer review)</a></h4><div class="il-item-properties"><span class="il-item-property-name">Edit Until</span><span class="il-item-property-value">23. Nov 2026, 13:58</span><span class="il-item-property-name">Status</span><span class="il-item-property-value">Not Attempted</span></div></div></main>`;
    const opened: string[] = [];
    const session = createMemorySession({
      [overviewUrl]: snapshotFromHtml(overviewUrl, "Exercises", overviewHtml, "Exercises Lab sheet 3 (peer review)"),
      [absolute(detail.url.replace(origin, ""))]: snapshotFromHtml(absolute(detail.url.replace(origin, "")), "Lab sheet 3", detail.html, "Lab sheet 3"),
      [absolute(peerRoute(detail.html, "editPeerReview"))]: snapshotFromHtml(absolute(peerRoute(detail.html, "editPeerReview")), "Give Feedback", given.html, "Give Feedback"),
      [received.url]: snapshotFromHtml(received.url, "Received", received.html, "Received"),
    }, { onOpen: (url) => opened.push(url) });
    const provider = createBrowserProvider({ session, origin });

    const withDetail = await provider.getExercise(REF, { type: "exc", detail: true });
    const [unit] = withDetail.units;
    assert.equal(unit?.title, "Lab sheet 3 (peer review)");
    assert.equal(unit?.detailStatus, "read");
    assert.equal(unit?.peerReview?.evidence, "lab-verified");
    assert.ok(unit?.peerReview?.deadline);
    assert.deepEqual(unit?.peerReview?.given, [{ reviewee: "Peer 1", completed: true }]);
    assert.equal(unit?.peerReview?.received?.[0]?.reviewer, "Peer 1");
    assert.match(unit?.peerReview?.received?.[0]?.text ?? "", /^Lab review/);
    // Anonymity covers peers. The unit's own submission row (existing ADR 0053 output) names this user's file.
    for (const name of LAB_NAMES) assert.equal(JSON.stringify(unit?.peerReview).includes(name), false, `peerReview has no ${name}`);
    assert.equal(opened.some((url) => /ilExSubmissionFileGUI|editPeerReviewItem|updatePeerReview/i.test(url)), false, "no submit, edit or update route opened");

    const plain = await provider.getExercise(REF, { type: "exc" });
    assert.equal(plain.units.some((item) => item.peerReview), false, "default read unchanged");
  });
});

/** The peer-review route advertised by a lab page, by its ILIAS command. */
function peerRoute(html: string, cmd: string): string {
  const route = peerReviewRoutes(html).find((href) => new RegExp(`cmd=${cmd}\\b`, "i").test(href));
  assert.ok(route, `route ${cmd} advertised`);
  return route;
}
