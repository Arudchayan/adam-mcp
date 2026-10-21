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
  connectionState?: "connected" | "disconnected" | "signing-in" | "signed-out" | "unknown";
  recoveryAction?: "none" | "login" | "finish_login" | "check_status";
  origin?: string;
  currentUrl?: string;
  title?: string;
  /** Why the reported state is what it is (ADR 0009). */
  reason?: "signed-in" | "login-required" | "unknown";
  message?: string;
  checkedAt?: string;
  /**
   * Bound live session-holder PID. Null/absent when the holder is stale, dead,
   * or unbound — never a reused stranger PID (ADR 0009).
   */
  holderPid?: number | null;
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

export type AuthorizedFetchResult = {
  bytes: Uint8Array;
  contentType?: string;
  contentDisposition?: string;
  contentLength?: number;
};

export type AuthorizedProbeResult = {
  contentType?: string;
  contentDisposition?: string;
  contentLength?: number;
};

/** CLI-only transfer sink; never part of the MCP provider/result contract. */
export type AuthorizedStreamOptions = {
  signal?: AbortSignal;
  maxBytes: number;
  timeoutMs: number;
  onHeaders: (headers: AuthorizedProbeResult) => Promise<void>;
  onChunk: (chunk: Uint8Array) => Promise<void>;
};

export type AdamBrowserSession = {
  /** Cheap local logout check, without launching or probing Chrome. */
  explicitlyLoggedOut?(): Promise<boolean>;
  status(): Promise<SessionStatus>;
  open(url: string, options?: { signal?: AbortSignal }): Promise<PageSnapshot>;
  loginInteractively(timeoutMs?: number, options?: { signal?: AbortSignal; force?: boolean; onProgress?: import("adam-core").ProgressReporter }): Promise<SessionStatus>;
  fetchAuthorized(url: string, options?: { signal?: AbortSignal }): Promise<AuthorizedFetchResult>;
  streamAuthorized?(url: string, options: AuthorizedStreamOptions): Promise<AuthorizedProbeResult>;
  /** Header-only probe (HEAD) for download metadata without pulling file bytes. */
  probeAuthorized?(url: string, options?: { signal?: AbortSignal }): Promise<AuthorizedProbeResult>;
  close(): Promise<void>;
  /** Export the authenticated cookie jar for the headless session holder (ADR 0009). */
  exportSessionState?(): Promise<{ cookies: SessionCookie[]; userAgent?: string } | undefined>;
};
