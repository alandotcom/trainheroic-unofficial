import { and, eq, inArray, sql } from "drizzle-orm";
import { OrgScopedStore } from "../base";
import { type BatchStmt, cursorUpsertStmt, mapPool } from "../runner";
import { block, prescribedSet, program, programSession } from "../schema";
import {
  checkResponse,
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

    let blocks = 0;
    let sets = 0;
    const setsObj = isRecord(pw.sets) ? pw.sets : {};
    const sortedBlocks = Object.values(setsObj)
      .filter(isRecord)
      .sort((a, b) => (coerceInt(a.order) ?? 0) - (coerceInt(b.order) ?? 0));

    for (const blk of sortedBlocks) {
      const bid = coerceInt(blk.id);
      if (bid === null) continue;
      stmts.push(
        this.db
          .insert(block)
          .values({
            orgId: org,
            id: bid,
            programSessionId: sid,
            ord: coerceInt(blk.order),
            type: coerceInt(blk.type),
            title: String(blk.title ?? ""),
            instruction: String(blk.instruction ?? ""),
            raw: JSON.stringify(blk),
          })
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
      blocks += 1;
      const exercises = Array.isArray(blk.exercises) ? blk.exercises.filter(isRecord) : [];
      for (const ex of exercises) sets += this.#setStatements(org, bid, ex, stmts);
    }
    return { stmts, blocks, sets };
  }

  #setStatements(
    org: number,
    bid: number,
    ex: Record<string, unknown>,
    stmts: BatchStmt[],
  ): number {
    const exId = coerceInt(ex.exercise_id);
    const p1t = coerceInt(ex.param_1_type);
    const p2t = coerceInt(ex.param_2_type);
    let count = 0;
    for (let i = 1; i <= 10; i += 1) {
      const v1 = ex[`param_1_data_${i}`];
      const v2 = ex[`param_2_data_${i}`];
      const empty1 = v1 === undefined || v1 === null || v1 === "";
      const empty2 = v2 === undefined || v2 === null || v2 === "";
      if (empty1 && empty2) continue;
      stmts.push(
        this.db.insert(prescribedSet).values({
          orgId: org,
          blockId: bid,
          exerciseId: exId,
          setIndex: i,
          param1Type: p1t,
          param1Value: prescribedValue(v1),
          param2Type: p2t,
          param2Value: prescribedValue(v2),
        }),
      );
      count += 1;
    }
    return count;
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

  async getProgramSessions(programId: number): Promise<ProgramSessionRow[]> {
    const org = await this.org();
    const rows = await this.db
      .select({
        id: programSession.id,
        date: programSession.date,
        title: programSession.title,
        published: programSession.published,
      })
      .from(programSession)
      .where(and(eq(programSession.orgId, org), eq(programSession.programId, programId)))
      .orderBy(programSession.date);
    return rows;
  }

  async getSession(sessionId: number): Promise<{ sessionId: number; blocks: unknown[] }> {
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
      .orderBy(prescribedSet.blockId, prescribedSet.setIndex);

    const byBlock = new Map<number, Record<string, unknown>[]>();
    for (const { block_id, ...set } of setRows) {
      const bucket = byBlock.get(block_id) ?? [];
      bucket.push(set);
      byBlock.set(block_id, bucket);
    }
    const blocks = blockRows.map((b) => ({ ...b, sets: byBlock.get(b.id) ?? [] }));
    return { sessionId, blocks };
  }
}
