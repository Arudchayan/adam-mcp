import type { ForumPost, ForumThreadSummary } from "adam-core";
import type { PageSnapshot, SnapshotLink } from "./session-types.ts";

export type ParsedForum = {
  threads: ForumThreadSummary[];
  posts: ForumPost[];
  /** viewThread (or equivalent) hrefs keyed by threadId — never showUser. */
  threadHrefs: Record<string, string>;
};

const FORUM_COMMAND_LABEL =
  /^(?:reply|antworten|quote|zitieren|edit|bearbeiten|delete|löschen|move|verschieben|merge|zusammenführen|print|drucken|subscribe|abonnieren|notification|benachrichtigung|mark as read|als gelesen(?: markieren)?|new thread|neues thema|back|zurück|previous|next|vorherige|nächste|show user|benutzer(?: anzeigen)?|#)$/i;

/**
 * Honest ILIAS 10 forum parse. Only ids/titles/bodies present in the HTML.
 * Never invent threads or posts.
 */
export function parseForumPage(snapshot: PageSnapshot): ParsedForum {
  const html = snapshot.html ?? "";
  const threadHrefs: Record<string, string> = {};
  const threads = new Map<string, ForumThreadSummary>();

  // Live ADAM (ILIAS 10) renders thread overview as UI Item listing, not the
  // legacy topic table. Item titles first so a visible UI thread cannot be
  // dropped as empty meta.
  mergeThread(threads, threadHrefs, threadsFromItemTitles(html));
  mergeThread(threads, threadHrefs, threadsFromLinks(snapshot.links ?? []));
  mergeThread(threads, threadHrefs, threadsFromHtmlLinks(html));
  mergeThread(threads, threadHrefs, threadsFromTableRows(html));

  return {
    threads: [...threads.values()],
    posts: postsFromHtml(html),
    threadHrefs,
  };
}

export function resolveForumThreadUrl(
  origin: string,
  forumRefId: string,
  threadId: string,
  href?: string,
): string {
  const base = origin.replace(/\/$/, "");
  if (href) {
    const decoded = decodeHref(href);
    try {
      const url = new URL(decoded, `${base}/`);
      if (url.protocol === "https:" && isThreadViewHref(url.toString()) && threadIdFromHref(url.toString()) === threadId) {
        return url.toString();
      }
    } catch {
      // Construct the viewThread URL instead of following a bad href.
    }
  }
  const params = new URLSearchParams({
    baseClass: "ilrepositorygui",
    cmdClass: "ilobjforumgui",
    cmd: "viewThread",
    ref_id: forumRefId,
    thr_pk: threadId,
  });
  return `${base}/ilias.php?${params.toString()}`;
}

export function pageHeading(html: string): string | undefined {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const title = cleanTitle(stripTags(match?.[1] ?? ""));
  return title || undefined;
}

export function threadIdFromHref(href: string): string | undefined {
  const decoded = decodeHref(href);
  const thr = decoded.match(/[?&#]thr_pk=(\d+)/i);
  if (thr) {
    return thr[1];
  }
  const gotoThr = decoded.match(/(?:[?&]target=|\/goto\.php\/)frm_\d+_(\d+)/i);
  if (gotoThr) {
    return gotoThr[1];
  }
  return undefined;
}

function isThreadViewHref(href: string): boolean {
  const decoded = decodeHref(href).toLowerCase();
  if (/cmd=showuser/.test(decoded)) {
    return false;
  }
  if (/cmd=(?:create|merge|move|delete|edit|print|mark|save|add|reply)/.test(decoded)) {
    return false;
  }
  if (
    /[?&#]thr_pk=\d+/.test(decoded) &&
    /(?:cmd=|cmd\[[^\]]*]=)(?:viewthread|showthread)(?:object)?\b/.test(decoded)
  ) {
    return true;
  }
  if (/(?:[?&]target=|\/goto\.php\/)frm_\d+_\d+/.test(decoded)) {
    return true;
  }
  return /[?&#]thr_pk=\d+/.test(decoded) && !/cmd=/.test(decoded);
}

/** ILIAS 10 showThreadsObject: panel listing of il-item / il-item-title links. */
function threadsFromItemTitles(html: string): Array<ForumThreadSummary & { href?: string }> {
  const found: Array<ForumThreadSummary & { href?: string }> = [];
  const titleBlocks = [
    ...extractClassBlocks(html, "il-item-title"),
    ...extractClassBlocks(html, "c-item__title"),
  ];
  for (const block of titleBlocks) {
    const href = block.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
    if (!href) {
      continue;
    }
    const title = cleanTitle(stripTags(block));
    const parsed = threadFromHref(href, title);
    if (parsed) {
      found.push(parsed);
    }
  }
  return found;
}

function threadsFromLinks(links: SnapshotLink[]): Array<ForumThreadSummary & { href?: string }> {
  const found: Array<ForumThreadSummary & { href?: string }> = [];
  for (const link of links) {
    if (link.inChrome || link.inBreadcrumb) {
      continue;
    }
    const parsed = threadFromHref(link.href, link.text);
    if (parsed) {
      found.push(parsed);
    }
  }
  return found;
}

function threadsFromHtmlLinks(html: string): Array<ForumThreadSummary & { href?: string }> {
  const found: Array<ForumThreadSummary & { href?: string }> = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const parsed = threadFromHref(match[1], stripTags(match[2]));
    if (parsed) {
      found.push(parsed);
    }
  }
  return found;
}

function threadFromHref(href: string, rawTitle: string): (ForumThreadSummary & { href?: string }) | undefined {
  if (!isThreadViewHref(href)) {
    return undefined;
  }
  const threadId = threadIdFromHref(href);
  if (!threadId) {
    return undefined;
  }
  const title = cleanTitle(rawTitle);
  if (!title || FORUM_COMMAND_LABEL.test(title) || /^\d+$/.test(title)) {
    return undefined;
  }
  return { threadId, title, href: decodeHref(href) };
}

function threadsFromTableRows(html: string): Array<ForumThreadSummary & { href?: string }> {
  const found: Array<ForumThreadSummary & { href?: string }> = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const threadId =
      row.match(/name=["'][^"']*thread_ids\[\][^"']*["'][^>]*value=["'](\d+)["']/i)?.[1] ??
      row.match(/value=["'](\d+)["'][^>]*name=["'][^"']*thread_ids\[\][^"']*["']/i)?.[1] ??
      threadIdFromHref(row.match(/href=["']([^"']+)["']/i)?.[1] ?? "") ??
      threadIdFromHref(row);
    if (!threadId) {
      continue;
    }
    const viewHref = [...row.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)]
      .map((anchor) => decodeHref(anchor[1]))
      .find((href) => isThreadViewHref(href) && threadIdFromHref(href) === threadId);
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    const viewTitle = viewHref
      ? cleanTitle(stripTags(row.match(new RegExp(`<a\\b[^>]*href=["'][^"']*thr_pk=${threadId}[^"']*["'][^>]*>([\\s\\S]*?)</a>`, "i"))?.[1] ?? ""))
      : undefined;
    const subject = firstSubjectFromCells(cells);
    const title = usableTitle(viewTitle) ?? subject;
    if (!title) {
      continue;
    }
    const author = authorFromRow(row);
    const postCount = postCountFromCells(cells);
    found.push({
      threadId,
      title,
      ...(author ? { author } : {}),
      ...(postCount !== undefined ? { postCount } : {}),
      ...(viewHref ? { href: viewHref } : {}),
    });
  }
  return found;
}

function firstSubjectFromCells(cells: string[]): string | undefined {
  for (const cell of cells) {
    if (/thread_ids\[\]/i.test(cell) || /<input\b/i.test(cell)) {
      continue;
    }
    const title = cleanTitle(stripTags(cell));
    if (!title || FORUM_COMMAND_LABEL.test(title) || /^\d+$/.test(title)) {
      continue;
    }
    // Author cells are typically a showUser link; skip those as titles.
    if (/cmd=showuser/i.test(cell) && !/cmd=viewthread|cmd=showthread/i.test(cell)) {
      continue;
    }
    return title;
  }
  return undefined;
}

function authorFromRow(row: string): string | undefined {
  const showUser = row.match(/<a\b[^>]*cmd=showUser[^>]*>([\s\S]*?)<\/a>/i);
  const text = cleanTitle(stripTags(showUser?.[1] ?? ""));
  return text && !FORUM_COMMAND_LABEL.test(text) ? text : undefined;
}

function postCountFromCells(cells: string[]): number | undefined {
  for (const cell of cells) {
    const text = cleanTitle(stripTags(cell));
    const hit = text.match(/^(\d+)(?:\s|$)/);
    if (hit && !/[./-]/.test(text)) {
      return Number.parseInt(hit[1], 10);
    }
  }
  return undefined;
}

function postsFromHtml(html: string): ForumPost[] {
  const posts: ForumPost[] = [];
  const seen = new Set<string>();
  for (const block of extractClassBlocks(html, "ilFrmPostRow")) {
    if (isDraftPostBlock(block)) {
      continue;
    }
    const post = postFromBlock(block);
    if (!post || seen.has(post.postId)) {
      continue;
    }
    seen.add(post.postId);
    posts.push(post);
  }
  if (posts.length > 0) {
    return posts;
  }
  for (const block of extractClassBlocks(html, "ilFrmPostContentContainer")) {
    const post = postFromBlock(block);
    if (!post || seen.has(post.postId)) {
      continue;
    }
    seen.add(post.postId);
    posts.push(post);
  }
  return posts;
}

function isDraftPostBlock(block: string): boolean {
  const status = extractClassBlocks(block, "ilFrmPostActivationStatus")
    .map((value) => cleanTitle(stripTags(value)))
    .join(" ");
  return /\bdraft\b/i.test(status);
}

function postFromBlock(block: string): ForumPost | undefined {
  const content = extractClassBlocks(block, "ilFrmPostContent")[0];
  if (content === undefined) {
    return undefined;
  }
  const body = cleanTitle(decodeEntities(stripTags(content)));
  if (!body) {
    return undefined;
  }
  const postId =
    block.match(/<a\b[^>]*id=["'](\d+)["']/i)?.[1] ??
    block.match(/[?&#]pos_pk=(\d+)/i)?.[1] ??
    block.match(/id=["'](?:frm_post_|post_)(\d+)["']/i)?.[1];
  if (!postId) {
    return undefined;
  }
  const subject = cleanTitle(stripTags(extractClassBlocks(block, "ilFrmPostTitle")[0] ?? "")) || undefined;
  const header = extractClassBlocks(block, "ilFrmPostHeader")[0] ?? "";
  const author = authorFromHeader(header);
  return {
    postId,
    body,
    ...(subject ? { subject } : {}),
    ...(author ? { author } : {}),
  };
}

function authorFromHeader(header: string): string | undefined {
  const beforePipe = cleanTitle(stripTags(header)).split("|")[0]?.trim();
  if (beforePipe && !FORUM_COMMAND_LABEL.test(beforePipe) && !/^\d+$/.test(beforePipe)) {
    return beforePipe;
  }
  return undefined;
}

function extractClassBlocks(html: string, className: string): string[] {
  const blocks: string[] = [];
  const open = new RegExp(
    `<(div|li|article|span|h2|h3|h4)\\b([^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*)>`,
    "gi",
  );
  for (const match of html.matchAll(open)) {
    const tag = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const inner = sliceUntilClose(html, start, tag);
    if (inner !== undefined) {
      blocks.push(inner);
    }
  }
  return blocks;
}

function sliceUntilClose(html: string, start: number, tag: string): string | undefined {
  const openRe = new RegExp(`<${tag}\\b`, "i");
  const closeRe = new RegExp(`</${tag}>`, "i");
  const closeLen = `</${tag}>`.length;
  let depth = 1;
  let cursor = start;
  while (cursor < html.length && depth > 0) {
    const rest = html.slice(cursor);
    const nextOpen = rest.search(openRe);
    const nextClose = rest.search(closeRe);
    if (nextClose < 0) {
      return undefined;
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      cursor += nextOpen + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return html.slice(start, cursor + nextClose);
    }
    cursor += nextClose + closeLen;
  }
  return undefined;
}

function mergeThread(
  threads: Map<string, ForumThreadSummary>,
  hrefs: Record<string, string>,
  incoming: Array<ForumThreadSummary & { href?: string }>,
): void {
  for (const item of incoming) {
    const { href, ...summary } = item;
    const existing = threads.get(summary.threadId);
    if (!existing) {
      threads.set(summary.threadId, summary);
    } else {
      threads.set(summary.threadId, {
        ...existing,
        title: preferTitle(existing.title, summary.title),
        author: existing.author ?? summary.author,
        postCount: existing.postCount ?? summary.postCount,
        createdAt: existing.createdAt ?? summary.createdAt,
        updatedAt: existing.updatedAt ?? summary.updatedAt,
      });
    }
    if (href && isThreadViewHref(href) && !hrefs[summary.threadId]) {
      hrefs[summary.threadId] = href;
    }
  }
}

function preferTitle(current: string, next: string): string {
  if (!usableTitle(current)) {
    return next;
  }
  if (!usableTitle(next)) {
    return current;
  }
  return next.length > current.length ? next : current;
}

function usableTitle(title: string | undefined): string | undefined {
  if (!title || FORUM_COMMAND_LABEL.test(title) || /^\d+$/.test(title)) {
    return undefined;
  }
  return title;
}

function decodeHref(href: string): string {
  return href.replace(/&amp;/gi, "&");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
