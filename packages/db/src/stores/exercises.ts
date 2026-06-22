import { and, eq, like, lt, sql } from "drizzle-orm";
import { OrgScopedStore } from "../base";
import { type BatchStmt, cursorUpsertStmt } from "../runner";
import { exercise, syncMeta, syncState } from "../schema";
import {
  asExerciseList,
  buildSearchText,
  checkResponse,
  chunk,
  coerceInt,
  type ExerciseIndex,
  exerciseLibraryResponseSchema,
  exerciseResponseSchema,
  type ExerciseView,
  presentExercise,
  rankSearch,
  type ResolveResult,
  unwrapEnvelope,
  withUnits,
} from "@trainheroic-unofficial/js";

const LIBRARY_PATH = "/v5/exerciseLibrary/all";
const CREATE_PATH = "/2.0/coach/exercise/create";
const TTL_MS = 7 * 24 * 3600 * 1000;
// After confirming freshness, trust it for this long instead of re-querying on every
// read (the DO instance is long-lived, so a workout build resolving many exercises would
// otherwise pay a COUNT + meta read per exercise).
const FRESH_CHECK_MS = 60 * 1000;
const PRUNE_FLOOR = 100;
// 12 columns per row; keep rows-per-statement under D1's 100 bound-param limit.
const UPSERT_CHUNK = 8;
// How many LIKE matches to pull before app-side ranking decides the final order.
const SEARCH_CANDIDATES = 200;

// The reads that feed the SDK's ExerciseRow shape: snake_case keys, matching the legacy SQL
// projection so rankSearch/withUnits keep their input contract.
const exerciseRowCols = {
  id: exercise.id,
  title: exercise.title,
  param_1_type: exercise.param1Type,
  param_2_type: exercise.param2Type,
  can_edit: exercise.canEdit,
  user_id: exercise.userId,
  use_count: exercise.useCount,
};

/** Warehouse-backed mirror of the TrainHeroic exercise library (reference zone). */
export class ExerciseStore extends OrgScopedStore implements ExerciseIndex {
  #freshCheckedAt = 0;

  // -- meta / watermarks ---------------------------------------------------

