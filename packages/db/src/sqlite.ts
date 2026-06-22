// The local node:sqlite adapter entry. Builds a {@link Warehouse} over Node's built-in
// `node:sqlite` (Node >= 24, no native dependency) and maps the atomic-batch seam to a
// `BEGIN`/`COMMIT` bracket — Drizzle's `db.batch()` exists only on D1/LibSQL/Neon, so the same
// store code commits a group through an explicit transaction here instead. Only this entry imports
// `node:sqlite` / `drizzle-orm/node-sqlite` and the embedded migrations, so the worker (which
// imports only the neutral core and `./d1`) never drags them into its bundle.
import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { type DrizzleDb, schema } from "./schema";
import { MIGRATIONS, type Migration } from "./migrations";
import type { BatchExec, BatchStmt, Warehouse } from "./runner";

export { MIGRATIONS, type Migration } from "./migrations";

/**
 * Wrap an open `node:sqlite` connection in a {@link Warehouse}. The executor runs a statement
 * group inside one `BEGIN`/`COMMIT` on the same connection (rolling back on error), giving the
 * same all-or-nothing commit the D1 adapter gets from `db.batch()`.
 */
export function makeSqliteWarehouse(sqlite: DatabaseSync): Warehouse {
  const db = drizzle({ client: sqlite, schema }) as unknown as DrizzleDb;
  const exec: BatchExec = async (statements: readonly BatchStmt[]) => {
    if (statements.length === 0) return;
    sqlite.exec("BEGIN");
    try {
      for (const s of statements) await s;
      sqlite.exec("COMMIT");
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
  };
  return { db, exec };
}

/**
 * Bring a local SQLite database up to the current schema by applying every migration that has not
 * run yet, in order, each in its own transaction. Applied names are tracked in a `_migrations`
 * table (the local counterpart to wrangler's `d1_migrations`), so re-running is a no-op and a tool
 * that updates to a newer version of this package — carrying new entries in {@link MIGRATIONS} —
 * picks up the pending ones on the next call. Returns the names applied this run.
 */
export function applyMigrations(
  sqlite: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
): { applied: string[] } {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const done = new Set(
    (sqlite.prepare("SELECT name FROM _migrations").all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );
  const record = sqlite.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");
  const applied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.name)) continue;
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(migration.sql);
      record.run(migration.name, Date.now());
      sqlite.exec("COMMIT");
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw err;
    }
    applied.push(migration.name);
  }
  return { applied };
}
