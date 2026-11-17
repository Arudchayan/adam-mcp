import type { AdamObjectType, ObjectDetail, RefId } from "adam-core";
import type { RouteRule } from "../advertised-route.ts";
import { readBibliography } from "./bibl.ts";
import { readDataCollection } from "./dcl.ts";
import { readMediacast } from "./mcst.ts";
import { readContentPage } from "./copa.ts";
import { readHtmlModule } from "./htlm.ts";
import { readLearningModule } from "./lm.ts";

/**
 * ADR 0062: typed readers for ILIAS 10.12 object pages, registered per object type.
 *
 * A reader receives the object's already-opened page and may open further pages, but
 * only routes the page advertises (`ctx.route` / `ctx.routes`, see advertised-route.ts),
 * and at most `MAX_READER_PAGES` of them. It returns a typed `detail`, and for a
 * `subPage` request the selected sub-page text. It returns `undefined` when it does not
 * recognise the markup; the caller then keeps plain page text and reports
 * `detailStatus: "unrecognised"`. Readers never submit forms and never follow write routes.
 */
export const MAX_READER_PAGES = 12;

export type ReaderPage = { url: string; html: string; text: string };

export type ReaderContext = {
  refId: RefId;
  type: AdamObjectType;
  /** The object's own page, as already opened by readPage. */
  page: ReaderPage;
  /** Opaque sub-page id from an earlier `detail` (for example a wiki page or LM chapter), when the caller asked for one. */
  subPage?: string;
  /** Opens one advertised route (an absolute ADAM URL returned by `route`/`routes`). Counts against MAX_READER_PAGES. */
  open(url: string): Promise<ReaderPage>;
  /** First route in `html` satisfying `rule` for this object's ref_id. */
  route(html: string, rule: RouteRule): string | undefined;
  /** All routes in `html` satisfying `rule` for this object's ref_id. */
  routes(html: string, rule: RouteRule): string[];
};

export type ReaderResult = {
  detail: ObjectDetail;
  /** Replaces the page text when a sub-page was read (subject to the same untrusted wrapping and caps). */
  text?: string;
};

export type ObjectReader = (ctx: ReaderContext) => Promise<ReaderResult | undefined>;

/**
 * Registry. Each workstream adds exactly one line here, importing its reader from its own
 * file in this folder (for example `import { readSession } from "./sess.ts";`).
 */
export const OBJECT_READERS: Partial<Record<AdamObjectType, ObjectReader>> = {
  bibl: readBibliography,
  dcl: readDataCollection,
  mcst: readMediacast,
  lm: readLearningModule,
  htlm: readHtmlModule,
  copa: readContentPage,
};
