// Seed the local ILIAS 10.12 lab (docs/ilias-lab.md) with users and one course
// holding each object type adam-mcp needs structure evidence for. Idempotent by
// title: re-running reuses what already exists. Localhost only (soap.mjs).
import { soap } from "./soap.mjs";
import config from "./lab-users.json" with { type: "json" };

const COURSE = "Lab Course";
// Types SOAP addObject creates directly (probed against v10.12). `dcl` fails in
// SOAP (ILIAS bug) and needs the web UI; `grp` uses addGroup; `exc` uses addExercise.
const OBJECT_TYPES = ["fold", "sess", "itgr", "lso", "book", "copa", "lm", "htlm", "wiki", "glo", "bibl", "mcst", "frm", "webr", "svy", "poll", "file", "blog", "exc"];
const COURSE_ROLE = { student: "Member", tutor: "Tutor", admin: "Admin" };

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sid = await soap("login", { client: "lab", username: config.admin.login, password: config.admin.password });
const log = (...parts) => console.log(...parts);

// --- users -----------------------------------------------------------------
const userIds = {};
for (const user of config.users) {
  let id = Number(await soap("lookupUser", { sid, user_name: user.login }));
  if (!id) {
    const xml = `<?xml version="1.0" encoding="utf-8"?><Users><User Action="Insert" Id="${user.login}">`
      + `<Login>${esc(user.login)}</Login><Role Id="4" Type="Global">User</Role>`
      + `<Password Type="PLAIN">${esc(user.password)}</Password>`
      + `<Firstname>${esc(user.firstname)}</Firstname><Lastname>${esc(user.lastname)}</Lastname>`
      + `<Email>${esc(user.login)}@example.test</Email><Active>true</Active><TimeLimitUnlimited>1</TimeLimitUnlimited>`
      + `</User></Users>`;
    await soap("importUsers", { sid, folder_id: 7, usr_xml: xml, conflict_rule: 1, send_account_mail: 0 });
    id = Number(await soap("lookupUser", { sid, user_name: user.login }));
  }
  userIds[user.login] = id;
  // ILIAS keeps forcing a password change while root has its setup default, so UI
  // seeding drives a separate lab system admin (global Administrator role id 2).
  if (user.role === "system") await soap("addUserRoleEntry", { sid, user_id: id, role_id: 2 });
  log(`user ${user.login.padEnd(13)} id=${id}`);
}

// --- helpers ----------------------------------------------------------------
const childTitles = async (refId) => {
  const xml = await soap("getTreeChilds", { sid, ref_id: refId, types: null, user_id: 6 });
  const found = {};
  // One <Object> block per child: its own type, Title and first References ref_id.
  for (const block of xml.split("<Object ").slice(1)) {
    const type = block.match(/^type="(\w+)"/)?.[1];
    const title = block.match(/<Title>([\s\S]*?)<\/Title>/)?.[1];
    const ref = block.match(/<References ref_id="(\d+)"/)?.[1];
    if (type && title && ref) found[`${type}:${title}`] = Number(ref);
  }
  return found;
};
const objectXml = (type, title) => `<?xml version="1.0" encoding="utf-8"?><Objects><Object type="${type}"><ImportId>lab_${type}_${Date.now()}</ImportId><Title>${esc(title)}</Title><Description>Lab seed</Description></Object></Objects>`;

// --- course -----------------------------------------------------------------
let courseRef = (await childTitles(1))[`crs:${COURSE}`];
if (!courseRef) courseRef = Number(await soap("addObject", { sid, target_id: 1, object_xml: objectXml("crs", COURSE) }));
log(`course "${COURSE}" ref=${courseRef}`);

for (const user of config.users.filter((u) => COURSE_ROLE[u.role])) {
  await soap("assignCourseMember", { sid, course_id: courseRef, user_id: userIds[user.login], type: COURSE_ROLE[user.role] }).catch((e) => log(`  member ${user.login}: ${e.message}`));
}
log(`members: ${config.users.filter((u) => COURSE_ROLE[u.role]).map((u) => `${u.login}=${COURSE_ROLE[u.role]}`).join(", ")}`);

let children = await childTitles(courseRef);
for (const type of OBJECT_TYPES) {
  const title = `Lab ${type}`;
  if (children[`${type}:${title}`]) continue;
  try { await soap("addObject", { sid, target_id: courseRef, object_xml: objectXml(type, title) }); }
  catch (e) { log(`  ${type}: ${e.message}`); }
}

if (!children["grp:Lab grp"]) {
  const groupXml = `<?xml version="1.0" encoding="utf-8"?><group exportVersion="2" id="il_0_grp_0" type="closed"><title>Lab grp</title><description>Lab seed</description><information>Lab seed</information><registration type="disabled" waitingList="0"/></group>`;
  await soap("addGroup", { sid, target_id: courseRef, group_xml: groupXml }).catch((e) => log(`  grp: ${e.message}`));
}

// --- exercise -----------------------------------------------------------------
// addExercise's XML importer crashes on assignments in v10.12 (uninitialised
// ilExAssignment::$peer_valid), so `exc` is created by addObject above and its
// assignments are added through the web UI by seed-ui.mjs.

children = await childTitles(courseRef);
const types = Object.keys(children).map((key) => key.split(":")[0]).sort();
log(`course children (${types.length}): ${types.join(", ")}`);
const missing = [...OBJECT_TYPES, "grp", "exc"].filter((t) => !types.includes(t));
log(missing.length ? `missing: ${missing.join(", ")}` : "all seeded types present");
