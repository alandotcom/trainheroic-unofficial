import {
  buildSearchText,
  coerceInt,
  coerceNum,
  fetchExerciseHistoryDetail,
  fetchExerciseHistoryList,
  fetchWorkingMaxes,
} from "@trainheroic-unofficial/js";
import { AthleteScopedStore } from "./base";
import { mapPool, runBatches, runGroups } from "./d1";

// Bound the per-exercise history fan-out so a sync doesn't burst the host or blow the Worker
// subrequest budget. History is drained in batches (sessions_synced_at watermark per exercise).
const FETCH_CONCURRENCY = 5;
const DEFAULT_BATCH = 25;

export type ExerciseSyncResult = {
  exerciseId: number;
  sessions: number;
  prs: number;
  error?: string;
};
export type TrainingSyncResult = {
  catalog: number;
  workingMaxes: number;
  exercisesSynced: number;
  remaining: number;
  results: ExerciseSyncResult[];
};

/** Athlete training zone: exercise catalog, per-exercise session history, PRs, working maxes. */
export class AthleteTrainingStore extends AthleteScopedStore {
  /** Refresh the exercise catalog. Preserves each row's sessions_synced_at watermark. */
  async syncCatalog(): Promise<number> {
    const user = await this.user();
    const list = await fetchExerciseHistoryList(this.client);
    const stmts: D1PreparedStatement[] = [];
    for (const item of list) {
      const id = coerceInt(item.id);
      if (id === null) continue;
      const title = item.title;
      stmts.push(
        this.db
          .prepare(
            "INSERT INTO athlete_exercise (user_id, id, title, search_text, param_1_type, param_2_type, is_circuit, raw, source) " +
              "VALUES (?,?,?,?,?,?,?,?,'api') ON CONFLICT(user_id, id) DO UPDATE SET " +
              "title=excluded.title, search_text=excluded.search_text, param_1_type=excluded.param_1_type, " +
              "param_2_type=excluded.param_2_type, is_circuit=excluded.is_circuit, raw=excluded.raw",
          )
          .bind(
            user,
            id,
            title,
            buildSearchText(title),
            coerceInt(item.param1Type),
            coerceInt(item.param2Type),
            item.isCircuit ? 1 : 0,
            JSON.stringify(item),
          ),
      );
    }
    await runBatches(this.db, stmts);
    return stmts.length;
  }

  /** Replace the working-max rows (one upsert per exercise). */
  async syncWorkingMaxes(): Promise<number> {
    const user = await this.user();
    const maxes = await fetchWorkingMaxes(this.client);
    const stmts: D1PreparedStatement[] = [];
    for (const m of maxes) {
      const exId = coerceInt(m.exercise_id);
      if (exId === null) continue;
      stmts.push(
        this.db
          .prepare(
            "INSERT INTO athlete_working_max (user_id, exercise_id, title, param_type, value, type_suffix, working_max_id, raw, source) " +
              "VALUES (?,?,?,?,?,?,?,?,'api') ON CONFLICT(user_id, exercise_id) DO UPDATE SET " +
              "title=excluded.title, param_type=excluded.param_type, value=excluded.value, " +
              "type_suffix=excluded.type_suffix, working_max_id=excluded.working_max_id, raw=excluded.raw",
          )
          .bind(
            user,
            exId,
            m.title ?? null,
            coerceInt(m.param_type),
            coerceNum(m.value),
            m.type_suffix ?? null,
            coerceInt(m.working_max_id),
            JSON.stringify(m),
          ),
      );
    }
    await runBatches(this.db, stmts);
    return stmts.length;
  }

