import { AdamError } from "./errors.ts";
import type { AdamObjectType } from "./types.ts";

export const DENIED_OBJECT_TYPES = ["tst"] as const;

export type DeniedObjectType = (typeof DENIED_OBJECT_TYPES)[number];

export function isDeniedObjectType(type: string): type is DeniedObjectType {
  return (DENIED_OBJECT_TYPES as readonly string[]).includes(type);
}

export function assertReadableObjectType(type: string, refId?: string): void {
  if (!isDeniedObjectType(type)) {
    return;
  }
  const target = refId ? ` (${refId})` : "";
  throw new AdamError(
    "unsupported_type",
    `ADAM object type "${type}"${target} is blocked. Tests and exams are not sent to the model.`,
  );
}
