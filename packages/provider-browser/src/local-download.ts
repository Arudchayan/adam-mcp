import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, realpath, stat, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, extname, join, parse } from "node:path";
import { AdamError, looksLikeHtml, throwIfCancelled, type FileObject } from "adam-core";
import type { AdamBrowserSession, AuthorizedProbeResult } from "./session-types.ts";
import { filenameFromContentDisposition } from "./download-metadata.ts";

export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 120_000;

export type LocalDownload = { path: string; url: string; refId: string; sizeBytes: number; sha256: string };

/** A server-provided filename is data, never a path or shell command. */
export function safeDownloadFilename(candidate: string, refId: string): string {
  let name = basename(candidate.replaceAll("\\", "/")).normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/[. ]+$/g, "").replace(/^[. ]+/g, "");
  if (!name) name = `file-${refId}`;
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)) name = `_${name}`;
  // Bound UTF-8 bytes as well as character count for portable filesystem limits.
  const extension = extname(name).slice(0, 20);
  let stem = "", used = Buffer.byteLength(extension);
  for (const character of name.slice(0, name.length - extname(name).length)) {
    const length = Buffer.byteLength(character);
    if (used + length > 180) break;
    stem += character; used += length;
  }
  return stem + extension;
}

/** Explicit existing destination; course files never belong in a Git checkout. */
export async function downloadDirectory(directory: string): Promise<string> {
  const resolved = await realpath(directory);
  if (!(await stat(resolved)).isDirectory()) throw new AdamError("unsupported_type", "Download destination must be an existing directory.", false);
  for (let parent = resolved; ; parent = dirname(parent)) {
    try {
      await lstat(join(parent, ".git"));
      throw new AdamError("forbidden", "Choose a download directory outside a Git checkout. Course files must not enter source control.", false);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (parent === parse(parent).root) break;
  }
  return resolved;
}

/** Save one selected file; stream bytes to a private temporary file, never to MCP. */
export async function saveLocalDownload(
  session: AdamBrowserSession,
  file: FileObject,
  directory: string,
  signal?: AbortSignal,
): Promise<LocalDownload> {
  throwIfCancelled(signal);
  const destination = await downloadDirectory(directory);
  if (!session.streamAuthorized) throw new AdamError("provider_unavailable", "This session does not support local streaming downloads.", false);
  const temporary = join(destination, `.adam-download-${randomUUID()}.part`);
  let handle: FileHandle | undefined;
  let created = false;
  let metadata: AuthorizedProbeResult = {};
  let prefix = Buffer.alloc(0);
  let sizeBytes = 0;
  const hash = createHash("sha256");
  try {
    handle = await open(temporary, "wx", 0o600);
    created = true;
    const sink = handle;
    const url = `https://adam.unibas.ch/goto_adam_file_${file.refId}_download.html`;
    await session.streamAuthorized(url, {
      signal, maxBytes: MAX_DOWNLOAD_BYTES, timeoutMs: DOWNLOAD_TIMEOUT_MS,
      onHeaders: async (headers) => {
        metadata = headers;
        if (/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(headers.contentType ?? "")) {
          throw new AdamError("unsupported_type", "ADAM returned an HTML page. Recheck your session and selected file.", false);
        }
      },
      onChunk: async (chunk) => {
        throwIfCancelled(signal);
        if (chunk.byteLength > MAX_DOWNLOAD_BYTES - sizeBytes) throw new AdamError("provider_unavailable", "Download exceeds the 256 MiB limit.", false);
        if (prefix.length < 1024) {
          prefix = Buffer.concat([prefix, chunk.subarray(0, 1024 - prefix.length)]);
          if (looksLikeHtml(prefix, metadata.contentType)) throw new AdamError("unsupported_type", "ADAM returned a web page instead of the selected file.", false);
        }
        // FileHandle.write can write less than the supplied chunk.
        let offset = 0;
        while (offset < chunk.byteLength) {
          throwIfCancelled(signal);
          const { bytesWritten } = await sink.write(chunk, offset, chunk.byteLength - offset);
          if (!bytesWritten) throw new Error("File write made no progress");
          offset += bytesWritten;
        }
        hash.update(chunk);
        sizeBytes += chunk.byteLength;
      },
    });
    throwIfCancelled(signal);
    if (!sizeBytes) throw new AdamError("unsupported_type", "ADAM returned an empty file; no download was saved.", false);
    await handle.sync();
    await handle.close(); handle = undefined;
    const name = safeDownloadFilename(filenameFromContentDisposition(metadata.contentDisposition) ?? file.title, file.refId);
    const extension = extname(name);
    const stem = name.slice(0, name.length - extension.length);
    for (let duplicate = 0; duplicate < 1000; duplicate++) {
      throwIfCancelled(signal);
      const path = join(destination, duplicate ? `${stem} (${duplicate})${extension}` : name);
      try {
        // An exclusive hard link atomically exposes the complete file, never replacing a target.
        await link(temporary, path);
        return { path, url: file.url, refId: file.refId, sizeBytes, sha256: hash.digest("hex") };
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
    }
    throw new AdamError("provider_unavailable", "Too many duplicate filenames. Choose another download directory.", false);
  } finally {
    try { await handle?.close(); } finally {
      if (created) await unlink(temporary).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      });
    }
  }
}
