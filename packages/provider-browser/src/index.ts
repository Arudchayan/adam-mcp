import {
  createBrowserProvider,
  BrowserAdamProvider,
  retainWalkPage,
  walkRetentionByteProxy,
  fullSnapshotByteProxy,
} from "./browser-provider.ts";
import { createMemorySession, snapshotFromHtml } from "./memory-session.ts";
import { createPlaywrightSession } from "./playwright-session.ts";

export { hostnameAllowed, urlAllowed } from "./allowlist.ts";
export {
  extractCatalog,
  exerciseDeadlineFromPage,
  inferDates,
  isAdamFailurePage,
  isLoggedInSnapshot,
  isLoginSnapshot,
} from "./extract.ts";
export { defaultProfileDir } from "./config.ts";
export {
  createBrowserProvider,
  BrowserAdamProvider,
  retainWalkPage,
  walkRetentionByteProxy,
  fullSnapshotByteProxy,
};
export type { LivePage } from "./browser-provider.ts";
export { createMemorySession, snapshotFromHtml };
export { createPlaywrightSession };
export { runLoginCli } from "./login-cli.ts";
export { runLogoutCli } from "./logout-cli.ts";
export { runStatusCli } from "./status-cli.ts";
export {
  clearHolderFiles,
  holderStatus,
  readHolderRecord,
  runSessionHolder,
  startSessionHolder,
  stopSessionHolder,
} from "./session-holder.ts";
export type { HolderRecord, SessionSeed } from "./session-holder.ts";
export type { AdamBrowserSession, PageSnapshot, SessionCookie, SessionStatus } from "./session-types.ts";
