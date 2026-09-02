import { and, desc, eq, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { OrgScopedStore } from "../base";
import { type BatchStmt, cursorUpsertStmt, mapPool } from "../runner";
import { block, prescribedSet, program, programSession } from "../schema";
import {
  checkResponse,
  chunk,
  coerceInt,
  coerceNum,
  isRecord,
  programsEditResponseSchema,
} from "@trainheroic-unofficial/js";

const MONTHS_BACK = 18;
const MONTHS_FWD = 6;
// Bound the upstream fan-out per calendar so a month window doesn't burst the host (or the
// Worker subrequest budget) with ~25 simultaneous fetches.
const FETCH_CONCURRENCY = 5;
// Every programming row expands to at most ten bound values; eight stays below D1's limit.
const BULK_WRITE_ROWS = 8;

function monthWindow(back = MONTHS_BACK, fwd = MONTHS_FWD): Array<[number, number]> {
  const now = new Date();
  const base = now.getFullYear() * 12 + now.getMonth();
  const out: Array<[number, number]> = [];
  for (let k = -back; k <= fwd; k += 1) {
    const idx = base + k;
    out.push([Math.floor(idx / 12), (idx % 12) + 1]);
  }
  return out;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * A prescribed slot value: a number when numeric, otherwise the raw string. Free-text
 * prescriptions (e.g. "AMRAP", "8-12", "max") must survive — coercing them to null would
 * silently drop the prescription. SQLite's REAL affinity stores non-numeric text as text.
 */
function prescribedValue(value: unknown): number | string | null {
  if (value === undefined || value === null || value === "") return null;
  return coerceNum(value) ?? String(value);
}

export type CalendarSyncResult = {
  program: number;
  title: string;
  sessions: number;
  blocks: number;
  prescribed_sets: number;
  /** Month windows whose fetch failed — the sync is incomplete when this is nonzero. */
  windows_failed?: number;
  error?: string;
};

// date/title are nullable in the schema (a session can be stored before either is known),
// so the row type reflects that rather than asserting non-null at the read boundary.
export type ProgramSessionRow = {
  id: number;
  date: string | null;
  title: string | null;
  published: number;
};
export type ProgramSessionCursor = { date: string | null; id: number };

export type PrescribedSetRow = {
  exercise_id: number | null;
  set_index: number | null;
  param_1_type: number | null;
  param_1_value: number | string | null;
  param_2_type: number | null;
  param_2_value: number | string | null;
};

export type ProgramSessionBlock = {
  id: number;
  ord: number | null;
  type: number | null;
  title: string | null;
  instruction: string | null;
  sets: PrescribedSetRow[];
};

export type ProgramSessionDetail = {
  sessionId: number;
  blocks: ProgramSessionBlock[];
};

/** Programming zone: prescribed programs -> sessions -> blocks -> sets. Accumulate-only. */
export class ProgrammingStore extends OrgScopedStore {
  /** Calendar ids to sync, mapped to a title: standalone programs + team group-programs. */
  async listCalendars(): Promise<Map<number, string>> {
    const cals = new Map<number, string>();
    const programs = await this.client.request<Array<Record<string, unknown>>>(
      "GET",
      "/1.0/coach/programs",
    );
    if (Array.isArray(programs.data)) {
      for (const p of programs.data) {
        const id = coerceInt(p.id);
        if (id !== null) cals.set(id, String(p.title ?? ""));
      }
    }
    const teams = await this.client.request<Array<Record<string, unknown>>>(
      "GET",
      "/1.0/coach/teams",
    );
    if (Array.isArray(teams.data)) {
      for (const t of teams.data) {
        const gp = coerceInt(t.group_program);
        if (gp !== null && !cals.has(gp)) cals.set(gp, String(t.title ?? ""));
      }
    }
    return cals;
  }

  async #fetchCalendar(
    calId: number,
  ): Promise<{ workouts: Array<Record<string, unknown>>; windowsFailed: number }> {
    const results = await mapPool(monthWindow(), FETCH_CONCURRENCY, ([y, m]) =>
      this.client.request<{ programWorkouts?: Array<Record<string, unknown>> }>(
        "GET",
        `/1.0/coach/programs/edit/${calId}/${y}/${m}/1`,
      ),
    );
    const byId = new Map<number, Record<string, unknown>>();
    let windowsFailed = 0;
    for (const res of results) {
      if (!res.ok) {
        windowsFailed += 1;
        continue;
      }
      checkResponse(programsEditResponseSchema, res.data, "programs edit (sync)");
      for (const pw of res.data.programWorkouts ?? []) {
        const id = coerceInt(pw.id);
        if (id !== null) byId.set(id, pw);
      }
    }
    return { workouts: [...byId.values()], windowsFailed };
  }

  async syncCalendar(calId: number, title = ""): Promise<CalendarSyncResult> {
    const org = await this.org();
    const { workouts: pws, windowsFailed } = await this.#fetchCalendar(calId);

    // Each session is one atomic group (its delete-then-reinsert must not split
    // across batches), so a mid-sync failure can never half-apply a session.
    const groups: BatchStmt[][] = [
      [
        this.db
          .insert(program)
          .values({ orgId: org, id: calId, title, raw: JSON.stringify({ id: calId, title }) })
          .onConflictDoUpdate({
            target: [program.orgId, program.id],
            // Keep the existing title when the incoming one is blank (team group-programs
            // arrive titleless from the calendar fetch); always take the fresh raw.
            set: {
              title: sql`CASE WHEN excluded.title <> '' THEN excluded.title ELSE ${program.title} END`,
              raw: sql`excluded.raw`,
            },
          }),
      ],
    ];

    let sessions = 0;
    let blocks = 0;
    let sets = 0;
    for (const pw of pws) {
      if (pw.deleted) continue;
      const sid = coerceInt(pw.id);
      if (sid === null) continue;
      const built = this.#sessionGroup(org, calId, sid, pw);
      groups.push(built.stmts);
      sessions += 1;
      blocks += built.blocks;
      sets += built.sets;
    }

    groups.push([
      cursorUpsertStmt(this.db, org, "programming", calId, {
        cursor: new Date().toISOString().slice(0, 10),
      }),
    ]);

    await this.runGroups(groups);
    const result: CalendarSyncResult = {
      program: calId,
      title,
      sessions,
      blocks,
      prescribed_sets: sets,
    };
    if (windowsFailed > 0) result.windows_failed = windowsFailed;
    return result;
  }

  #sessionGroup(
    org: number,
    calId: number,
    sid: number,
    pw: Record<string, unknown>,
  ): { stmts: BatchStmt[]; blocks: number; sets: number } {
    const year = coerceInt(pw.year) ?? 0;
    const month = coerceInt(pw.month) ?? 0;
    const day = coerceInt(pw.day) ?? 0;
    const date = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
    const sessionRaw = JSON.stringify(
      Object.fromEntries(Object.entries(pw).filter(([k]) => k !== "sets")),
    );

    const stmts: BatchStmt[] = [
      this.db
        .insert(programSession)
        .values({
          orgId: org,
          id: sid,
          programId: calId,
          dayIndex: coerceInt(pw.timeline_day),
          date,
          title: String(pw.title ?? ""),
          published: coerceInt(pw.published) ?? 0,
          raw: sessionRaw,
        })
        .onConflictDoUpdate({
          target: [programSession.orgId, programSession.id],
          set: {
            programId: sql`excluded.program_id`,
            dayIndex: sql`excluded.day_index`,
            date: sql`excluded.date`,
            title: sql`excluded.title`,
            published: sql`excluded.published`,
            raw: sql`excluded.raw`,
          },
        }),
      // Cascade-clear this session's sets (via its blocks), then its blocks, before rebuild.
      this.db.delete(prescribedSet).where(
        and(
          eq(prescribedSet.orgId, org),
          inArray(
            prescribedSet.blockId,
            this.db
              .select({ id: block.id })
              .from(block)
              .where(and(eq(block.orgId, org), eq(block.programSessionId, sid))),
          ),
        ),
      ),
      this.db.delete(block).where(and(eq(block.orgId, org), eq(block.programSessionId, sid))),
    ];

    const blockRows: Array<typeof block.$inferInsert> = [];
    const setRows: Array<typeof prescribedSet.$inferInsert> = [];
    const setsObj = isRecord(pw.sets) ? pw.sets : {};
    const sortedBlocks = Object.values(setsObj)
      .filter(isRecord)
      .sort((a, b) => (coerceInt(a.order) ?? 0) - (coerceInt(b.order) ?? 0));

    for (const blk of sortedBlocks) {
      const bid = coerceInt(blk.id);
      if (bid === null) continue;
      blockRows.push({
        orgId: org,
        id: bid,
        programSessionId: sid,
        ord: coerceInt(blk.order),
        type: coerceInt(blk.type),
        title: String(blk.title ?? ""),
        instruction: String(blk.instruction ?? ""),
        raw: JSON.stringify(blk),
      });
      // Insert in prescribed exercise order so rowid order (what getSession sorts on within a
      // block) reconstructs the block as written: A1..An, then B1..Bn for a superset.
      const exercises = (Array.isArray(blk.exercises) ? blk.exercises.filter(isRecord) : []).sort(
        (a, b) => (coerceInt(a.order) ?? 0) - (coerceInt(b.order) ?? 0),
      );
      for (const ex of exercises) setRows.push(...this.#setRows(org, bid, ex));
    }
    for (const values of chunk(blockRows, BULK_WRITE_ROWS)) {
      stmts.push(
        this.db
          .insert(block)
          .values(values)
          .onConflictDoUpdate({
            target: [block.orgId, block.id],
            set: {
              programSessionId: sql`excluded.program_session_id`,
              ord: sql`excluded.ord`,
              type: sql`excluded.type`,
              title: sql`excluded.title`,
              instruction: sql`excluded.instruction`,
              raw: sql`excluded.raw`,
            },
          }),
      );
    }
    for (const values of chunk(setRows, BULK_WRITE_ROWS)) {
      stmts.push(this.db.insert(prescribedSet).values(values));
    }
    return { stmts, blocks: blockRows.length, sets: setRows.length };
  }

  #setRows(
    org: number,
    bid: number,
    ex: Record<string, unknown>,
  ): Array<typeof prescribedSet.$inferInsert> {
    const exId = coerceInt(ex.exercise_id);
    const p1t = coerceInt(ex.param_1_type);
    const p2t = coerceInt(ex.param_2_type);
    const rows: Array<typeof prescribedSet.$inferInsert> = [];
    for (let i = 1; i <= 10; i += 1) {
      const v1 = ex[`param_1_data_${i}`];
      const v2 = ex[`param_2_data_${i}`];
      const empty1 = v1 === undefined || v1 === null || v1 === "";
      const empty2 = v2 === undefined || v2 === null || v2 === "";
      if (empty1 && empty2) continue;
      rows.push({
        orgId: org,
        blockId: bid,
        exerciseId: exId,
        setIndex: i,
        param1Type: p1t,
        param1Value: prescribedValue(v1),
        param2Type: p2t,
        param2Value: prescribedValue(v2),
      });
    }
    return rows;
  }

  async syncAll(): Promise<CalendarSyncResult[]> {
    const cals = [...(await this.listCalendars()).entries()];
    const out: CalendarSyncResult[] = [];
    // Sequential: a per-calendar HTTP error is recorded in that calendar's result instead
    // of aborting the whole run. Note the Worker subrequest cap is per-invocation, not
    // per-calendar, so once it is hit every remaining calendar fails too — a partial run is
    // expected for very large accounts, and each failed window is reported via windows_failed.
    for (const [id, title] of cals) {
      try {
        out.push(await this.syncCalendar(id, title));
      } catch (err) {
        out.push({
          program: id,
          title,
          sessions: 0,
          blocks: 0,
          prescribed_sets: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return out;
  }

  async getProgramSessions(
    programId: number,
    limit = 200,
    before?: ProgramSessionCursor,
  ): Promise<ProgramSessionRow[]> {
    const org = await this.org();
    const conditions = [eq(programSession.orgId, org), eq(programSession.programId, programId)];
    const columns = {
      id: programSession.id,
      date: programSession.date,
      title: programSession.title,
      published: programSession.published,
    };
    const read = (extra: readonly SQL[], take: number) =>
      this.db
        .select(columns)
        .from(programSession)
        .where(and(...conditions, ...extra))
        .orderBy(desc(programSession.date), desc(programSession.id))
        .limit(take);

    if (before === undefined) return read([], limit);
    if (before.date === null) {
      return read([isNull(programSession.date), lt(programSession.id, before.id)], limit);
    }
    const rows = await read(
      [
        isNotNull(programSession.date),
        sql`(${programSession.date}, ${programSession.id}) < (${before.date}, ${before.id})`,
      ],
      limit,
    );
    if (rows.length < limit) {
      rows.push(...(await read([isNull(programSession.date)], limit - rows.length)));
    }
    return rows;
  }

  async getSession(sessionId: number): Promise<ProgramSessionDetail> {
    const org = await this.org();
    const blockRows = await this.db
      .select({
        id: block.id,
        ord: block.ord,
        type: block.type,
        title: block.title,
        instruction: block.instruction,
      })
      .from(block)
      .where(and(eq(block.orgId, org), eq(block.programSessionId, sessionId)))
      .orderBy(block.ord);

    // One query for every set in the session (via the block subquery), grouped by block
    // in memory — instead of one query per block.
    const setRows = await this.db
      .select({
        block_id: prescribedSet.blockId,
        exercise_id: prescribedSet.exerciseId,
        set_index: prescribedSet.setIndex,
        param_1_type: prescribedSet.param1Type,
        param_1_value: prescribedSet.param1Value,
        param_2_type: prescribedSet.param2Type,
        param_2_value: prescribedSet.param2Value,
      })
      .from(prescribedSet)
      .where(
        and(
          eq(prescribedSet.orgId, org),
          inArray(
            prescribedSet.blockId,
            this.db
              .select({ id: block.id })
              .from(block)
              .where(and(eq(block.orgId, org), eq(block.programSessionId, sessionId))),
          ),
        ),
      )
      // (block_id, set_index) is not unique once a block holds several exercises (a superset
      // stores A1..A3 and B1..B3 under the same indices), so order by rowid within the block:
      // each session's rows are deleted and reinserted together in prescribed exercise order.
      .orderBy(prescribedSet.blockId, sql`rowid`);

    const byBlock = new Map<number, PrescribedSetRow[]>();
    for (const { block_id, ...set } of setRows) {
      const bucket = byBlock.get(block_id) ?? [];
      bucket.push(set);
      byBlock.set(block_id, bucket);
    }
    const blocks = blockRows.map((b) => ({ ...b, sets: byBlock.get(b.id) ?? [] }));
    return { sessionId, blocks };
  }
}
