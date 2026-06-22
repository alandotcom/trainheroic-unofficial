import { coerceInt } from "@trainheroic-unofficial/js";
import type { BatchItem } from "drizzle-orm/batch";
import { type DrizzleDb, athleteSyncState, syncState } from "./schema";

// The bounded-concurrency fan-out helper lives in the SDK (one canonical copy, shared with the
// CLI export); re-exported here so the warehouse stores keep importing it from `./runner`.
export { mapPool } from "@trainheroic-unofficial/js";

/** A single write in a Drizzle batch (insert/update/delete builder), dialect-level. */
export type BatchStmt = BatchItem<"sqlite">;

/**
 * Run a set of statements as ONE atomic unit. The driver-specific seam: the D1 adapter maps this
 * to `db.batch([...])` (an implicit transaction the backend commits all-or-nothing); the
 * node:sqlite adapter wraps it in a `BEGIN`/`COMMIT`. Stores never call a driver-only batch method
 * directly — they go through this, `runGroups`, or `runBatches`, so the same store body works on
 * both adapters.
 */
export type BatchExec = (statements: readonly BatchStmt[]) => Promise<void>;

/** A Drizzle handle plus its atomic-batch executor — what a store is constructed from. */
export type Warehouse = { db: DrizzleDb; exec: BatchExec };

export type CursorUpsert = { cursor?: string | null; generation?: number | null };

/** Build a sync_state upsert. One home for the table's write shape (cursor + generation). */
export function cursorUpsertStmt(
  db: DrizzleDb,
  org: number,
  resource: string,
  scopeId: number,
  opts: CursorUpsert,
): BatchStmt {
  const cursor = opts.cursor ?? null;
  const generation = opts.generation ?? null;
  const syncedAt = Date.now();
  // On conflict, set the same values we just supplied (equivalent to the SQL's excluded.*).
  return db
    .insert(syncState)
    .values({ orgId: org, resource, scopeId, cursor, syncedAt, generation })
    .onConflictDoUpdate({
      target: [syncState.orgId, syncState.resource, syncState.scopeId],
      set: { cursor, syncedAt, generation },
    });
}

/** Build an athlete_sync_state upsert (the athlete-warehouse watermark, keyed by user_id). */
export function athleteCursorUpsertStmt(
  db: DrizzleDb,
  userId: number,
  resource: string,
  scopeId: number,
  cursor: string | null = null,
): BatchStmt {
  const syncedAt = Date.now();
  return db
    .insert(athleteSyncState)
    .values({ userId, resource, scopeId, cursor, syncedAt })
    .onConflictDoUpdate({
      target: [athleteSyncState.userId, athleteSyncState.resource, athleteSyncState.scopeId],
      set: { cursor, syncedAt },
    });
}

/**
 * Run statements in ordered chunks, each chunk committed atomically via `exec`.
 * Sequential so order holds and the per-invocation query limit is respected. Use for
 * statements with no cross-statement atomicity requirement (idempotent upserts).
 */
export async function runBatches(
  exec: BatchExec,
  statements: readonly BatchStmt[],
  chunkSize = 100,
): Promise<void> {
  await runGroups(
    exec,
    statements.map((s) => [s]),
    chunkSize,
  );
}

/**
 * Run statement GROUPS where each group must commit atomically together (e.g. a
 * delete-then-reinsert). Groups are packed into chunks without ever splitting a
 * group across a chunk boundary, so a failure can never half-apply a group. A single
 * group larger than chunkSize is run as its own chunk (atomicity wins over the cap).
 */
export async function runGroups(
  exec: BatchExec,
  groups: ReadonlyArray<readonly BatchStmt[]>,
  chunkSize = 100,
): Promise<void> {
  const batches: BatchStmt[][] = [];
  let current: BatchStmt[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (current.length > 0 && current.length + group.length > chunkSize) {
      batches.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) batches.push(current);
  for (const batch of batches) await exec(batch);
}

/**
 * Resolve the coach's org_id (the tenant key) via /user/simple. Throws when it cannot be
 * determined — a failed lookup must never silently become a real-looking id (0), or two
 * tenants would collapse onto one shared partition. The caller must not cache a thrown
 * result, so a transient failure is retried on the next call.
 */
export async function resolveOrgId(
  request: (method: string, path: string) => Promise<{ ok: boolean; data: unknown }>,
): Promise<number> {
  const res = await request("GET", "/user/simple");
  if (!res.ok || typeof res.data !== "object" || res.data === null) {
    throw new Error("Could not resolve TrainHeroic org: /user/simple did not return a profile.");
  }
  const org = coerceInt((res.data as Record<string, unknown>).org_id);
  if (org === null || org <= 0) {
    throw new Error("Could not resolve TrainHeroic org_id from /user/simple.");
  }
  return org;
}
