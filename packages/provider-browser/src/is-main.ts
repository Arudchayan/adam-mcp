import { basename } from "node:path";

export function isNamedCliEntry(stem: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return new RegExp(`^${stem}\\.(cjs|mjs|js|ts)$`, "i").test(basename(entry));
}
