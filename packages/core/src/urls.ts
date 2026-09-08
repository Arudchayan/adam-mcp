import {
  ADAM_OBJECT_TYPES,
  DEFAULT_ADAM_ORIGIN,
  type AdamObjectType,
  type RefId,
} from "./types.ts";

const GO_PATH = /\/go\/([a-z0-9]+)\/(\d+)(?:\/|$)/i;
const REF_ID_QUERY = /[?&]ref_id=(\d+)/i;
const GOTO_ADAM = /goto_adam_([a-z]+)_(\d+)/i;
const GOTO_TARGET = /(?:[?&]target=|\/goto\.php\/)([a-z]+)_(\d+)/i;

const CMD_CLASS_TO_TYPE: Record<string, AdamObjectType> = {
  ilobjcategorygui: "cat",
  ilobjcoursegui: "crs",
  ilobjfoldergui: "fold",
  ilobjfilegui: "file",
  ilobjbloggui: "blog",
  ilobjrootfoldergui: "root",
  ilobjexercisegui: "exc",
  ilexercisehandlergui: "exc",
  ilobjtestgui: "tst",
  iltestplayergui: "tst",
  iltestoutputgui: "tst",
  ilobjforumgui: "frm",
  ilobjlinkresourcegui: "webr",
  ilobjweblinkgui: "webr",
};

export function isAdamObjectType(value: string): value is AdamObjectType {
  return (ADAM_OBJECT_TYPES as readonly string[]).includes(value);
}

export function objectTypeLabel(type: AdamObjectType): string {
  switch (type) {
    case "root":
      return "Repository root";
    case "cat":
      return "Category";
    case "crs":
      return "Course";
    case "fold":
      return "Folder";
    case "file":
      return "File";
    case "blog":
      return "Blog";
    case "webr":
      return "Web resource";
    case "frm":
      return "Forum";
    case "exc":
      return "Exercise";
    case "tst":
      return "Test";
    case "impr":
      return "Imprint";
    case "unknown":
      return "Unknown object";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function canonicalUrl(
  type: AdamObjectType,
  refId: RefId,
  origin: string = DEFAULT_ADAM_ORIGIN,
): string {
  const host = origin.replace(/\/$/, "");
  return `${host}/go/${type}/${refId}`;
}

export function parseAdamRef(input: string): { type: AdamObjectType; refId: RefId } | undefined {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return { type: "unknown", refId: trimmed };
  }

  try {
    const url = new URL(trimmed, DEFAULT_ADAM_ORIGIN);
    const goMatch = url.pathname.match(GO_PATH);
    if (goMatch) {
      return typedRef(goMatch[1], goMatch[2]);
    }

    const gotoFile = `${url.pathname}${url.search}`.match(GOTO_ADAM);
    if (gotoFile) {
      return typedRef(gotoFile[1], gotoFile[2]);
    }

    const target = `${url.pathname}${url.search}`.match(GOTO_TARGET);
    if (target) {
      return typedRef(target[1], target[2]);
    }

    const refMatch = url.search.match(REF_ID_QUERY);
    if (refMatch) {
      const refId = refMatch[1];
      const itemRef = url.searchParams.get("item_ref_id");
      const hasChild = itemRef && /^\d+$/.test(itemRef) && itemRef !== "0" && itemRef !== refId;
      if (hasChild) {
        // cmdClass describes the parent ref_id, not the child item_ref_id.
        // Child type is unknowable from this URL — unknown is the needs-resolve marker.
        return { type: "unknown", refId: itemRef };
      }
      const classes = url.searchParams.getAll("cmdClass").map((value) => value.toLowerCase());
      const mapped = [...classes].reverse().find((value) => CMD_CLASS_TO_TYPE[value]);
      return {
        type: (mapped ? CMD_CLASS_TO_TYPE[mapped] : undefined) ?? "unknown",
        refId,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function typedRef(typeToken: string, refId: string): { type: AdamObjectType; refId: RefId } {
  const normalized = typeToken.toLowerCase();
  return {
    type: isAdamObjectType(normalized) ? normalized : "unknown",
    refId,
  };
}

export function objectUrl(
  type: AdamObjectType,
  refId: RefId,
  origin: string = DEFAULT_ADAM_ORIGIN,
): string {
  if (type === "unknown") {
    return `${origin.replace(/\/$/, "")}/ilias.php?ref_id=${refId}`;
  }
  return canonicalUrl(type, refId, origin);
}

/** Object types that have registered MCP resource templates (A6/A1). */
export const RESOURCE_HANDLE_TYPES = ["crs", "fold", "file", "exc"] as const;
export type ResourceHandleType = (typeof RESOURCE_HANDLE_TYPES)[number];

export function isResourceHandleType(value: string): value is ResourceHandleType {
  return (RESOURCE_HANDLE_TYPES as readonly string[]).includes(value);
}

/**
 * MCP resource handle for hosts (not a browser URL).
 * Live citation remains {@link canonicalUrl}.
 */
export function resourceUri(type: AdamObjectType | string, refId: RefId): string | undefined {
  if (!isResourceHandleType(type)) {
    return undefined;
  }
  return `adam://${type}/${refId}`;
}
