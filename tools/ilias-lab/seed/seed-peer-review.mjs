// Peer review seeding for the local lab (ADR 0053 amendment, #165). Lab-only: drives
// http://localhost:8080 as the lab system admin and the lab students. Never run against ADAM.
//
//   1. admin: "Lab sheet 3 (peer review)" in exercise 106, peer feedback on (one required
//      review, text criterion, names not shown). Feedback deadline set to the future.
//   2. students: one text submission each while the submission deadline is open.
//   3. admin: submission deadline closed, so the review phase opens.
//   4. students: one review each of their assigned peer ("Feedback Recipient 1").
//   5. fixtures (student view, GET only): detail page and "Given Feedback" overview while
//      the review window is open.
//   6. admin: feedback deadline moved to the past so the received view is granted; fixture.
//
// Every step checks current state first (idempotent). Usage (repo root):
//   node tools/ilias-lab/seed/seed-peer-review.mjs 106
import { labPage, saveLabFixture, LAB } from "./lab-page.mjs";
import config from "./lab-users.json" with { type: "json" };

const excRef = Number(process.argv[2]);
if (excRef !== 106) throw new Error("usage: seed-peer-review.mjs 106 (only exercise ref 106 is seeded)");
const TITLE = "Lab sheet 3 (peer review)";
const DAY = 86_400_000;
// datetime-local value in the lab's wall clock (same convention as seed-ui.mjs)
const at = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 16);
// ILIAS constraint: the feedback deadline is never earlier than the assignment deadline.
const SUBMIT_OPEN = at(2);
const SUBMIT_CLOSED = at(-1);
const FEEDBACK_OPEN = at(6);
const FEEDBACK_CLOSED = at(-0.5);
const ROOT = `${LAB}/ilias.php?baseClass=ilexercisehandlergui&cmdNode=cc:mb:bs&cmdClass=ilExAssignmentEditorGUI&ref_id=${excRef}`;
const listUrl = `${LAB}/ilias.php?baseClass=ilexercisehandlergui&cmdClass=ilExAssignmentEditorGUI&cmd=listAssignments&ref_id=${excRef}`;
const errorsOf = (page) => page.locator(".alert-danger, .c-alert--error, .help-block.alert, .il-input-error").allTextContents();
const students = config.users.filter((u) => u.role === "student");
const studentIndex = (login) => students.findIndex((u) => u.login === login);
// Synthetic lab text; deliberately no login or name, so the parser tests can assert anonymity.
const REVIEW_TEXT = "Lab review: the file is complete and easy to follow.";

async function withRole(role, which, task) {
  const session = await labPage(role, which);
  try {
    return await task(session.page);
  } finally {
    await session.browser.close();
  }
}

/**
 * Student: the assignment's own detail page, reached from the exercise overview like a student
 * would. Once the review window has closed the assignment is listed under the "Past" bucket.
 */
async function openStudentDetail(page) {
  await page.goto(`${LAB}/goto.php?target=exc_${excRef}`);
  const item = () => page.locator("main .il-item", { hasText: TITLE }).first();
  if ((await item().count()) === 0) {
    const past = await page.locator("button[data-action*='mode=past']").first().getAttribute("data-action");
    await page.goto(new URL(past.replace(/&amp;/g, "&"), LAB).href);
  }
  await item().locator("h4 a").first().click();
  await page.waitForLoadState("domcontentloaded");
}

// --- 1. assignment and peer-feedback settings -----------------------------------------
/** ILIAS locks the criteria once peers are assigned; only the feedback deadline stays editable then. */
async function setFeedbackDeadline(page, assId, when) {
  await page.goto(`${ROOT}&ass_id=${assId}&cmd=editPeerReview`);
  if (await page.locator("input[name=peer_min]:not([type=hidden])").isEnabled()) {
    await page.fill("input[name=peer_min]", "1");
    await page.uncheck("input[name=peer_rating]");
    await page.check("input[name=peer_text]");
    await page.uncheck("input[name=peer_prsl]");
  }
  await page.fill("input[name=peer_dl]", when);
  await page.locator("input[name='cmd[updatePeerReview]']").first().click();
  await page.waitForLoadState("domcontentloaded");
  const errors = await errorsOf(page);
  console.log(errors.length ? `FAILED feedback deadline: ${errors.join(" | ").replace(/\s+/g, " ").slice(0, 200)}` : `feedback deadline set: ${when}`);
}

const assId = await withRole("system", 0, async (page) => {
  await page.goto(listUrl);
  if ((await page.content()).includes(TITLE)) {
    console.log(`exists: ${TITLE}`);
  } else {
    await page.selectOption("select[name=type]", "1");
    await page.locator("input[name='cmd[addAssignment]'], button[name='cmd[addAssignment]']").first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.fill("input[name=title]", TITLE);
    await page.fill("textarea[name=instruction]", "Peer review lab sheet. Upload one short text file, then review your peer's file.");
    await page.check("input[name=deadline_mode][value='0']");
    await page.fill("input[name=deadline]", SUBMIT_OPEN);
    await page.check("input[name=peer]");
    await page.locator("input[name='cmd[saveAssignment]']").first().click();
    await page.waitForLoadState("domcontentloaded");
    const errors = await errorsOf(page);
    console.log(errors.length ? `FAILED: ${TITLE}: ${errors.join(" | ").replace(/\s+/g, " ").slice(0, 200)}` : `created: ${TITLE}`);
  }
  await page.goto(listUrl);
  const href = await page.locator("table tbody tr", { hasText: TITLE }).first().locator("a", { hasText: "Edit" }).first().getAttribute("href");
  const id = new URL(href, LAB).searchParams.get("ass_id");
  if (!id) throw new Error(`no ass_id for ${TITLE}`);
  await setFeedbackDeadline(page, id, FEEDBACK_OPEN);
  return id;
});

