import { AdamError } from "./errors.ts";

export class ObjectReadPolicy {
  static readonly DENIED_TYPES = ["tst"] as const;

  static isDenied(type: string): type is DeniedObjectType {
    return (ObjectReadPolicy.DENIED_TYPES as readonly string[]).includes(type);
  }

  static assertReadable(type: string, refId?: string): void {
    if (!ObjectReadPolicy.isDenied(type)) {
      return;
    }
    const target = refId ? ` (${refId})` : "";
    throw new AdamError(
      "unsupported_type",
      `ADAM object type "${type}"${target} is blocked. Tests and exams are not sent to the model.`,
    );
  }
}

export const DENIED_OBJECT_TYPES = ObjectReadPolicy.DENIED_TYPES;

export type DeniedObjectType = (typeof ObjectReadPolicy.DENIED_TYPES)[number];

export function isDeniedObjectType(type: string): type is DeniedObjectType {
  return ObjectReadPolicy.isDenied(type);
}

export function assertReadableObjectType(type: string, refId?: string): void {
  ObjectReadPolicy.assertReadable(type, refId);
}
