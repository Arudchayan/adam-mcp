import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(metaUrl).toLowerCase() === resolve(entry).toLowerCase();
}