// --- 2. students submit one text file while submissions are open ---------------------
async function setSubmissionDeadline(open) {
  await withRole("system", 0, async (page) => {
    await page.goto(`${ROOT}&ass_id=${assId}&cmd=editAssignment`);
    const field = page.locator("input[name=deadline]:not([type=hidden])");
    const current = await field.inputValue();
    const isOpen = Boolean(current) && new Date(`${current}:00Z`).getTime() > Date.now();
    if (isOpen === open) {
      console.log(`submission deadline already ${open ? "open" : "closed"}`);
      return;
    }
    // ILIAS locks the deadline once peers are assigned; the state then stays as seeded.
    if (!(await field.isEnabled())) {
      console.log(`submission deadline locked by ILIAS (peers assigned); left ${isOpen ? "open" : "closed"}`);
      return;
    }
    await page.fill("input[name=deadline]", open ? SUBMIT_OPEN : SUBMIT_CLOSED);
    await page.locator("input[name='cmd[updateAssignment]']").first().click();
    await page.waitForLoadState("domcontentloaded");
    const errors = await errorsOf(page);
    console.log(errors.length ? `FAILED submission deadline: ${errors.join(" | ").replace(/\s+/g, " ").slice(0, 200)}` : `submission deadline ${open ? "opened" : "closed"}`);
  });
}

await setSubmissionDeadline(true);
for (const user of students) {
  await withRole("student", studentIndex(user.login), async (page) => {
    const fileName = `${user.login}-peer-submission.txt`;
    await openStudentDetail(page);
    await page.locator("#ilTab a, main a", { hasText: "Submitted Files" }).first().click().catch(() => {});
    await page.waitForLoadState("domcontentloaded");
    if ((await page.content()).includes(fileName)) {
      console.log(`exists: submission by ${user.login}`);
      return;
    }
    await page.locator("main button", { hasText: "Upload File" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.locator("input[type=file]").first().setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from(`Lab peer submission by ${user.login}.`) });
    await page.waitForTimeout(2500);
    await page.locator("main button", { hasText: "Save" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    console.log(`${(await page.content()).includes(fileName) ? "submitted" : "submission FAILED"}: ${user.login}`);
  });
}

// --- 3. close submissions so the review phase opens ---------------------------------
await setSubmissionDeadline(false);

// --- 4. each student writes one review of the assigned peer --------------------------
for (const user of students) {
  await withRole("student", studentIndex(user.login), async (page) => {
    await openStudentDetail(page);
    await page.locator("#ilTab a", { hasText: "Given Feedback" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    const editHref = await page.locator("main a, main button").evaluateAll((els) => els.map((el) => el.getAttribute("href") || el.getAttribute("data-action") || "").find((h) => h.includes("editPeerReviewItem")));
    if (!editHref) {
      console.log(`no assigned peer for ${user.login}`);
      return;
    }
    await page.goto(new URL(editHref, LAB).href);
    const textarea = page.locator("main textarea[name^='prccc_text_']").first();
    if ((await textarea.inputValue()).trim() === REVIEW_TEXT) {
      console.log(`exists: review by ${user.login}`);
      return;
    }
    await textarea.fill(REVIEW_TEXT);
    await page.locator("main input[name='cmd[updatePeerReview]'], main button[name='cmd[updatePeerReview]']").first().click();
    await page.waitForLoadState("domcontentloaded");
    const errors = await errorsOf(page);
    console.log(errors.length ? `FAILED review by ${user.login}: ${errors.join(" | ").replace(/\s+/g, " ").slice(0, 200)}` : `review saved: ${user.login}`);
  });
}

// --- 5. fixtures while the review window is open (GET views only) -------------------
await withRole("student", studentIndex("lab.student"), async (page) => {
  await openStudentDetail(page);
  console.log(`fixture exercise-peer-review-student: ${(await saveLabFixture("exercise-peer-review-student", page)).chars} chars`);
  await page.locator("#ilTab a", { hasText: "Given Feedback" }).first().click();
  await page.waitForLoadState("domcontentloaded");
  console.log(`fixture exercise-peer-review-given-student: ${(await saveLabFixture("exercise-peer-review-given-student", page)).chars} chars`);
});

// --- 6. feedback window closes, received view granted; fixture ----------------------
await withRole("system", 0, (page) => setFeedbackDeadline(page, assId, FEEDBACK_CLOSED));
// After the window closes the "Given Feedback" tab lists the reviews this student wrote, and
// "Received Feedbacks" is a separate tab. The fixture is the received tab.
await withRole("student", studentIndex("lab.student"), async (page) => {
  await openStudentDetail(page);
  await page.locator("#ilTab a", { hasText: "Given Feedback" }).first().click();
  await page.waitForLoadState("domcontentloaded");
  await page.locator("#ilTab a", { hasText: "Received Feedbacks" }).first().click();
  await page.waitForLoadState("domcontentloaded");
  console.log(`fixture exercise-peer-review-received-student: ${(await saveLabFixture("exercise-peer-review-received-student", page)).chars} chars`);
});
console.log(`assignment ass_id=${assId}`);
