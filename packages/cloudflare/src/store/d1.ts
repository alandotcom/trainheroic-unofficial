import { coerceInt } from "@trainheroic-unofficial/js";
import type { BatchItem } from "drizzle-orm/batch";
import { type DrizzleDb, athleteSyncState, syncState } from "./schema";

// The bounded-concurrency fan-out helper lives in the SDK (one canonical copy, shared with the
// CLI export); re-exported here so the warehouse stores keep importing it from `./d1`.
export { mapPool } from "@trainheroic-unofficial/js";

/** A single write in a Drizzle/D1 batch (insert/update/delete builder). */
export type BatchStmt = BatchItem<"sqlite">;

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
 * Run statements in ordered chunks, each chunk as one atomic D1 batch.
 * Sequential so order holds and the per-invocation query limit is respected. Use for
 * statements with no cross-statement atomicity requirement (idempotent upserts).
 */
export async function runBatches(
  db: DrizzleDb,
  statements: readonly BatchStmt[],
  chunkSize = 100,
): Promise<void> {
  await runGroups(
    db,
    statements.map((s) => [s]),
    chunkSize,
  );
}

/**
 * Run statement GROUPS where each group must commit atomically together (e.g. a
 * delete-then-reinsert). Groups are packed into batches without ever splitting a
 * group across a batch boundary, so a failure can never half-apply a group. A single
 * group larger than chunkSize is run as its own batch (atomicity wins over the cap).
 */
export async function runGroups(
  db: DrizzleDb,
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
  for (const batch of batches) {
    // Only non-empty groups are pushed, so head is always present; destructuring into a
    // [head, ...tail] literal gives D1's batch() the non-empty tuple type it requires.
    const [head, ...tail] = batch;
    if (head) await db.batch([head, ...tail]);
  }
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
