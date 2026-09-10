export type SnapshotLink = {
  href: string;
  text: string;
  inChrome: boolean;
  inBreadcrumb: boolean;
};

export type PageSnapshot = {
  url: string;
  title: string;
  html: string;
  text: string;
  links: SnapshotLink[];
  /** Page-context listing evidence. Optional for fixtures/memory sessions. */
  dom?: {
    itemRows: number;
    emptyCopy: boolean;
    /** Content container rendered but has no items and no text at all. */
    contentBlank?: boolean;
  };
};

export type SessionStatus = {
  loggedIn: boolean;
  origin?: string;
  currentUrl?: string;
  title?: string;
  /** Why the reported state is what it is (ADR 0009). */
  reason?: "signed-in" | "login-required" | "unknown";
  message?: string;
  checkedAt?: string;
};

/** Playwright storage-state cookie shape, kept dependency-free for the session interface. */
export type SessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type AdamBrowserSession = {
  status(): Promise<SessionStatus>;
  open(url: string): Promise<PageSnapshot>;
  loginInteractively(timeoutMs?: number): Promise<SessionStatus>;
  fetchAuthorized(url: string): Promise<{ bytes: Uint8Array; contentType?: string }>;
  close(): Promise<void>;
  /** Export the authenticated cookie jar for the headless session holder (ADR 0009). */
  exportSessionState?(): Promise<{ cookies: SessionCookie[]; userAgent?: string } | undefined>;
};
