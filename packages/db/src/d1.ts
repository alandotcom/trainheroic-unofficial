// The Cloudflare D1 adapter entry. Builds a {@link Warehouse} over a D1 binding and maps the
// atomic-batch seam to D1's native `db.batch([...])`. This is the only place the package touches
// `drizzle-orm/d1`; the worker imports this entry, never the `./sqlite` one. Sentry never enters
// the package — the worker injects `Sentry.instrumentD1WithSentry` through the `instrument` hook,
// keeping D1 query spans wired without a workerd dependency leaking into the shared core.
import { type AnyD1Database, drizzle } from "drizzle-orm/d1";
import { type DrizzleDb, schema } from "./schema";
import type { BatchExec, BatchStmt, Warehouse } from "./runner";

/**
 * Wrap a raw D1 binding in a {@link Warehouse}. `instrument` (default identity) is applied to the
 * binding before Drizzle wraps it — the worker passes `Sentry.instrumentD1WithSentry`, so every
 * query Drizzle issues emits a `db.query` span. This is the single chokepoint for D1 access.
 *
 * Generic over the binding type so the `instrument` hook's parameter follows the caller's binding
 * (e.g. the worker's real `D1Database`), letting a hook like `instrumentD1WithSentry` match without
 * a variance clash.
 */
export function makeD1Warehouse<T extends AnyD1Database>(
  d1: T,
  opts: { instrument?: (d1: T) => T } = {},
): Warehouse {
  const instrument = opts.instrument ?? ((x: T) => x);
  const db = drizzle(instrument(d1), { schema }) as unknown as DrizzleDb;
  // D1's batch() commits a group as one implicit, all-or-nothing transaction. runGroups never
  // passes an empty chunk, but the guard makes that contract explicit (matching the sqlite adapter).
  const batch = (db as unknown as { batch: (s: readonly BatchStmt[]) => Promise<unknown> }).batch;
  const exec: BatchExec = async (statements: readonly BatchStmt[]) => {
    if (statements.length === 0) return;
    await batch.call(db, statements);
  };
  return { db, exec };
}
