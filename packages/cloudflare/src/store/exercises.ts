import { OrgScopedStore } from "./base";
import { cursorUpsertStmt } from "./d1";
import {
  asExerciseList,
  buildSearchText,
  checkResponse,
  chunk,
  coerceInt,
  type ExerciseIndex,
  exerciseLibraryResponseSchema,
  exerciseResponseSchema,
  type ExerciseRow,
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
// After confirming freshness, trust it for this long instead of re-querying D1 on every
// read (the DO instance is long-lived, so a workout build resolving many exercises would
// otherwise pay a COUNT + meta read per exercise).
const FRESH_CHECK_MS = 60 * 1000;
const PRUNE_FLOOR = 100;
// 12 columns per row; keep rows-per-statement under D1's 100 bound-param limit.
const UPSERT_CHUNK = 8;
// How many LIKE matches to pull before app-side ranking decides the final order.
const SEARCH_CANDIDATES = 200;

const COLS = [
  "org_id",
  "id",
  "title",
  "search_text",
  "param_1_type",
  "param_2_type",
  "can_edit",
  "user_id",
  "use_count",
  "raw",
  "generation",
  "source",
] as const;

const SELECT_CORE =
  "SELECT id, title, param_1_type, param_2_type, can_edit, user_id, use_count FROM exercise";

/** D1-backed mirror of the TrainHeroic exercise library (reference zone). */
export class ExerciseStore extends OrgScopedStore implements ExerciseIndex {
  #freshCheckedAt = 0;

  // -- meta / watermarks ---------------------------------------------------

  async #meta(org: number, key: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT value FROM sync_meta WHERE org_id = ? AND key = ?")
      .bind(org, key)
      .first<{ value: string }>();
    return row?.value ?? null;
  }

  #setMetaStmt(org: number, key: string, value: string): D1PreparedStatement {
    return this.db
      .prepare(
        "INSERT INTO sync_meta (org_id, key, value) VALUES (?, ?, ?) " +
          "ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value",
      )
      .bind(org, key, value);
  }

  #setCursorStmt(
    org: number,
    resource: string,
    scopeId: number,
    generation: number,
  ): D1PreparedStatement {
    return cursorUpsertStmt(this.db, org, resource, scopeId, { generation });
  }

  async #count(org: number): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM exercise WHERE org_id = ?")
      .bind(org)
      .first<{ n: number }>();
    return row?.n ?? 0;
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
    // Commit the row upserts and the generation bump in one batch, so a crash can never
    // leave rows written at a generation the meta never recorded (which would break the
    // prune-to-match self-healing). A crash before the prune just leaves prunable rows
    // for the next run, since the generation is already durable.
    await this.db.batch([
      ...chunk(list, UPSERT_CHUNK).map((c) => this.#upsertStmt(org, c, generation)),
      this.#setMetaStmt(org, "sync_generation", String(generation)),
    ]);

    let pruned = 0;
    if (list.length >= PRUNE_FLOOR) {
      const del = await this.db
        .prepare("DELETE FROM exercise WHERE org_id = ? AND generation < ?")
        .bind(org, generation)
        .run();
      pruned = del.meta.changes ?? 0;
    }

    await this.db.batch([
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
  ): D1PreparedStatement {
    const rowSql = `(${COLS.map(() => "?").join(", ")})`;
    const updates = COLS.filter((c) => c !== "org_id" && c !== "id")
      .map((c) => `${c} = excluded.${c}`)
      .join(", ");
    const sql =
      `INSERT INTO exercise (${COLS.join(", ")}) VALUES ${rows.map(() => rowSql).join(", ")} ` +
      `ON CONFLICT(org_id, id) DO UPDATE SET ${updates}`;

    const binds: unknown[] = [];
    for (const ex of rows) {
      const title = String(ex.title ?? "");
      binds.push(
        org,
        coerceInt(ex.id),
        title,
        buildSearchText(title),
        coerceInt(ex.param_1_type),
        coerceInt(ex.param_2_type),
        coerceInt(ex.can_edit) ?? 0,
        coerceInt(ex.user_id),
        coerceInt(ex.use_count) ?? 0,
        JSON.stringify(ex),
        generation,
        "api",
      );
    }
    return this.db.prepare(sql).bind(...binds);
  }

  // -- write-through (after API create/update/delete) ----------------------

  async recordUpsert(ex: Record<string, unknown>): Promise<void> {
    const org = await this.org();
    // Stamp write-through rows one generation ahead of the last full sync, so the next
    // refresh's prune (generation < newGen) cannot delete a just-created exercise that the
    // bulk library endpoint has not surfaced yet.
    const generation = Number((await this.#meta(org, "sync_generation")) ?? "0") + 1;
    await this.#upsertStmt(org, [ex], generation).run();
  }

  async recordDelete(id: number): Promise<void> {
    const org = await this.org();
    await this.db.prepare("DELETE FROM exercise WHERE org_id = ? AND id = ?").bind(org, id).run();
  }

  // -- reads ---------------------------------------------------------------

  /** Param-type defaults for an exercise id, or null if unknown. No refresh on miss. */
  async defaults(id: number): Promise<{ param1: number | null; param2: number | null } | null> {
    const org = await this.org();
    const row = await this.db
      .prepare("SELECT param_1_type, param_2_type FROM exercise WHERE org_id = ? AND id = ?")
      .bind(org, id)
      .first<{ param_1_type: number | null; param_2_type: number | null }>();
    if (!row) return null;
    return { param1: row.param_1_type, param2: row.param_2_type };
  }

  async get(id: number): Promise<Record<string, unknown> | null> {
    await this.ensureFresh();
    const org = await this.org();
    const row = await this.db
      .prepare("SELECT raw FROM exercise WHERE org_id = ? AND id = ?")
      .bind(org, id)
      .first<{ raw: string }>();
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
    const where = tokens.map(() => "search_text LIKE ?").join(" AND ");
    // No SQL ORDER BY: rankSearch is the authoritative ranker, so an upstream
    // ORDER BY use_count would only bias which rows survive the LIMIT truncation and
    // could starve it of the best lexical match. Cap the candidate scan instead.
    const binds = [org, ...tokens.map((t) => `%${t}%`), SEARCH_CANDIDATES];
    const res = await this.db
      .prepare(`${SELECT_CORE} WHERE org_id = ? AND ${where} LIMIT ?`)
      .bind(...binds)
      .all<ExerciseRow>();
    return rankSearch(res.results, query, limit).map(withUnits);
  }

  async #exact(query: string): Promise<ExerciseView | null> {
    const org = await this.org();
    const row = await this.db
      .prepare(`${SELECT_CORE} WHERE org_id = ? AND search_text = ? ORDER BY can_edit LIMIT 1`)
      .bind(org, query.trim().toLowerCase())
      .first<ExerciseRow>();
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
    const custom = await this.db
      .prepare("SELECT COUNT(*) AS n FROM exercise WHERE org_id = ? AND can_edit = 1")
      .bind(org)
      .first<{ n: number }>();
    const cursors = await this.db
      .prepare(
        "SELECT resource, scope_id, cursor, synced_at, generation FROM sync_state WHERE org_id = ?",
      )
      .bind(org)
      .all();
    return { org_id: org, exercises: total, custom: custom?.n ?? 0, cursors: cursors.results };
  }
}
