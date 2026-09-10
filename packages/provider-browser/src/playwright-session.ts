import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AdamError, MAX_EXTRACT_BYTES, redactUrl } from "adam-core";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { assertUrlAllowed, sameOrigin, urlAllowed } from "./allowlist.ts";
import { localCdpEndpoint, parseDevToolsActivePort } from "./cdp.ts";
import {
  debugCaptureEnabled,
  defaultOrigin,
  defaultProfileDir,
  headedByDefault,
} from "./config.ts";
import { buildDebugCapture, writeDebugCapture } from "./debug-capture.ts";
import { attachDownloadGuard, CHROME_LAUNCH_POLICY, chromeLaunchArgs } from "./download-guard.ts";
import {
  EMPTY_CONTAINER_COPY,
  MAX_HTML_BYTES,
  MAX_PAGE_TEXT,
  capText,
  isLoggedInSnapshot,
  isLoginSnapshot,
  mergeFrameLinks,
} from "./extract.ts";
import { DEFAULT_FEEDBACK_HOLD_MS, minimizeChromeWindow, showSessionFeedback } from "./session-feedback.ts";
import { holderStatus, startSessionHolder } from "./session-holder.ts";
import { SerialQueue } from "./serial-queue.ts";
import type {
  AdamBrowserSession,
  PageSnapshot,
  SessionCookie,
  SessionStatus,
  SnapshotLink,
} from "./session-types.ts";

const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

const SESSION_SETTLED_SCRIPT = `(() => {
  const text = (document.body ? document.body.innerText : "").toLowerCase();
  return (
    /bei adam anmelden|login mit switch edu-id/.test(text) ||
    /abmelden|log out|logout|persönlicher schreibtisch|dashboard/.test(text)
  );
})()`;

/** Listing readiness/evidence probe, shared by the wait and the DOM signals. */
const LISTING_ITEM_SELECTOR =
  ".ilContainerListItemOuter, a.il_ContainerItemTitle, .il-item, .il-item-title, .il-std-item-container, #il_center_col a[href*='ref_id='], a[href*='cmdClass=ilobjfilegui'], a[href*='/go/file/'], a[href*='/go/exc/'], a[href*='/go/fold/']";

const LISTING_PROBE_SCRIPT = `(() => {
  const root =
    document.querySelector("main #il_center_col") ??
    document.querySelector("#il_center_col") ??
    document.querySelector("main") ??
    document.body;
  const items = root ? root.querySelectorAll(${JSON.stringify(LISTING_ITEM_SELECTOR)}) : [];
  const rows = new Set();
  for (const item of items) {
    rows.add(item.closest(".ilContainerListItemOuter, .il-item, .il-std-item-container, li, tr") || item);
  }
  const text = root ? root.innerText || "" : "";
  const emptyCopy = (${EMPTY_CONTAINER_COPY.toString()}).test(text || "");
  const content =
    document.querySelector("#il_center_col") ?? document.querySelector("#ilContentContainer");
  const contentBlank = Boolean(content) && content.childElementCount === 0 && (content.innerText || "").trim().length === 0;
  return { itemRows: rows.size, emptyCopy, contentBlank };
})()`;

const LISTING_READY_SCRIPT = `(() => {
  const probe = ${LISTING_PROBE_SCRIPT};
  return probe.itemRows > 0 || probe.emptyCopy;
})()`;

/** Runs in the page: text-free tag/class skeleton of the main content area (debug capture). */
const DEBUG_SKELETON_SCRIPT = `(() => {
  const out = [];
  const root = document.querySelector("main") || document.body;
  if (!root) return out;
  const walk = (element, depth) => {
    if (depth > 5 || out.length >= 250) return;
    const tag = element.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "svg") return;
    const className = typeof element.className === "string" ? element.className : "";
    const classes = className
      .trim()
      .split(/\\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .map((name) => name.replace(/\\d+/g, "{id}"));
    const id = element.id ? "#" + element.id.replace(/\\d+/g, "{id}") : "";
    out.push("  ".repeat(depth) + tag + id + (classes.length ? "." + classes.join(".") : ""));
    for (const child of Array.from(element.children)) walk(child, depth + 1);
  };
  walk(root, 0);
  return out;
})()`;

/**
 * status() must not trust a leftover tab (for example a stale login.php page
 * while the authenticated session lives in another tab). Probe the origin when
 * the current URL is blank, off-origin, the origin root, or a login page.
 */
