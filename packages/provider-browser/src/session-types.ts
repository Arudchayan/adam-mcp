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
};

export type AdamBrowserSession = {
  status(): Promise<SessionStatus>;
  open(url: string): Promise<PageSnapshot>;
  loginInteractively(timeoutMs?: number): Promise<SessionStatus>;
  fetchAuthorized(url: string): Promise<{ bytes: Uint8Array; contentType?: string }>;
  close(): Promise<void>;
};
