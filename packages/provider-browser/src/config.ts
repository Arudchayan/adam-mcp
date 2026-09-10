import { homedir } from "node:os";
import { join } from "node:path";
import { resolveAdamOrigin } from "adam-core";

export function defaultProfileDir(): string {
  return process.env.ADAM_BROWSER_PROFILE_DIR?.trim() || join(homedir(), ".adam-mcp", "chrome-profile");
}

export function defaultOrigin(): string {
  return resolveAdamOrigin();
}

export function headedByDefault(): boolean {
  const raw = process.env.ADAM_BROWSER_HEADED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") {
    return false;
  }
  return true;
}

/**
 * Opt-in redacted debug capture for live listing troubleshooting.
 * Writes to `ADAM_DEBUG_CAPTURE_DIR` (default `./scratch`), never to git.
 */
export function debugCaptureEnabled(): boolean {
  const raw = process.env.ADAM_DEBUG_CAPTURE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function debugCaptureDir(): string {
  return process.env.ADAM_DEBUG_CAPTURE_DIR?.trim() || join(process.cwd(), "scratch");
}