  /** Pull one exercise's session history + PRs, then mark it synced (atomic group). */
  async syncExercise(exerciseId: number): Promise<ExerciseSyncResult> {
    const user = await this.user();
    const detail = await fetchExerciseHistoryDetail(this.client, exerciseId, user);
    const group: D1PreparedStatement[] = [
      this.db
        .prepare("DELETE FROM athlete_pr WHERE user_id=? AND exercise_id=?")
        .bind(user, exerciseId),
    ];

    let prs = 0;
    for (const pr of detail.liftPRs ?? []) {
      group.push(
        this.db
          .prepare(
            "INSERT INTO athlete_pr (user_id, exercise_id, description, reps, weight, units, date, saved_workout_set_exercise_id, source) " +
              "VALUES (?,?,?,?,?,?,?,?,'api')",
          )
          .bind(
            user,
            exerciseId,
            pr.description ?? null,
            coerceInt(pr.reps),
            coerceNum(pr.weight),
            pr.units ?? null,
            pr.dateCompleted ?? null,
            coerceInt(pr.savedWorkoutSetExerciseId),
          ),
      );
      prs += 1;
    }

    let sessions = 0;
    for (const h of detail.history ?? []) {
      const sid = coerceInt(h.savedWorkoutSetExerciseId);
      if (sid === null) continue;
      group.push(
        this.db
          .prepare(
            "INSERT INTO athlete_exercise_session (user_id, saved_workout_set_exercise_id, exercise_id, date, abr, " +
              "best_estimated_1rm, program_workout_id, team_id, raw, source) VALUES (?,?,?,?,?,?,?,?,?,'api') " +
              "ON CONFLICT(user_id, saved_workout_set_exercise_id) DO UPDATE SET date=excluded.date, abr=excluded.abr, " +
              "best_estimated_1rm=excluded.best_estimated_1rm, program_workout_id=excluded.program_workout_id, " +
              "team_id=excluded.team_id, raw=excluded.raw",
          )
          .bind(
            user,
            sid,
            exerciseId,
            h.dateCompleted ?? null,
            h.abr ?? null,
            coerceNum(h.bestEstimated1RM),
            coerceInt(h.programWorkoutId),
            coerceInt(h.teamId),
            JSON.stringify(h),
          ),
      );
      sessions += 1;
    }

    group.push(
      this.db
        .prepare("UPDATE athlete_exercise SET sessions_synced_at=? WHERE user_id=? AND id=?")
        .bind(Date.now(), user, exerciseId),
    );
    await runGroups(this.db, [group]);
    return { exerciseId, sessions, prs };
  }

  /** Sync the next batch of exercises whose history has not been pulled yet. */
  async syncNextBatch(batchSize = DEFAULT_BATCH): Promise<ExerciseSyncResult[]> {
    const user = await this.user();
    const rows = await this.db
      .prepare(
        "SELECT id FROM athlete_exercise WHERE user_id=? AND sessions_synced_at IS NULL ORDER BY id LIMIT ?",
      )
      .bind(user, batchSize)
      .all<{ id: number }>();
    const ids = rows.results.map((r) => r.id);
    return mapPool(ids, FETCH_CONCURRENCY, async (id) => {
      try {
        return await this.syncExercise(id);
      } catch (err) {
        return {
          exerciseId: id,
          sessions: 0,
          prs: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }

  async unsyncedCount(): Promise<number> {
    const user = await this.user();
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM athlete_exercise WHERE user_id=? AND sessions_synced_at IS NULL",
      )
      .bind(user)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /** Forget the per-exercise watermark so the next batch sync re-pulls every exercise. */
  async resetSessionsWatermark(): Promise<void> {
    const user = await this.user();
    await this.db
      .prepare("UPDATE athlete_exercise SET sessions_synced_at=NULL WHERE user_id=?")
      .bind(user)
      .run();
  }

  // --- queries ---

  async searchCatalog(q: string | undefined, limit: number): Promise<unknown[]> {
    const user = await this.user();
    if (q === undefined || q.trim() === "") {
      const res = await this.db
        .prepare(
          "SELECT id, title, param_1_type, param_2_type, is_circuit FROM athlete_exercise WHERE user_id=? ORDER BY title LIMIT ?",
        )
        .bind(user, limit)
        .all();
      return res.results;
    }
    const res = await this.db
      .prepare(
        "SELECT id, title, param_1_type, param_2_type, is_circuit FROM athlete_exercise " +
          "WHERE user_id=? AND search_text LIKE ? ORDER BY length(title), title LIMIT ?",
      )
      .bind(user, `%${buildSearchText(q)}%`, limit)
      .all();
    return res.results;
  }

  async sessions(exerciseId: number, limit: number): Promise<unknown[]> {
    const user = await this.user();
    const res = await this.db
      .prepare(
        "SELECT date, abr, best_estimated_1rm, program_workout_id, saved_workout_set_exercise_id " +
          "FROM athlete_exercise_session WHERE user_id=? AND exercise_id=? ORDER BY date DESC LIMIT ?",
      )
      .bind(user, exerciseId, limit)
      .all();
    return res.results;
  }

  async prs(exerciseId: number): Promise<unknown[]> {
    const user = await this.user();
    const res = await this.db
      .prepare(
        "SELECT description, reps, weight, units, date FROM athlete_pr WHERE user_id=? AND exercise_id=? ORDER BY reps",
      )
      .bind(user, exerciseId)
      .all();
    return res.results;
  }

  async workingMaxes(): Promise<unknown[]> {
    const user = await this.user();
    const res = await this.db
      .prepare(
        "SELECT exercise_id, title, param_type, value, type_suffix FROM athlete_working_max WHERE user_id=? ORDER BY title",
      )
      .bind(user)
      .all();
    return res.results;
  }
}
