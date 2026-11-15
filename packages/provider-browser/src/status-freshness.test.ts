import assert from "node:assert/strict";
import { it } from "node:test";
import { STATUS_PAGE_FRESH_MS, statusNeedsProbe } from "./playwright-session.ts";

const origin = "https://adam.unibas.ch";
const dashboard = `${origin}/ilias.php?baseClass=ilDashboardGUI&cmd=jumpToSelectedItems`;

it("status re-probes a stale logged-in tab instead of trusting old markup", () => {
  const now = 10_000_000;
  assert.equal(statusNeedsProbe(dashboard, origin, now - 1_000, now), false, "a page loaded seconds ago is trusted");
  assert.equal(statusNeedsProbe(dashboard, origin, now - STATUS_PAGE_FRESH_MS - 1, now), true, "an old Dashboard tab is re-probed");
  assert.equal(statusNeedsProbe(dashboard, origin, 0, now), true, "a fresh process (CLI status) always re-probes");
  assert.equal(statusNeedsProbe(`${origin}/login.php`, origin, now, now), true, "login pages are still re-probed");
});