export function shouldProbeOrigin(currentUrl: string, origin: string): boolean {
  if (!currentUrl || currentUrl === "about:blank") {
    return true;
  }
  try {
    const current = new URL(currentUrl);
    const root = new URL(origin);
    if (current.origin !== root.origin) {
      return true;
    }
    return current.pathname === "/" || /login\.php/i.test(current.pathname);
  } catch {
    return true;
  }
}

/** Pick the max row count across frame probes; empty copy and blank content only count with no rows. */
export function mergeListingProbes(
  probes: Array<{ itemRows: number; emptyCopy: boolean; contentBlank: boolean }>,
): PageSnapshot["dom"] | undefined {
  if (probes.length === 0) {
    return undefined;
  }
  const itemRows = Math.max(...probes.map((probe) => probe.itemRows));
  if (itemRows > 0) {
    return { itemRows, emptyCopy: false };
  }
  return {
    itemRows: 0,
    emptyCopy: probes.some((probe) => probe.emptyCopy),
    contentBlank: probes.some((probe) => probe.contentBlank),
  };
}

/** Outcome of a status snapshot: signed-in, login form, or neither (transient). */
export function classifyStatus(snapshot: PageSnapshot): "logged-in" | "login" | "transient" {
  if (isLoggedInSnapshot(snapshot)) {
    return "logged-in";
  }
  if (isLoginSnapshot(snapshot)) {
    return "login";
  }
  return "transient";
}

const COLLECT_LINKS_SCRIPT = `(() => {
  return [...document.querySelectorAll("a[href]")].map((anchor) => {
    return {
      href: anchor.href,
      text: (anchor.textContent || "").replace(/\\s+/g, " ").trim(),
      inChrome: Boolean(
        anchor.closest(
          ".il-layout-page > header, header.il-layout-page-header, [aria-label='Hauptnavigationsleiste'], .il-mainbar, #ilTopBar, .il-footer, footer.il-footer, .ilMainMenu",
        ),
      ),
      inBreadcrumb: Boolean(
        anchor.closest("[aria-label='Brotkrumen'], [aria-label='Breadcrumb'], .breadcrumb, .breadcrumbs, .il-breadcrumb"),
      ),
    };
  });
})()`;

export type PlaywrightSessionOptions = {
  origin?: string;
  profileDir?: string;
  headed?: boolean;
  feedbackHoldMs?: number;
  hideWindowAfterFeedback?: boolean;
};

export class PlaywrightAdamSession implements AdamBrowserSession {
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private attachedBrowser: Browser | undefined;
  private ownsChrome = false;
  private readonly queue = new SerialQueue();
  private readonly origin: string;
  private readonly profileDir: string;
  private headed: boolean;
  private readonly feedbackHoldMs: number;
  private readonly hideWindowAfterFeedback: boolean;

  constructor(options: PlaywrightSessionOptions = {}) {
    this.origin = options.origin ?? defaultOrigin();
    this.profileDir = options.profileDir ?? defaultProfileDir();
    this.headed = options.headed ?? headedByDefault();
    this.feedbackHoldMs = options.feedbackHoldMs ?? DEFAULT_FEEDBACK_HOLD_MS;
    this.hideWindowAfterFeedback = options.hideWindowAfterFeedback ?? true;
  }

