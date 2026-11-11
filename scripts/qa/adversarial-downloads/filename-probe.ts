import { readdir } from "node:fs/promises";
import { safeDownloadFilename, saveLocalDownload } from "../../../packages/provider-browser/src/local-download.ts";
import { file, session, temporary } from "./support.ts";

// Link-only publication, never open/read console devices. Every candidate stays in our synthetic temp directory.
await temporary(async (directory) => {
  for (const candidate of ["CONIN$", "CONOUT$", "CON .txt", "LPT1 .pdf", "AUX .bin", "COM1 .bin"]) {
    try {
      const result = await saveLocalDownload(session(async () => new Response("synthetic bytes")), { ...file, title: candidate }, directory);
      console.log(JSON.stringify({ candidate, sanitized: safeDownloadFilename(candidate, file.refId), result: "success", path: result.path, entries: await readdir(directory) }));
    } catch (error) {
      console.log(JSON.stringify({ candidate, sanitized: safeDownloadFilename(candidate, file.refId), result: "failure", code: (error as NodeJS.ErrnoException).code, message: (error as Error).message, entries: await readdir(directory) }));
    }
  }
});
