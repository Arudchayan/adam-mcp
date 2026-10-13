import { randomBytes } from "node:crypto";
import { AdamError, normalizeLimit, type ListOptions, type Paginated } from "adam-core";

type Snapshot = { key: string; items: unknown[]; metadata: object; createdAt: number; offset: number };

/** Decimal cursor tokens bind continuation pages to an immutable result snapshot. */
export class SnapshotPagination {
  private readonly cursors = new Map<string, Snapshot>();
  constructor(private readonly clock: () => number = Date.now) {}

  clear(): void { this.cursors.clear(); }

  continue<T>(key: string, options?: ListOptions): Paginated<T> | undefined {
    if (options?.refresh && options.cursor !== undefined) throw new AdamError("stale_id", "Refresh starts a new listing. Omit cursor.", false);
    if (options?.cursor === undefined) return undefined;
    this.prune();
    const snapshot = this.cursors.get(options.cursor);
    if (!snapshot || snapshot.key !== key) {
      throw new AdamError("stale_id", "Listing cursor expired or belongs to another query. Restart the listing without cursor.", false);
    }
    return this.slice<T>(snapshot, options);
  }

  first<T>(key: string, items: T[], options?: ListOptions, metadata: object = {}): Paginated<T> {
    this.prune();
    return this.slice<T>({ key, items: [...items], metadata, createdAt: this.clock(), offset: 0 }, options);
  }

  private slice<T>(snapshot: Snapshot, options?: ListOptions): Paginated<T> {
    const items = snapshot.items.slice(snapshot.offset, snapshot.offset + normalizeLimit(options?.limit)) as T[];
    const offset = snapshot.offset + items.length;
    let nextCursor: string | undefined;
    if (offset < snapshot.items.length) {
      nextCursor = randomBytes(12).readBigUInt64BE().toString();
      this.cursors.set(nextCursor, { ...snapshot, offset });
      while (this.cursors.size > 256) this.cursors.delete(this.cursors.keys().next().value!);
    }
    return { ...snapshot.metadata, snapshotAt: new Date(snapshot.createdAt).toISOString(), items, totalHint: snapshot.items.length, nextCursor };
  }

  private prune(): void {
    for (const [cursor, snapshot] of this.cursors) {
      if (this.clock() - snapshot.createdAt >= 10 * 60_000) this.cursors.delete(cursor);
    }
  }
}
