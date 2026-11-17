// Seeds the lab objects behind the sess / book / lso object readers (ADR 0062, #165):
//   a dated session "Lab sess dated" in Lab Course (ref looked up by title; created when absent),
//   booking pool ref 91 (schedule and three bookable items), learning sequence ref 90 (online,
//   three ordered content pages). Idempotent: each step checks the current state first.
// All text is synthetic and labelled "Lab". Lab-only: http://localhost:8080 and the lab accounts
// in lab-users.json. Never point this at ADAM.
// Usage (from the repo root): node tools/ilias-lab/seed/seed-sess-book-lso.mjs
import { labPage, LAB } from "./lab-page.mjs";

export const SESSION_TITLE = "Lab sess dated";
const LAB_COURSE = 86;
const BOOKING_POOL = 91;
const LEARNING_SEQUENCE = 90;
const MATERIALS = ["Lab fold", "Lab webr"];
const SCHEDULE = "Lab schedule (weekday slots)";
const BOOKABLE = [
  { title: "Lab item A (tablet)", description: "Lab seed: synthetic bookable tablet." },
  { title: "Lab item B (projector)", description: "Lab seed: synthetic bookable projector." },
  { title: "Lab item C (laptop)", description: "Lab seed: synthetic bookable laptop." },
];
const STEPS = [
  { title: "Lab step 1: orientation", description: "Lab seed: synthetic first step." },
  { title: "Lab step 2: worksheet", description: "Lab seed: synthetic second step." },
  { title: "Lab step 3: reflection", description: "Lab seed: synthetic third step." },
];

const { browser, page, user } = await labPage("admin");
const log = (msg) => console.log(msg);
const go = async (path) => {
  await page.goto(path.startsWith("http") ? path : `${LAB}/${path}`);
  await page.waitForLoadState("domcontentloaded");
};

/**
 * ILIAS 10.12 datetime-local inputs in Chromium take month, day, year, then Tab to the time
 * segments. Typing the whole string through `fill` is not persisted; segment typing is.
 */
async function typeDateTime(locator, [hour, minute]) {
  await locator.click({ position: { x: 8, y: 10 } });
  for (const part of ["12", "10", "2026"]) await page.keyboard.type(part);
  await page.keyboard.press("Tab");
  await page.keyboard.type(hour);
  await page.keyboard.type(minute);
  await page.keyboard.type("AM");
}

/** The ref of the lab session with SESSION_TITLE in Lab Course, or undefined. */
async function sessionRef() {
  await go(`goto.php?target=crs_${LAB_COURSE}`);
  const href = await page.locator("a", { hasText: SESSION_TITLE }).first().getAttribute("href").catch(() => null);
  return href?.match(/sess\/(\d+)|ref_id=(\d+)/)?.slice(1).find(Boolean);
}