  async #meta(org: number, key: string): Promise<string | null> {
    const row = await this.db
      .select({ value: syncMeta.value })
      .from(syncMeta)
      .where(and(eq(syncMeta.orgId, org), eq(syncMeta.key, key)))
      .get();
    return row?.value ?? null;
  }

  #setMetaStmt(org: number, key: string, value: string): BatchStmt {
    return this.db
      .insert(syncMeta)
      .values({ orgId: org, key, value })
      .onConflictDoUpdate({ target: [syncMeta.orgId, syncMeta.key], set: { value } });
  }

  #setCursorStmt(org: number, resource: string, scopeId: number, generation: number): BatchStmt {
    return cursorUpsertStmt(this.db, org, resource, scopeId, { generation });
  }

  async #count(org: number): Promise<number> {
    return this.db.$count(exercise, eq(exercise.orgId, org));
  }

  // -- sync ----------------------------------------------------------------

  async ensureFresh(): Promise<void> {
    if (this.#freshCheckedAt > 0 && Date.now() - this.#freshCheckedAt < FRESH_CHECK_MS) return;
    const org = await this.org();
    // last_full_sync is written only after a successful refresh (the empty-list guard
    // throws first), so null means "never synced" — no separate COUNT(*) is needed here.
    const last = await this.#meta(org, "last_full_sync");
    if (last === null || Date.now() - Number(last) > TTL_MS) {
      await this.refresh();
    }
    this.#freshCheckedAt = Date.now();
  }

  async refresh(): Promise<{ synced: number; pruned: number; generation: number }> {
    const org = await this.org();
    const res = await this.client.request("GET", LIBRARY_PATH);
    if (!res.ok) throw new Error(`Exercise library fetch failed (HTTP ${res.status}).`);

    const list = asExerciseList(res.data).filter((ex) => coerceInt(ex.id) !== null);
    if (list.length === 0) {
      throw new Error("Exercise library returned no rows; refusing to wipe the mirror.");
    }
    checkResponse(exerciseLibraryResponseSchema, list, "exercise library");

    const generation = Number((await this.#meta(org, "sync_generation")) ?? "0") + 1;
    // Commit the row upserts and the generation bump in one atomic batch, so a crash can never
    // leave rows written at a generation the meta never recorded (which would break the
    // prune-to-match self-healing). A crash before the prune just leaves prunable rows
    // for the next run, since the generation is already durable.
    await this.exec([
      ...chunk(list, UPSERT_CHUNK).map((c) => this.#upsertStmt(org, c, generation)),
      this.#setMetaStmt(org, "sync_generation", String(generation)),
    ]);

    let pruned = 0;
    if (list.length >= PRUNE_FLOOR) {
      const del = await this.db
        .delete(exercise)
        .where(and(eq(exercise.orgId, org), lt(exercise.generation, generation)));
      pruned = (del as { meta?: { changes?: number } }).meta?.changes ?? 0;
    }

    await this.exec([
      this.#setMetaStmt(org, "last_full_sync", String(Date.now())),
      this.#setCursorStmt(org, "library", 0, generation),
    ]);

    this.#freshCheckedAt = Date.now();
    return { synced: list.length, pruned, generation };
  }

  #upsertStmt(
    org: number,
    rows: ReadonlyArray<Record<string, unknown>>,
    generation: number,
  ): BatchStmt {
    const values = [];
    for (const ex of rows) {
      const id = coerceInt(ex.id);
      if (id === null) continue;
      const title = String(ex.title ?? "");
      values.push({
        orgId: org,
        id,
        title,
        searchText: buildSearchText(title),
        param1Type: coerceInt(ex.param_1_type),
        param2Type: coerceInt(ex.param_2_type),
        canEdit: coerceInt(ex.can_edit) ?? 0,
        userId: coerceInt(ex.user_id),
        useCount: coerceInt(ex.use_count) ?? 0,
        raw: JSON.stringify(ex),
        generation,
        source: "api",
      });
    }
    return this.db
      .insert(exercise)
      .values(values)
      .onConflictDoUpdate({
        target: [exercise.orgId, exercise.id],
        set: {
          title: sql`excluded.title`,
          searchText: sql`excluded.search_text`,
          param1Type: sql`excluded.param_1_type`,
          param2Type: sql`excluded.param_2_type`,
          canEdit: sql`excluded.can_edit`,
          userId: sql`excluded.user_id`,
          useCount: sql`excluded.use_count`,
          raw: sql`excluded.raw`,
          generation: sql`excluded.generation`,
          source: sql`excluded.source`,
        },
      });
  }

  // -- write-through (after API create/update/delete) ----------------------

  async recordUpsert(ex: Record<string, unknown>): Promise<void> {
    const org = await this.org();
    // Stamp write-through rows one generation ahead of the last full sync, so the next
    // refresh's prune (generation < newGen) cannot delete a just-created exercise that the
    // bulk library endpoint has not surfaced yet.
    const generation = Number((await this.#meta(org, "sync_generation")) ?? "0") + 1;
    await this.exec([this.#upsertStmt(org, [ex], generation)]);
  }

  async recordDelete(id: number): Promise<void> {
    const org = await this.org();
    await this.db.delete(exercise).where(and(eq(exercise.orgId, org), eq(exercise.id, id)));
  }

  // -- reads ---------------------------------------------------------------

  /** Param-type defaults for an exercise id, or null if unknown. No refresh on miss. */
  async defaults(id: number): Promise<{ param1: number | null; param2: number | null } | null> {
    const org = await this.org();
    const row = await this.db
      .select({ param1: exercise.param1Type, param2: exercise.param2Type })
      .from(exercise)
      .where(and(eq(exercise.orgId, org), eq(exercise.id, id)))
      .get();
    if (!row) return null;
    return { param1: row.param1, param2: row.param2 };
  }

  async get(id: number): Promise<Record<string, unknown> | null> {
    await this.ensureFresh();
    const org = await this.org();
    const row = await this.db
      .select({ raw: exercise.raw })
      .from(exercise)
      .where(and(eq(exercise.orgId, org), eq(exercise.id, id)))
      .get();
    if (!row) return null;
    return presentExercise(JSON.parse(row.raw) as Record<string, unknown>);
  }

  async search(query: string, limit = 20): Promise<ExerciseView[]> {
    await this.ensureFresh();
    return this.#searchOnly(query, limit);
  }

  async #searchOnly(query: string, limit: number): Promise<ExerciseView[]> {
    const org = await this.org();
    const tokens = query
      .toLowerCase()
      .split(/\s+/u)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];
    // No SQL ORDER BY: rankSearch is the authoritative ranker, so an upstream
    // ORDER BY use_count would only bias which rows survive the LIMIT truncation and
    // could starve it of the best lexical match. Cap the candidate scan instead.
    const where = and(
      eq(exercise.orgId, org),
      ...tokens.map((t) => like(exercise.searchText, `%${t}%`)),
    );
    const rows = await this.db
      .select(exerciseRowCols)
      .from(exercise)
      .where(where)
      .limit(SEARCH_CANDIDATES);
    return rankSearch(rows, query, limit).map(withUnits);
  }

  async #exact(query: string): Promise<ExerciseView | null> {
    const org = await this.org();
    const row = await this.db
      .select(exerciseRowCols)
      .from(exercise)
      .where(and(eq(exercise.orgId, org), eq(exercise.searchText, query.trim().toLowerCase())))
      .orderBy(exercise.canEdit)
      .limit(1)
      .get();
    return row ? withUnits(row) : null;
  }

  async resolve(name: string): Promise<ResolveResult> {
    await this.ensureFresh();
    let hit = await this.#exact(name);
    if (hit) return { match: hit, candidates: [hit] };

    let candidates = await this.#searchOnly(name, 20);
    if (candidates.length === 0) {
      await this.refresh();
      hit = await this.#exact(name);
      if (hit) return { match: hit, candidates: [hit] };
      candidates = await this.#searchOnly(name, 20);
    }

    if (candidates.length === 1) return { match: candidates[0] ?? null, candidates };
    return { match: null, candidates };
  }

  // -- create + stats ------------------------------------------------------

  async create(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.client.request("POST", CREATE_PATH, { body });
    if (!res.ok) throw new Error(`Exercise create failed (HTTP ${res.status}).`);
    const ex = unwrapEnvelope(res.data);
    if (ex && typeof ex === "object") {
      checkResponse(exerciseResponseSchema, ex, "exercise create");
      await this.recordUpsert(ex as Record<string, unknown>);
    }
    return ex as Record<string, unknown>;
  }

  async stats(): Promise<Record<string, unknown>> {
    const org = await this.org();
    const total = await this.#count(org);
    const custom = await this.db.$count(
      exercise,
      and(eq(exercise.orgId, org), eq(exercise.canEdit, 1)),
    );
    const cursors = await this.db
      .select({
        resource: syncState.resource,
        scope_id: syncState.scopeId,
        cursor: syncState.cursor,
        synced_at: syncState.syncedAt,
        generation: syncState.generation,
      })
      .from(syncState)
      .where(eq(syncState.orgId, org));
    return { org_id: org, exercises: total, custom, cursors };
  }
}
