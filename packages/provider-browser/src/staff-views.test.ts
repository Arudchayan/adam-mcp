import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { advertisedStaffRoute, parseCourseMembers, parseExerciseGrades, staffViewUnavailable } from "./staff-views.ts";

/**
 * ADR 0060 (#128): captures from the local ILIAS 10.12 lab (tools/ilias-lab), seeded
 * with lab-only users. The lab serves http://localhost:8080; the routes are rebased
 * onto ADAM's pinned origin so the allowlist sees what it would see on ADAM.
 */
const lab = (name: string) => {
  const fixture = JSON.parse(readFileSync(new URL(`../fixtures/lab/${name}.json`, import.meta.url), "utf8")) as { html: string };
  return fixture.html.replaceAll("http://localhost:8080", "https://adam.unibas.ch");
};
const COURSE = "86";
const EXERCISE = "106";

describe("ADR 0060: staff views from the ILIAS 10.12 lab", () => {
  it("parses the course Members table with roles and flags", () => {
    const members = parseCourseMembers(lab("course-members-tutor"));
    assert.ok(members);
    assert.equal(members.length, 5);
    for (const member of members) {
      assert.ok(member.name.length > 0);
      assert.ok(Array.isArray(member.roles));
      assert.equal(typeof member.passed, "boolean");
    }
    // Only admin rows offer the Notification checkbox.
    assert.equal(members.find((member) => member.login === "lab.admin")?.notification, true);
    assert.equal(members.find((member) => member.login === "lab.student")?.notification, undefined);
    // ILIAS 10.12 leaves the Roles cell empty on admin rows; tutors and members carry theirs.
    assert.deepEqual(members.find((member) => member.login === "lab.tutor")?.roles, ["Course Tutor"]);
    assert.deepEqual(members.find((member) => member.login === "lab.student")?.roles, ["Course Member"]);
  });

  it("redacts email-shaped logins and names", () => {
    const html = lab("course-members-tutor").replace(">\n lab.student2 <", ">someone@unibas.ch<").replace(/>\s*lab\.student2\s*</, ">someone@unibas.ch<");
    const members = parseCourseMembers(html);
    assert.ok(members);
    assert.equal(members.some((member) => JSON.stringify(member).includes("someone@unibas.ch")), false);
  });

  it("parses the Grades View matrix: one status per assignment and a total", () => {
    const rows = parseExerciseGrades(lab("exercise-grades-view-tutor"));
    assert.ok(rows);
    const student = rows.find((row) => row.login === "lab.student");
    const student2 = rows.find((row) => row.login === "lab.student2");
    assert.ok(student && student2);
    assert.ok(student.grades.length >= 2);
    for (const grade of student.grades) assert.match(grade.assignmentId ?? "", /^\d+$/);
    const sheet2 = (row: typeof student) => row.grades.find((grade) => grade.assignment === 2)?.status;
    assert.equal(sheet2(student), "passed");
    assert.equal(sheet2(student2), "failed");
    assert.ok(rows.every((row) => row.total !== undefined));
  });

  it("returns undefined for pages that are not those views", () => {
    assert.equal(parseCourseMembers(lab("course-student")), undefined);
    assert.equal(parseExerciseGrades(lab("exercise-tutor")), undefined);
    assert.equal(parseExerciseGrades("<table id=\"exc_grades_1\"><tr><th>Name</th></tr></table>"), undefined);
  });

  it("follows only the staff tabs ADAM advertises to a tutor, never to a student", () => {
    const members = advertisedStaffRoute(lab("course-tutor"), COURSE, /^ilCourseMembershipGUI$/i);
    assert.ok(members);
    assert.equal(new URL(members).origin, "https://adam.unibas.ch");
    assert.equal(advertisedStaffRoute(lab("course-student"), COURSE, /^ilCourseMembershipGUI$/i), undefined);

    const tab = advertisedStaffRoute(lab("exercise-tutor"), EXERCISE, /^ilexercisemanagementgui$/i, /^members$/i);
    assert.ok(tab);
    assert.equal(advertisedStaffRoute(lab("exercise-student"), EXERCISE, /^ilexercisemanagementgui$/i, /^members$/i), undefined);
    const grades = advertisedStaffRoute(lab("exercise-assignment-view-tutor"), EXERCISE, /^ilexercisemanagementgui$/i, /^showGradesOverview$/i);
    assert.ok(grades);
    assert.equal(new URL(grades).searchParams.get("cmd"), "showGradesOverview");
  });

  it("rejects routes off-origin, for another ref_id, with extra keys or with write commands", () => {
    const link = (href: string) => `<a href="${href}">x</a>`;
    const ok = "/ilias.php?baseClass=ilrepositorygui&cmdClass=ilCourseMembershipGUI&ref_id=86";
    assert.ok(advertisedStaffRoute(link(ok), COURSE, /^ilCourseMembershipGUI$/i));
    assert.equal(advertisedStaffRoute(link(`https://evil.example${ok}`), COURSE, /^ilCourseMembershipGUI$/i), undefined);
    assert.equal(advertisedStaffRoute(link(ok.replace("ref_id=86", "ref_id=87")), COURSE, /^ilCourseMembershipGUI$/i), undefined);
    assert.equal(advertisedStaffRoute(link(`${ok}&rtoken=abc`), COURSE, /^ilCourseMembershipGUI$/i), undefined);
    assert.equal(advertisedStaffRoute(link(`${ok}&cmd=deleteParticipants`), COURSE, /^ilCourseMembershipGUI$/i), undefined);
    assert.equal(advertisedStaffRoute(link(`${ok}&ref_id=86`), COURSE, /^ilCourseMembershipGUI$/i), undefined);
    assert.equal(advertisedStaffRoute(link(`${ok}&ass_id=1x`), COURSE, /^ilCourseMembershipGUI$/i), undefined);
  });

  it("explains a missing staff view as forbidden, not a missing object", () => {
    const error = staffViewUnavailable("86", "Members");
    assert.equal(error.code, "forbidden");
    assert.match(error.message, /tutor or course-admin only/);
  });
});