try {
  log(`signed in as ${user.login}`);

  // 1. Session: create with the appointment set in the creation form, when absent.
  let session = await sessionRef();
  if (!session) {
    await go(`ilias.php?baseClass=ilrepositorygui&ref_id=${LAB_COURSE}&cmd=create&new_type=sess`);
    await typeDateTime(page.locator('input[name="event[start]"]'), ["09", "00"]);
    await typeDateTime(page.locator('input[name="event[end]"]'), ["11", "30"]);
    await page.fill('input[name="title"]', SESSION_TITLE);
    await page.fill('textarea[name="location"]', "Lab room 0.01 (synthetic)");
    await page.fill('textarea[name="desc"]', "Lab seed: synthetic session description for the reader tests. Not real course content.");
    await page.fill('textarea[name="details"]', "Lab seed: bring the synthetic worksheet from the lab step list.");
    await page.locator('input[name="cmd[save]"]').first().click();
    await page.waitForLoadState("domcontentloaded");
    session = await sessionRef();
    log(`session created: ${SESSION_TITLE} (ref ${session})`);
  } else {
    log(`session exists: ${SESSION_TITLE} (ref ${session})`);
  }
  if (!session) throw new Error(`session "${SESSION_TITLE}" not found after create`);

  // 2. Session materials: assign the lab folder and weblink (already-existing lab objects).
  for (const title of MATERIALS) {
    await go(`ilias.php?baseClass=ilrepositorygui&ref_id=${session}&cmdClass=ilObjSessionGUI&cmd=materials`);
    await page.fill('input[name="title"]', title);
    await page.getByRole("button", { name: "Apply Filter" }).click();
    await page.waitForLoadState("domcontentloaded");
    const row = page.locator("tr", { hasText: title }).first();
    if (!(await row.count())) { log(`material not found: ${title}`); continue; }
    await row.locator('input[name="items[]"]').check();
    await page.selectOption('select[name="selected_cmd2"]', "saveMaterials");
    await page.locator('input[name="select_cmd2"]').click();
    await page.waitForLoadState("domcontentloaded");
    log(`material assigned: ${title}`);
  }

  // 3. Booking pool: schedule, then three bookable items on it.
  await go(`goto.php?target=book_${BOOKING_POOL}`);
  await page.getByRole("link", { name: "Schedules" }).first().click();
  await page.waitForLoadState("domcontentloaded");
  if (!(await page.getByText(SCHEDULE, { exact: false }).count())) {
    await page.getByRole("link", { name: "Add Schedule" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.fill('input[name="title"]', SCHEDULE);
    await page.fill('input[name="days_from_hh~0"]', "09");
    await page.fill('input[name="days_from_mm~0"]', "00");
    await page.fill('input[name="days_to_hh~0"]', "17");
    await page.fill('input[name="days_to_mm~0"]', "00");
    const days = page.locator('input[name="days_days~0[]"]');
    for (let i = 0; i < 5; i++) await days.nth(i).check(); // Monday to Friday
    await page.getByLabel("X hours before time slot begins").check();
    await page.fill('input[name="deadline"]', "2");
    await page.fill('input[name="from"]', "2026-11-01T00:00");
    await page.fill('input[name="to"]', "2027-06-30T23:59");
    await page.locator('input[name="cmd[save]"]').first().click();
    await page.waitForLoadState("domcontentloaded");
    log(`schedule created: ${SCHEDULE}`);
  } else {
    log(`schedule exists: ${SCHEDULE}`);
  }

  await go(`ilias.php?baseClass=ilrepositorygui&ref_id=${BOOKING_POOL}&cmdClass=ilBookingObjectGUI&cmd=render`);
  for (const item of BOOKABLE) {
    if (await page.getByText(item.title, { exact: false }).count()) { log(`bookable exists: ${item.title}`); continue; }
    await page.getByRole("button", { name: "Add Item" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.fill('input[name="title"]', item.title);
    await page.fill('textarea[name="desc"]', item.description);
    await page.fill('input[name="items"]', "1");
    await page.selectOption('select[name="schedule"]', { label: SCHEDULE });
    await page.locator('input[name="cmd[save]"]').first().click();
    await page.waitForLoadState("domcontentloaded");
    log(`bookable created: ${item.title}`);
    await go(`ilias.php?baseClass=ilrepositorygui&ref_id=${BOOKING_POOL}&cmdClass=ilBookingObjectGUI&cmd=render`);
  }

  // 4. Learning sequence: online, then three ordered content pages.
  await go(`ilias.php?baseClass=ilrepositorygui&ref_id=${LEARNING_SEQUENCE}&cmdClass=ilObjLearningSequenceSettingsGUI&cmd=settings`);
  const online = page.getByLabel("Online");
  if (await online.count()) {
    if (!(await online.isChecked())) {
      await online.check();
      await page.getByRole("button", { name: "Save" }).first().click();
      await page.waitForLoadState("domcontentloaded");
      log("learning sequence: set online");
    } else log("learning sequence: already online");
  }
  await go(`ilias.php?baseClass=ilrepositorygui&ref_id=${LEARNING_SEQUENCE}&cmdClass=ilObjLearningSequenceContentGUI&cmd=manageContent`);
  for (const step of STEPS) {
    if (await page.getByText(step.title, { exact: false }).count()) { log(`step exists: ${step.title}`); continue; }
    await go(`ilias.php?baseClass=ilrepositorygui&cmd=create&ref_id=${LEARNING_SEQUENCE}&crtcb=${LEARNING_SEQUENCE}&new_type=copa`);
    await page.fill('input[name="form/input_0/input_1"]', step.title);
    await page.fill('textarea[name="form/input_0/input_2"]', step.description);
    await page.getByRole("button", { name: "Add Content Page" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    log(`step created: ${step.title}`);
  }
  // Content pages are created offline: publish each step, in order, through its own settings form.
  await go(`ilias.php?baseClass=ilrepositorygui&ref_id=${LEARNING_SEQUENCE}&cmdClass=ilObjLearningSequenceContentGUI&cmd=manageContent`);
  const stepRefs = [];
  for (const step of STEPS) {
    const href = await page.locator("a", { hasText: step.title }).first().getAttribute("href");
    stepRefs.push({ title: step.title, ref: href?.match(/ref_id=(\d+)/)?.[1] });
  }
  for (const { title, ref } of stepRefs) {
    if (!ref) { log(`step ref not found: ${title}`); continue; }
    await go(`ilias.php?baseClass=ilrepositorygui&cmd=edit&ref_id=${ref}`);
    const online = page.locator('input[name="activation_online"]');
    if (!(await online.count())) { log(`step settings not found: ${title}`); continue; }
    if (await online.isChecked()) { log(`step online: ${title}`); continue; }
    await online.check();
    await page.locator('input[name="cmd[update]"]').first().click();
    await page.waitForLoadState("domcontentloaded");
    log(`step published: ${title}`);
  }

  log(`done (session ${session}, book ${BOOKING_POOL}, lso ${LEARNING_SEQUENCE})`);
} finally {
  await browser.close();
}
