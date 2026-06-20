import { OrgScopedStore } from "./base";
import { cursorUpsertStmt, runGroups } from "./d1";
import { coerceInt, coerceNum, isRecord } from "@trainheroic-unofficial/js";

const MONTHS_BACK = 18;
const MONTHS_FWD = 6;

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

export type CalendarSyncResult = {
  program: number;
  title: string;
  sessions: number;
  blocks: number;
  prescribed_sets: number;
  error?: string;
};

export type ProgramSessionRow = { id: number; date: string; title: string; published: number };

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

  async #fetchCalendar(calId: number): Promise<Array<Record<string, unknown>>> {
    const results = await Promise.all(
      monthWindow().map(([y, m]) =>
        this.client.request<{ programWorkouts?: Array<Record<string, unknown>> }>(
          "GET",
          `/1.0/coach/programs/edit/${calId}/${y}/${m}/1`,
        ),
      ),
    );
    const byId = new Map<number, Record<string, unknown>>();
    for (const res of results) {
      if (!res.ok) continue;
      for (const pw of res.data.programWorkouts ?? []) {
        const id = coerceInt(pw.id);
        if (id !== null) byId.set(id, pw);
      }
    }
    return [...byId.values()];
  }

  async syncCalendar(calId: number, title = ""): Promise<CalendarSyncResult> {
    const org = await this.org();
    const pws = await this.#fetchCalendar(calId);

    // Each session is one atomic group (its delete-then-reinsert must not split
    // across batches), so a mid-sync failure can never half-apply a session.
    const groups: D1PreparedStatement[][] = [
      [
        this.db
          .prepare(
            "INSERT INTO program (org_id, id, title, raw, source) VALUES (?,?,?,?,'api') " +
              "ON CONFLICT(org_id, id) DO UPDATE SET " +
              "title=CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END, raw=excluded.raw",
          )
          .bind(org, calId, title, JSON.stringify({ id: calId, title })),
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

    await runGroups(this.db, groups);
    return { program: calId, title, sessions, blocks, prescribed_sets: sets };
  }

  #sessionGroup(
    org: number,
    calId: number,
    sid: number,
    pw: Record<string, unknown>,
  ): { stmts: D1PreparedStatement[]; blocks: number; sets: number } {
    const year = coerceInt(pw.year) ?? 0;
    const month = coerceInt(pw.month) ?? 0;
    const day = coerceInt(pw.day) ?? 0;
    const date = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
    const sessionRaw = JSON.stringify(
      Object.fromEntries(Object.entries(pw).filter(([k]) => k !== "sets")),
    );

    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(
          "INSERT INTO program_session (org_id, id, program_id, day_index, date, title, published, raw, source) " +
            "VALUES (?,?,?,?,?,?,?,?,'api') ON CONFLICT(org_id, id) DO UPDATE SET " +
            "program_id=excluded.program_id, day_index=excluded.day_index, date=excluded.date, " +
            "title=excluded.title, published=excluded.published, raw=excluded.raw",
        )
        .bind(
          org,
          sid,
          calId,
          coerceInt(pw.timeline_day),
          date,
          String(pw.title ?? ""),
          coerceInt(pw.published) ?? 0,
          sessionRaw,
        ),
      this.db
        .prepare(
          "DELETE FROM prescribed_set WHERE org_id=? AND block_id IN " +
            "(SELECT id FROM block WHERE org_id=? AND program_session_id=?)",
        )
        .bind(org, org, sid),
      this.db.prepare("DELETE FROM block WHERE org_id=? AND program_session_id=?").bind(org, sid),
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
          .prepare(
            "INSERT INTO block (org_id, id, program_session_id, ord, type, title, instruction, raw, source) " +
              "VALUES (?,?,?,?,?,?,?,?,'api')",
          )
          .bind(
            org,
            bid,
            sid,
            coerceInt(blk.order),
            coerceInt(blk.type),
            String(blk.title ?? ""),
            String(blk.instruction ?? ""),
            JSON.stringify(blk),
          ),
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
    stmts: D1PreparedStatement[],
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
        this.db
          .prepare(
            "INSERT INTO prescribed_set (org_id, block_id, exercise_id, set_index, " +
              "param_1_type, param_1_value, param_2_type, param_2_value, source) VALUES (?,?,?,?,?,?,?,?,'api')",
          )
          .bind(org, bid, exId, i, p1t, coerceNum(v1), p2t, coerceNum(v2)),
      );
      count += 1;
    }
    return count;
  }

  async syncAll(): Promise<CalendarSyncResult[]> {
    const cals = [...(await this.listCalendars()).entries()];
    const out: CalendarSyncResult[] = [];
    // Sequential, and each calendar is isolated: one failure (subrequest cap, HTTP
    // error) is recorded in the result instead of aborting the whole run.
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
    const res = await this.db
      .prepare(
        "SELECT id, date, title, published FROM program_session WHERE org_id=? AND program_id=? ORDER BY date",
      )
      .bind(org, programId)
      .all<ProgramSessionRow>();
    return res.results;
  }

  async getSession(sessionId: number): Promise<{ sessionId: number; blocks: unknown[] }> {
    const org = await this.org();
    const blocksRes = await this.db
      .prepare(
        "SELECT id, ord, type, title, instruction FROM block WHERE org_id=? AND program_session_id=? ORDER BY ord",
      )
      .bind(org, sessionId)
      .all<{ id: number; ord: number; type: number; title: string; instruction: string }>();
    const withSets = await Promise.all(
      blocksRes.results.map(async (b) => {
        const sets = await this.db
          .prepare(
            "SELECT exercise_id, set_index, param_1_type, param_1_value, param_2_type, param_2_value " +
              "FROM prescribed_set WHERE org_id=? AND block_id=? ORDER BY set_index",
          )
          .bind(org, b.id)
          .all();
        return { ...b, sets: sets.results };
      }),
    );
    return { sessionId, blocks: withSets };
  }
}
