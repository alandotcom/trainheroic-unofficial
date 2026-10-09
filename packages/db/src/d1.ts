// The Cloudflare D1 adapter entry. Builds a {@link Warehouse} over a D1 binding and maps the
// atomic-batch seam to D1's native `db.batch([...])`. This is the only place the package touches
// `drizzle-orm/d1`; the worker imports this entry, never the `./sqlite` one. Sentry never enters
// the package: the worker passes the D1 binding from the env that Sentry's `withSentry` wraps, so
// the binding arrives already instrumented and queries emit spans without a workerd dependency
// leaking into the shared core.
import { type AnyD1Database, drizzle } from "drizzle-orm/d1";
import type { DrizzleDb } from "./schema";
import type { BatchExec, BatchStmt, Warehouse } from "./runner";

/**
 * Wrap a D1 binding in a {@link Warehouse}. This is the single chokepoint for D1 access.
 */
export function makeD1Warehouse(d1: AnyD1Database): Warehouse {
  const db = drizzle(d1) as unknown as DrizzleDb;
  // D1's batch() commits a group as one implicit, all-or-nothing transaction. runGroups never
  // passes an empty chunk, but the guard makes that contract explicit (matching the sqlite adapter).
  const batch = (db as unknown as { batch: (s: readonly BatchStmt[]) => Promise<unknown[]> }).batch;
  const exec: BatchExec = async (statements: readonly BatchStmt[]) => {
    if (statements.length === 0) return [];
    return batch.call(db, statements);
  };
  return { db, exec };
}
