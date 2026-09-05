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

export function minNavigationGapMs(): number {
  const raw = Number(process.env.ADAM_NAV_GAP_MS);
  if (Number.isFinite(raw) && raw >= 250) {
    return raw;
  }
  return 1_000;
}

export function maxNavigationsPerMinute(): number {
  const raw = Number(process.env.ADAM_NAV_PER_MINUTE);
  if (Number.isFinite(raw) && raw >= 1) {
    return raw;
  }
  return 20;
}
