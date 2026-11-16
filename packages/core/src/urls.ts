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
/** ILIAS 10 permalink without short URLs: /goto.php/{type}/{refId} (ADR 0057). */
const GOTO_PATH = /^\/goto\.php\/([a-z]+)\/(\d+)\/?$/i;

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
  // ADR 0049: read-only Survey and inline Poll identity. Never a write path.
  ilobjsurveygui: "svy",
  ilobjpollgui: "poll",
  // ADR 0057: ILIAS 10.12 GUI class names (components/ILIAS/*), read-only identity only.
  ilobjsessiongui: "sess",
  ilobjgroupgui: "grp",
  ilobjitemgroupgui: "itgr",
  ilobjlearningsequencegui: "lso",
  ilobjlearningsequencelearnergui: "lso",
  ilobjbookingpoolgui: "book",
  ilobjcontentpagegui: "copa",
  ilobjlearningmodulegui: "lm",
  illmpresentationgui: "lm",
  ilobjfilebasedlmgui: "htlm",
  ilhtlmpresentationgui: "htlm",
  ilobjwikigui: "wiki",
  ilwikihandlergui: "wiki",
  ilobjglossarygui: "glo",
  ilglossarypresentationgui: "glo",
  ilobjdatacollectiongui: "dcl",
  ilobjbibliographicgui: "bibl",
  ilobjmediacastgui: "mcst",
  ilmediacasthandlergui: "mcst",
};

/** baseClass values trusted to name the ref_id's own type (ADR 0049). */
const BASE_CLASS_TYPES = new Set(["ilobjsurveygui", "ilobjpollgui", "ilwikihandlergui", "ilmediacasthandlergui", "illmpresentationgui", "ilhtlmpresentationgui", "ilglossarypresentationgui"]);

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
    case "svy":
      return "Survey";
    case "poll":
      return "Poll";
    case "sess":
      return "Session";
    case "grp":
      return "Group";
    case "itgr":
      return "Item group";
    case "lso":
      return "Learning sequence";
    case "book":
      return "Booking pool";
    case "copa":
      return "Content page";
    case "lm":
      return "Learning module";
    case "htlm":
      return "HTML learning module";
    case "wiki":
      return "Wiki";
    case "glo":
      return "Glossary";
    case "dcl":
      return "Data collection";
    case "bibl":
      return "Bibliography";
    case "mcst":
      return "Mediacast";
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

const ADAM_HANDLE = /^adam:\/\/([a-z0-9]+)\/(\d+)\/?$/i;

/**
 * Parse digits, adam://{type}/{refId}, or pinned ADAM https URLs into {type, refId}.
 * Rejects titles, non-ADAM origins, and non-https browser URLs (no generic URL fetch).
 */
export function parseAdamRef(input: string): { type: AdamObjectType; refId: RefId } | undefined {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return { type: "unknown", refId: trimmed };
  }

  const handle = trimmed.match(ADAM_HANDLE);
  if (handle) {
    return typedRef(handle[1], handle[2]);
  }

  try {
    const looksAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
    const url = looksAbsolute ? new URL(trimmed) : new URL(trimmed, DEFAULT_ADAM_ORIGIN);
    if (url.protocol !== "https:" || url.hostname !== new URL(DEFAULT_ADAM_ORIGIN).hostname || url.username || url.password) {
      return undefined;
    }

    const goMatch = url.pathname.match(GO_PATH);
    if (goMatch) {
      return typedRef(goMatch[1], goMatch[2]);
    }

    const gotoPath = url.pathname.match(GOTO_PATH);
    if (gotoPath) {
      return typedRef(gotoPath[1], gotoPath[2]);
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
      // ADR 0049: ILIAS 10 Survey/Poll screens land on ilias.php?baseClass=ilObjSurveyGUI&ref_id=…
      // with no cmdClass. baseClass names the ref_id's own GUI, so it is a fallback only.
      const baseClasses = url.searchParams.getAll("baseClass").map((value) => value.toLowerCase());
      const mapped = [...classes].reverse().find((value) => CMD_CLASS_TO_TYPE[value]) ??
        baseClasses.find((value) => BASE_CLASS_TYPES.has(value));
      const directWebLink = url.origin === DEFAULT_ADAM_ORIGIN && !url.username && !url.password &&
        url.pathname === "/ilias.php" && classes.length === 0 && url.searchParams.getAll("ref_id").length === 1 &&
        url.searchParams.getAll("baseClass").length === 1 && url.searchParams.get("baseClass")?.toLowerCase() === "illinkresourcehandlergui" &&
        url.searchParams.getAll("cmd").length === 1 && url.searchParams.get("cmd") === "calldirectlink";
      return {
        type: (mapped ? CMD_CLASS_TO_TYPE[mapped] : undefined) ?? (directWebLink ? "webr" : "unknown"),
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
export const RESOURCE_HANDLE_TYPES = ["crs", "fold", "file", "exc", "frm"] as const;
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
