import { coerceInt, fetchAthleteWorkouts, presentAthleteWorkout } from "@trainheroic-unofficial/js";
import type { ProgramWorkout } from "@trainheroic-unofficial/js";
import { AthleteScopedStore } from "./base";
import { athleteCursorUpsertStmt, runGroups } from "./d1";

export type WorkoutSyncResult = {
  workouts: number;
  exercises: number;
  from: string;
  to: string;
};

/** Athlete workouts zone: scheduled + completed workouts, flattened to exercise rows. */
export class AthleteWorkoutStore extends AthleteScopedStore {
  #upsertWorkout(
    user: number,
    w: ProgramWorkout,
    id: number,
    logged: boolean,
  ): D1PreparedStatement {
    const rec = w as Record<string, unknown>;
    return this.db
      .prepare(
        "INSERT INTO athlete_workout (user_id, id, date, title, program_id, program_title, team_id, team_title, logged, raw, source) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,'api') ON CONFLICT(user_id, id) DO UPDATE SET " +
          "date=excluded.date, title=excluded.title, program_id=excluded.program_id, " +
          "program_title=excluded.program_title, team_id=excluded.team_id, team_title=excluded.team_title, " +
          "logged=excluded.logged, raw=excluded.raw",
      )
      .bind(
        user,
        id,
        typeof rec.date === "string" ? rec.date : null,
        typeof rec.workout_title === "string" ? rec.workout_title : null,
        coerceInt(rec.program_id),
        typeof rec.program_title === "string" ? rec.program_title : null,
        coerceInt(rec.team_id),
        typeof rec.team_title === "string" ? rec.team_title : null,
        logged ? 1 : 0,
        JSON.stringify(w),
      );
  }

  /** Pull a date window into the workouts zone. Each workout's exercise rows are rebuilt. */
  async sync(startDate: string, endDate: string): Promise<WorkoutSyncResult> {
    const user = await this.user();
    const workouts = await fetchAthleteWorkouts(this.client, startDate, endDate);
    const groups: D1PreparedStatement[][] = [];
    let exercises = 0;

    for (const w of workouts) {
      const id = coerceInt((w as Record<string, unknown>).id);
      if (id === null) continue;
      const view = presentAthleteWorkout(w);
      // One atomic group per workout: upsert the workout, then rebuild its exercise rows.
      const group: D1PreparedStatement[] = [
        this.#upsertWorkout(user, w, id, view.logged),
        this.db
          .prepare("DELETE FROM athlete_workout_exercise WHERE user_id=? AND workout_id=?")
          .bind(user, id),
      ];
      for (const block of view.blocks) {
        for (const ex of block.exercises) {
          group.push(
            this.db
              .prepare(
                "INSERT INTO athlete_workout_exercise (user_id, workout_id, block_order, block_title, is_test, " +
                  "exercise_id, title, units, prescribed, performed, instruction, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,'api')",
              )
              .bind(
                user,
                id,
                block.order,
                block.title,
                block.isTest ? 1 : 0,
                ex.exerciseId,
                ex.title,
                JSON.stringify(ex.units),
                JSON.stringify(ex.prescribed),
                JSON.stringify(ex.performed),
                ex.instruction,
              ),
          );
          exercises += 1;
        }
      }
      groups.push(group);
    }

    groups.push([
      athleteCursorUpsertStmt(this.db, user, "workouts", 0, `${startDate}..${endDate}`),
    ]);
    await runGroups(this.db, groups);
    return { workouts: workouts.length, exercises, from: startDate, to: endDate };
  }

  /** Stored workouts, optionally bounded by an inclusive date window (newest first). */
  async list(startDate?: string, endDate?: string): Promise<unknown[]> {
    const user = await this.user();
    const clauses = ["user_id=?"];
    const binds: Array<number | string> = [user];
    if (startDate !== undefined) {
      clauses.push("date>=?");
      binds.push(startDate);
    }
    if (endDate !== undefined) {
      clauses.push("date<=?");
      binds.push(endDate);
    }
    const res = await this.db
      .prepare(
        `SELECT id, date, title, program_title, team_title, logged FROM athlete_workout WHERE ${clauses.join(
          " AND ",
        )} ORDER BY date DESC`,
      )
      .bind(...binds)
      .all<Record<string, unknown>>();
    return res.results.map((row) => ({ ...row, logged: coerceInt(row.logged) === 1 }));
  }

  /** The flattened exercise rows for one stored workout. */
  async workoutExercises(workoutId: number): Promise<unknown[]> {
    const user = await this.user();
    const res = await this.db
      .prepare(
        "SELECT block_order, block_title, is_test, exercise_id, title, units, prescribed, performed, instruction " +
          "FROM athlete_workout_exercise WHERE user_id=? AND workout_id=? ORDER BY block_order",
      )
      .bind(user, workoutId)
      .all<Record<string, unknown>>();
    return res.results.map((row) => ({
      ...row,
      units: safeParse(row.units),
      prescribed: safeParse(row.prescribed),
      performed: safeParse(row.performed),
    }));
  }
}

function safeParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
