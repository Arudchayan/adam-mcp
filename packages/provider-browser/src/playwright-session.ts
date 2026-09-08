import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AdamError, MAX_EXTRACT_BYTES, redactUrl } from "adam-core";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { assertUrlAllowed, urlAllowed } from "./allowlist.ts";
import { localCdpEndpoint, parseDevToolsActivePort } from "./cdp.ts";
import {
  defaultOrigin,
  defaultProfileDir,
  headedByDefault,
} from "./config.ts";
import { attachDownloadGuard, CHROME_LAUNCH_POLICY, chromeLaunchArgs } from "./download-guard.ts";
import { MAX_HTML_BYTES, MAX_PAGE_TEXT, capText, isLoggedInSnapshot } from "./extract.ts";
import { DEFAULT_FEEDBACK_HOLD_MS, minimizeChromeWindow, showSessionFeedback } from "./session-feedback.ts";
import { injectableCookies } from "./session-handoff.ts";
import { SerialQueue } from "./serial-queue.ts";
import type { AdamBrowserSession, PageSnapshot, SessionStatus } from "./session-types.ts";

const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

const COLLECT_LINKS_SCRIPT = `(() => {
  return [...document.querySelectorAll("a[href]")].map((anchor) => {
    return {
      href: anchor.href,
      text: (anchor.textContent || "").replace(/\\s+/g, " ").trim(),
      inChrome: Boolean(
        anchor.closest(
          "header, footer, [aria-label='Hauptnavigationsleiste'], .il-mainbar, #ilTopBar, .il-footer, .ilMainMenu",
        ),
      ),
      inBreadcrumb: Boolean(
        anchor.closest("[aria-label='Brotkrumen'], [aria-label='Breadcrumb'], .breadcrumb, .il-breadcrumb"),
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
      const page = await this.ensurePage();
      if (page.url() === "about:blank" || page.url() === "") {
        assertUrlAllowed(this.origin);
        await page.goto(this.origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      const snapshot = await this.readSnapshot(page);
      return this.toStatus(snapshot);
    });
  }

  async open(url: string): Promise<PageSnapshot> {
    return this.serialize(async () => {
      const target = this.resolveUrl(url);
      assertUrlAllowed(target);
      const page = await this.ensurePage();
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page
        .waitForSelector("h1, .il-item, a[href*='/go/'], a[href*='ref_id=']", { timeout: 8_000 })
        .catch(() => undefined);
      await this.rejectIfBlocked(page);
      return this.readSnapshot(page);
    });
  }

  async loginInteractively(timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS): Promise<SessionStatus> {
    return this.serialize(async () => {
      this.headed = true;
      let page = await this.ensurePage();
      try {
        await page.goto(this.origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch {
        await this.closeContext();
        page = await this.ensurePage();
        await page.goto(this.origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      await this.rejectIfBlocked(page);
      let snapshot: PageSnapshot | undefined = await this.readSnapshot(page);
      if (isLoggedInSnapshot(snapshot)) {
        await this.announceLogin(page, "success");
        await this.continueHeadlessIfOwned(page);
        return this.toStatus(await this.readSnapshot(await this.ensurePage()));
      }
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
      if (!snapshot || !isLoggedInSnapshot(snapshot)) {
        await this.announceLogin(page, "error");
        throw new AdamError(
          "unauthorized",
          "SWITCH login did not finish in time. Complete it in the Chrome window, then retry npm run login.",
        );
      }
      await this.announceLogin(page, "success");
      await this.continueHeadlessIfOwned(page);
      return this.toStatus(await this.readSnapshot(await this.ensurePage()));
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
    return {
      loggedIn: isLoggedInSnapshot(snapshot),
      origin: this.origin,
      currentUrl: redactUrl(snapshot.url),
      title: snapshot.title,
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

  private async continueHeadlessIfOwned(page: Page): Promise<void> {
    if (!this.ownsChrome || !this.context) {
      if (this.hideWindowAfterFeedback) {
        await minimizeChromeWindow(page);
      }
      return;
    }
    let userAgent = "Mozilla/5.0";
    try {
      userAgent = String(await page.evaluate("navigator.userAgent"));
    } catch {
      // Keep a generic UA; verification below fail-closes if ADAM rejects it.
    }
    const state = await this.context.storageState();
    const jar = injectableCookies(state.cookies);
    await this.closeContext();
    this.headed = false;
    await mkdir(this.profileDir, { recursive: true });
    let launched: BrowserContext | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        launched = await chromium.launchPersistentContext(this.profileDir, {
          channel: "chrome",
          headless: true,
          acceptDownloads: CHROME_LAUNCH_POLICY.acceptDownloads,
          viewport: { width: 1280, height: 900 },
          locale: "de-CH",
          userAgent,
          args: chromeLaunchArgs(),
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await delay(250 * (attempt + 1));
      }
    }
    if (!launched) {
      const detail = lastError instanceof Error ? lastError.message : "unknown error";
      throw new AdamError(
        "provider_unavailable",
        `Could not continue the ADAM session in the background. ${detail}`,
      );
    }
    this.context = launched;
    this.ownsChrome = true;
    this.context.on("page", (opened) => {
      attachDownloadGuard(opened);
    });
    try {
      await this.context.addCookies(jar);
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
      attachDownloadGuard(this.page);
      assertUrlAllowed(this.origin);
      await this.page.goto(this.origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const snapshot = await this.readSnapshot(this.page);
      if (!isLoggedInSnapshot(snapshot)) {
        throw new AdamError(
          "unauthorized",
          "ADAM did not accept the background session. Run adam_login again and complete SWITCH in Chrome.",
        );
      }
    } catch (error) {
      await this.closeContext();
      if (error instanceof AdamError) {
        throw error;
      }
      throw new AdamError(
        "unauthorized",
        "ADAM did not accept the background session. Run adam_login again and complete SWITCH in Chrome.",
      );
    }
  }

  private async ensurePage(): Promise<Page> {
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

  private async readSnapshot(page: Page): Promise<PageSnapshot> {
    await this.rejectIfBlocked(page);
    const html = capText(await page.content(), MAX_HTML_BYTES);
    const text = capText(await page.locator("body").innerText().catch(() => ""), MAX_PAGE_TEXT * 2);
    const title = await page.title();
    const links = (await page.evaluate(COLLECT_LINKS_SCRIPT)) as PageSnapshot["links"];
    return { url: page.url(), title, html, text, links };
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
