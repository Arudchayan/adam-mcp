# ADR 0057: ILIAS 10.12 containers, scheduling and content-module types

## Status

Accepted. The identity evidence comes from the local ILIAS 10.12 lab (`tools/ilias-lab`): the "Lab Course" seeded with one object of each type, viewed as the lab student. The GUI class names come from the ILIAS `v10.12` source (`components/ILIAS/*`). On ADAM, these types were not visible in the maintainer's enrolled courses. ADAM's own permalinks use `/go/{type}/{refId}` (live captures), and those now type directly.

## Context

Issues #130 (containers and scheduling) and #131 (content modules) report that listings show sessions, groups, item groups, learning sequences, booking pools, content pages, learning modules (ILIAS and HTML), wikis, glossaries, data collections, bibliographies and mediacasts as `unknown`. That loses the type, the `/go/` citation, and the walk into groups.

Lab evidence (ILIAS 10.12, student view of a course):

- Most rows link a typed permalink. ILIAS without short URLs renders `goto.php/{type}/{refId}` (book, copa, exc, fold, frm, glo, lm, lso); ADAM renders `/go/{type}/{refId}`.
- Some rows link a type-less `ilias.php?baseClass=ilrepositorygui&cmd=infoScreen|render|preview&ref_id=…`, for example sessions. Wiki uses `baseClass=ilWikiHandlerGUI&ref_id=…`, and Mediacast uses `baseClass=ilmediacasthandlergui&cmdClass=ilObjMediaCastGUI`.
- Every row is `div.ilContainerListItemOuter#lg_div_{refId}_pref_{parentRef}` with a standard icon `assets/images/standard/icon_{type}.svg`. The `li#item_row_{block}-{refId}` id names the *block* (`sess` in a by-type view, `_other` on ADAM), not the type, so it is not used.
- An object without content (an empty HTML learning module, or a web link without a URL) renders its title without a link. It is not listed, because there is nothing to cite or open.

## Decision

- **Types.** `sess, grp, itgr, lso, book, copa, lm, htlm, wiki, glo, dcl, bibl, mcst` join `ADAM_OBJECT_TYPES`. They are valid `type` hints and cite as `/go/{type}/{refId}`.
- **URL parsing.** `goto.php/{type}/{refId}` is parsed like `/go/`. Origin pinning is unchanged.
- **GUI classes.** The ILIAS 10.12 `ilObj*GUI` class names map to these types, as `cmdClass`. The handler and presentation base classes are trusted only as a `baseClass` fallback, as in ADR 0049: `ilWikiHandlerGUI`, `ilMediaCastHandlerGUI`, `ilLMPresentationGUI`, `ilHTLMPresentationGUI` and `ilGlossaryPresentationGUI`. Generic `ilRepositoryGUI` still means `unknown`.
- **Row icon fallback.** A listed object whose link is type-less takes the type of its row's standard `icon_{type}.svg` when that type is known. Custom uploaded icons give no hint. A `tst` icon types the row `tst`, so the deny policy drops it, which is stricter than before.
- **Walk.** `grp` is a listing container like `crs` and `fold`. `adam_list_children`, search and discovery descend into it. Sessions, item groups and the content modules are leaves: listed and cited, readable with the existing confirm-gated `adam_read_page` (visible text only), and never walked.
- **Read-only.** No booking, sign-up, learning-sequence progress, wiki edit, glossary edit or data-collection entry is added. `tst` stays denied.
- **Parity.** The fixture adds a labelled synthetic `grp` `100140` under course `100101`, containing `sess` `100141` and `wiki` `100142`.

## Out of scope

- Deeper per-type readers: session dates and attached materials, learning-module tables of contents and per-page reads, wiki page lists, glossary terms, data-collection tables, mediacast items. Each needs its own evidence pass and ADR.
- Opencast and Etherpad: these are UniBasel plugins, not in the ILIAS source, so they need ADAM evidence.
- Item-group bodies. ILIAS renders item-group members inline in the parent listing, so they are already listed there.

## Consequences

- Listings and citations stop saying `unknown` for these types, and groups become browsable.
- The new class mappings are from the ILIAS source rather than ADAM captures. If ADAM's markup differs, an object falls back to `unknown`, the status before this ADR.
