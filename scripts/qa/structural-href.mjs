/** Return only fixed structural labels/booleans, never arbitrary URL values. */
export function structuralHref(href, base) {
  try {
    const url = new URL(href, base);
    if (url.origin !== "https://adam.unibas.ch") return { externalDestination: true };
    return {
      externalDestination: false,
      pathKind: url.pathname === "/ilias.php" ? "ilias.php" : /^\/go\/(?:webr|crs|fold|file)\/\d+$/.test(url.pathname) ? "typed-object" : "other-omitted",
      hasRefId: url.searchParams.has("ref_id"),
      hasItemRefId: url.searchParams.has("item_ref_id"),
      hasCommandClass: url.searchParams.has("cmdClass"),
      hasBaseClass: url.searchParams.has("baseClass"),
    };
  } catch { return { malformedHref: true }; }
}
