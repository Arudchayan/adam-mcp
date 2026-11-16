import { soap } from "./soap.mjs";
import config from "./lab-users.json" with { type: "json" };
const sid = await soap("login", { client: "lab", username: config.admin.login, password: config.admin.password });
console.log(`login ok: sid ${sid ? "received" : "missing"} (${sid.length} chars)`);
