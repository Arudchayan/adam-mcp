import { AdamError } from "adam-core";
import { assertUrlAllowed } from "./allowlist.ts";
import { defaultOrigin } from "./config.ts";
import { collectLinksFromHtml, isLoggedInSnapshot } from "./extract.ts";
import type { AdamBrowserSession, PageSnapshot, SessionStatus } from "./session-types.ts";

export type MemorySessionPages = Record<string, PageSnapshot>;

export function snapshotFromHtml(url: string, title: string, html: string, text: string): PageSnapshot {
  return {
    url,
    title,
    html,
    text,
    links: collectLinksFromHtml(html),
  };
}

export type MemoryBlob = {
  bytes: Uint8Array;
  contentType?: string;
};

export function createMemorySession(
  pages: MemorySessionPages,
  options: { files?: Record<string, MemoryBlob> } = {},
): AdamBrowserSession {
  const origin = defaultOrigin();
  let current = pages.home ?? Object.values(pages)[0];

  return {
    async status(): Promise<SessionStatus> {
      return {
        loggedIn: current ? isLoggedInSnapshot(current) : false,
        origin,
        currentUrl: current?.url,
        title: current?.title,
      };
    },
    async open(url: string): Promise<PageSnapshot> {
      assertUrlAllowed(url);
      const hit = pages[url] ?? matchByRef(pages, url);
      if (!hit) {
        throw new AdamError("not_found", `No snapshot for ${url} in the memory session.`);
      }
      current = hit;
      return hit;
    },
    async loginInteractively(): Promise<SessionStatus> {
      current = pages.home ?? current;
      return {
        loggedIn: current ? isLoggedInSnapshot(current) : false,
        origin,
        currentUrl: current?.url,
        title: current?.title,
      };
    },
    async fetchAuthorized(url: string): Promise<{ bytes: Uint8Array; contentType?: string }> {
      assertUrlAllowed(url);
      const blob = options.files?.[url];
      if (!blob) {
        throw new AdamError("not_found", `No file bytes for ${url} in the memory session.`);
      }
      return blob;
    },
    async close(): Promise<void> {
      return;
    },
  };
}

function matchByRef(pages: MemorySessionPages, url: string): PageSnapshot | undefined {
  for (const snapshot of Object.values(pages)) {
    if (snapshot.url === url || url.endsWith(snapshot.url) || snapshot.url.includes(url)) {
      return snapshot;
    }
  }
  return undefined;
}