  async status(): Promise<SessionStatus> {
    return this.serialize(async () => {
      const holder = await holderStatus(this.profileDir);
      if (!holder.running && !this.page && !this.context) {
        const endpoint = await readLocalCdpEndpoint(this.profileDir);
        if (!endpoint) {
          return {
            loggedIn: false,
            origin: this.origin,
            reason: "login-required" as const,
            message: "No ADAM session. Run `adam-mcp login` (or the adam_login tool) to sign in.",
            checkedAt: new Date().toISOString(),
          };
        }
      }
      const page = await this.ensurePage();
      if (shouldProbeOrigin(page.url(), this.origin)) {
        assertUrlAllowed(this.origin);
        await page.goto(this.origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await this.waitForSessionSettled(page);
      }
      let snapshot = await this.readSnapshot(page);
      const kind = classifyStatus(snapshot);
      if (kind === "login") {
        // Cold-start bootstrap: the first request after a fresh Chrome launch can
        // land on login.php even though the session is valid. One bounded re-probe.
        await delay(750);
        await page
          .goto(this.origin, { waitUntil: "domcontentloaded", timeout: 45_000 })
          .catch(() => undefined);
        await this.waitForSessionSettled(page);
        snapshot = await this.readSnapshot(page);
      } else if (kind === "transient") {
        // Transient redirect/loading page: one bounded retry before reporting a false negative.
        await this.waitForSessionSettled(page);
        snapshot = await this.readSnapshot(page);
      }
      return this.toStatus(snapshot);
    });
  }

  /** Cookie jar for the headless session holder (ADR 0009). */
  async exportSessionState(): Promise<{ cookies: SessionCookie[]; userAgent?: string } | undefined> {
    if (!this.context) {
      return undefined;
    }
    const state = await this.context.storageState();
    let userAgent: string | undefined;
    try {
      userAgent = this.page ? String(await this.page.evaluate("navigator.userAgent")) : undefined;
    } catch {
      userAgent = undefined;
    }
    return { cookies: state.cookies as SessionCookie[], userAgent };
  }

  async open(url: string): Promise<PageSnapshot> {
    return this.serialize(async () => {
      const target = this.resolveUrl(url);
      assertUrlAllowed(target);
      const page = await this.ensurePage();
      // ADR 0005: DCL only — no load/networkidle/fixed-delay tax. One bounded
      // content wait with a real function predicate (arg undefined, options 3rd).
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (/\/go\/crs\//i.test(target)) {
        await page
          .locator("[role='tab'], a, button")
          .filter({ hasText: /^(Content|Inhalt)$/i })
          .first()
          .click({ timeout: 3_000 })
          .catch(() => undefined);
      }
      await page.waitForFunction(LISTING_READY_SCRIPT, undefined, { timeout: 12_000 }).catch(() => undefined);
      await this.rejectIfBlocked(page);
      const dom = await this.probeListing(page);
      const snapshot = await this.readSnapshot(page, dom);
      if (debugCaptureEnabled()) {
        await this.captureDebug(page, snapshot);
      }
      return snapshot;
    });
  }

  async loginInteractively(timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS): Promise<SessionStatus> {
    return this.serialize(async () => {
      this.headed = true;
      let page = await this.ensurePage({ allowLaunch: true });
      try {
        await page.goto(this.origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch {
        await this.closeContext();
        page = await this.ensurePage({ allowLaunch: true });
        await page.goto(this.origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      await this.rejectIfBlocked(page);
      let snapshot: PageSnapshot | undefined = await this.readSnapshot(page);
      if (!isLoggedInSnapshot(snapshot)) {
        await this.clickSwitchIfPresent(page);
        console.error(
          "Complete SWITCH edu-ID in the Chrome window. Do not paste the password into the terminal or into chat.",
        );
        const deadline = Date.now() + timeoutMs;
        snapshot = undefined;
        while (Date.now() < deadline) {
          await delay(1_000);
          try {
            snapshot = await this.readSnapshot(page);
          } catch {
            continue;
          }
          if (snapshot && isLoggedInSnapshot(snapshot)) {
            break;
          }
        }
      }
      if (!snapshot || !isLoggedInSnapshot(snapshot)) {
        await this.announceLogin(page, "error");
        throw new AdamError(
          "unauthorized",
          "SWITCH login did not finish in time. Complete it in the Chrome window, then retry npm run login.",
        );
      }
      await this.announceLogin(page, "success");
      if (!headedByDefault()) {
        // ADR 0009: transfer the cookie jar to a detached headless holder and
        // close the interactive window; the login command can now return.
        const seed = await this.exportSessionState();
        await this.closeContext();
        if (!seed || seed.cookies.length === 0) {
          throw new AdamError(
            "unauthorized",
            "Signed in, but no session cookies were captured. Run adam-mcp login again.",
          );
        }
        await startSessionHolder({ profileDir: this.profileDir, origin: this.origin, seed });
        const attached = await this.tryAttachCdp();
        if (!attached || !this.context) {
          throw new AdamError(
            "provider_unavailable",
            "The headless session started but could not be attached. Retry adam-mcp login.",
          );
        }
        this.page = this.context.pages()[0] ?? (await this.context.newPage());
        attachDownloadGuard(this.page);
        return this.toStatus(await this.readSnapshot(this.page));
      }
      // Debug escape hatch (ADAM_BROWSER_HEADED=1): keep the headed browser in-process.
      if (this.hideWindowAfterFeedback) {
        await minimizeChromeWindow(page);
      }
      return this.toStatus(await this.readSnapshot(page));
    });
  }

  async fetchAuthorized(url: string): Promise<{ bytes: Uint8Array; contentType?: string }> {
    return this.serialize(async () => {
      const target = this.resolveUrl(url);
      assertUrlAllowed(target);
      const page = await this.ensurePage();
      const response = await page.context().request.get(target, { timeout: 45_000, maxRedirects: 5 });
      assertUrlAllowed(response.url());
      if (!response.ok()) {
        throw new AdamError(
          "not_found",
          `ADAM returned HTTP ${response.status()} for a file fetch.`,
        );
      }
      const contentType = response.headers()["content-type"];
      const body = Buffer.from(await response.body());
      if (body.byteLength > MAX_EXTRACT_BYTES) {
        throw new AdamError(
          "provider_unavailable",
          `File is larger than the ${MAX_EXTRACT_BYTES} byte extract limit.`,
        );
      }
      return { bytes: new Uint8Array(body), contentType };
    });
  }

  async close(): Promise<void> {
    await this.closeContext();
  }

  private resolveUrl(url: string): string {
    return new URL(url, this.origin).toString();
  }

  private toStatus(snapshot: PageSnapshot): SessionStatus {
    const loggedIn = isLoggedInSnapshot(snapshot);
    return {
      loggedIn,
      origin: this.origin,
      currentUrl: redactUrl(snapshot.url),
      title: snapshot.title,
      reason: loggedIn ? "signed-in" : "login-required",
      checkedAt: new Date().toISOString(),
    };
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.enqueue(work);
  }

  private async announceLogin(page: Page, kind: "success" | "error"): Promise<void> {
    const copy =
      kind === "success"
        ? {
            headline: "You're signed in to ADAM",
            detail: "This window will close. Your ADAM session stays in the background.",
          }
        : {
            headline: "ADAM sign-in did not finish",
            detail: "Sign-in did not finish in time. If SWITCH said the request was too old, that form expired — run login again.",
          };
    await showSessionFeedback(page, kind, copy.headline, copy.detail, {
      holdMs: this.feedbackHoldMs,
      hideWindow: false,
    });
  }

  private async ensurePage(options: { allowLaunch?: boolean } = {}): Promise<Page> {
    if (this.page && this.context && !this.page.isClosed()) {
      return this.page;
    }
    this.page = undefined;
    if (this.context) {
      try {
        const stillOpen = this.context.pages().find((open) => !open.isClosed());
        if (stillOpen) {
          this.page = stillOpen;
          attachDownloadGuard(this.page);
          return this.page;
        }
        this.page = await this.context.newPage();
        attachDownloadGuard(this.page);
        return this.page;
      } catch {
        this.context = undefined;
        this.attachedBrowser = undefined;
        this.ownsChrome = false;
      }
    }

    const attached = await this.tryAttachCdp();
    if (!attached) {
      if (!options.allowLaunch) {
        throw new AdamError(
          "unauthorized",
          "No ADAM session is running. Run `adam-mcp login` (or the adam_login tool) to sign in, then retry. Do not paste credentials into chat.",
        );
      }
      await mkdir(this.profileDir, { recursive: true });
      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, {
          channel: "chrome",
          headless: !this.headed,
          acceptDownloads: CHROME_LAUNCH_POLICY.acceptDownloads,
          viewport: { width: 1280, height: 900 },
          locale: "de-CH",
          args: chromeLaunchArgs(),
        });
        this.ownsChrome = true;
      } catch (error) {
        const retry = await this.tryAttachCdp();
        if (!retry) {
          const detail = error instanceof Error ? error.message : "unknown error";
          throw new AdamError(
            "provider_unavailable",
            `Could not open Google Chrome with a local ADAM profile. Close other adam-mcp Chrome windows and try again. ${detail}`,
          );
        }
      }
    }

    if (!this.context) {
      throw new AdamError("provider_unavailable", "Chrome session is not available.");
    }
    this.context.on("page", (opened) => {
      attachDownloadGuard(opened);
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    attachDownloadGuard(this.page);
    return this.page;
  }

  private async tryAttachCdp(): Promise<boolean> {
    const endpoint = await readLocalCdpEndpoint(this.profileDir);
    if (!endpoint) {
      return false;
    }
    try {
      this.attachedBrowser = await chromium.connectOverCDP(endpoint);
      this.context = this.attachedBrowser.contexts()[0];
      this.ownsChrome = false;
      return Boolean(this.context);
    } catch {
      this.attachedBrowser = undefined;
      this.context = undefined;
      return false;
    }
  }

  private async readSnapshot(page: Page, dom?: PageSnapshot["dom"]): Promise<PageSnapshot> {
    await this.rejectIfBlocked(page);
    let html = capText(await page.content(), MAX_HTML_BYTES);
    let text = capText(await page.locator("body").innerText().catch(() => ""), MAX_PAGE_TEXT * 2);
    const title = await page.title();
    const mainLinks = (await page.evaluate(COLLECT_LINKS_SCRIPT)) as SnapshotLink[];
    const frameLinks: SnapshotLink[] = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) {
        continue;
      }
      try {
        const frameUrl = frame.url();
        // ADR 0009: only same-origin frames contribute links, text, or HTML.
        if (!frameUrl || !sameOrigin(frameUrl, this.origin)) {
          continue;
        }
        const collected = (await frame.evaluate(COLLECT_LINKS_SCRIPT).catch(() => [])) as SnapshotLink[];
        frameLinks.push(...collected);
        const frameText = await frame.locator("body").innerText().catch(() => "");
        if (frameText) {
          text = capText(`${text}\n${frameText}`, MAX_PAGE_TEXT * 2);
        }
        const frameHtml = await frame.content().catch(() => "");
        if (frameHtml) {
          html = capText(`${html}\n${frameHtml}`, MAX_HTML_BYTES);
        }
      } catch {
        continue;
      }
    }
    return {
      url: page.url(),
      title,
      html,
      text,
      links: mergeFrameLinks(mainLinks, frameLinks),
      ...(dom ? { dom } : {}),
    };
  }

  private async waitForSessionSettled(page: Page): Promise<void> {
    await page.waitForFunction(SESSION_SETTLED_SCRIPT, undefined, { timeout: 5_000 }).catch(() => undefined);
  }

  /** Listing evidence from the main frame and same-origin content frames. */
  private async probeListing(page: Page): Promise<PageSnapshot["dom"] | undefined> {
    type Probe = { itemRows: number; emptyCopy: boolean; contentBlank: boolean };
    const probes: Probe[] = [];
    const main = (await page.evaluate(LISTING_PROBE_SCRIPT).catch(() => undefined)) as Probe | undefined;
    if (main) {
      probes.push(main);
    }
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) {
        continue;
      }
      try {
        if (!sameOrigin(frame.url(), this.origin)) {
          continue;
        }
        const probe = (await frame.evaluate(LISTING_PROBE_SCRIPT).catch(() => undefined)) as Probe | undefined;
        if (probe) {
          probes.push(probe);
        }
      } catch {
        continue;
      }
    }
    return mergeListingProbes(probes);
  }

  private async captureDebug(page: Page, snapshot: PageSnapshot): Promise<void> {
    try {
      const frameOrigins = page
        .frames()
        .map((frame) => frame.url())
        .filter((url) => Boolean(url) && url !== "about:blank")
        .map((url) => {
          try {
            return new URL(url).origin;
          } catch {
            return "[unparseable]";
          }
        });
      const skeleton = (await page.evaluate(DEBUG_SKELETON_SCRIPT).catch(() => [])) as string[];
      const json = buildDebugCapture({
        origin: this.origin,
        url: snapshot.url,
        titleLength: snapshot.title.length,
        dom: snapshot.dom,
        frameOrigins,
        skeleton,
        links: snapshot.links,
      });
      await writeDebugCapture("listing", json);
    } catch {
      // Debug capture must never break a live request.
    }
  }

  private async rejectIfBlocked(page: Page): Promise<void> {
    const current = page.url();
    if (current === "about:blank" || current.startsWith("chrome")) {
      return;
    }
    if (!urlAllowed(current)) {
      throw new AdamError(
        "provider_unavailable",
        `Blocked navigation off the ADAM/SWITCH allowlist: ${redactUrl(current)}`,
      );
    }
  }

  private async clickSwitchIfPresent(page: Page): Promise<void> {
    const button = page.getByRole("button", { name: /Login mit Switch edu-ID/i });
    if ((await button.count()) === 0) {
      return;
    }
    await button.first().click({ timeout: 5_000 }).catch(() => undefined);
  }

  private async closeContext(): Promise<void> {
    const context = this.context;
    const attached = this.attachedBrowser;
    this.context = undefined;
    this.page = undefined;
    this.attachedBrowser = undefined;
    if (this.ownsChrome && context) {
      await context.close().catch(() => undefined);
    } else if (attached) {
      await attached.close().catch(() => undefined);
    }
    this.ownsChrome = false;
  }
}

export function createPlaywrightSession(options?: PlaywrightSessionOptions): PlaywrightAdamSession {
  return new PlaywrightAdamSession(options);
}

async function readLocalCdpEndpoint(profileDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(profileDir, "DevToolsActivePort"), "utf8");
    const port = parseDevToolsActivePort(raw);
    if (port === undefined) {
      return undefined;
    }
    return localCdpEndpoint(port);
  } catch {
    return undefined;
  }
}
