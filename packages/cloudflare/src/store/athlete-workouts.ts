import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { coerceInt, fetchAthleteWorkouts, presentAthleteWorkout } from "@trainheroic-unofficial/js";
import type { ProgramWorkout } from "@trainheroic-unofficial/js";
import { AthleteScopedStore } from "./base";
import { type BatchStmt, athleteCursorUpsertStmt, runGroups } from "./d1";
import { athleteWorkout, athleteWorkoutExercise } from "./schema";

export type WorkoutSyncResult = {
  workouts: number;
  exercises: number;
  from: string;
  to: string;
};

/** Athlete workouts zone: scheduled + completed workouts, flattened to exercise rows. */
export class AthleteWorkoutStore extends AthleteScopedStore {
  #upsertWorkout(user: number, w: ProgramWorkout, id: number, logged: boolean): BatchStmt {
    const rec = w as Record<string, unknown>;
    return this.db
      .insert(athleteWorkout)
      .values({
        userId: user,
        id,
        date: typeof rec.date === "string" ? rec.date : null,
        title: typeof rec.workout_title === "string" ? rec.workout_title : null,
        programId: coerceInt(rec.program_id),
        programTitle: typeof rec.program_title === "string" ? rec.program_title : null,
        teamId: coerceInt(rec.team_id),
        teamTitle: typeof rec.team_title === "string" ? rec.team_title : null,
        logged: logged ? 1 : 0,
        raw: JSON.stringify(w),
      })
      .onConflictDoUpdate({
        target: [athleteWorkout.userId, athleteWorkout.id],
        set: {
          date: sql`excluded.date`,
          title: sql`excluded.title`,
          programId: sql`excluded.program_id`,
          programTitle: sql`excluded.program_title`,
          teamId: sql`excluded.team_id`,
          teamTitle: sql`excluded.team_title`,
          logged: sql`excluded.logged`,
          raw: sql`excluded.raw`,
        },
      });
  }

  /** Pull a date window into the workouts zone. Each workout's exercise rows are rebuilt. */
  async sync(startDate: string, endDate: string): Promise<WorkoutSyncResult> {
    const user = await this.user();
    const workouts = await fetchAthleteWorkouts(this.client, startDate, endDate);
    const groups: BatchStmt[][] = [];
    let exercises = 0;

    for (const w of workouts) {
      const id = coerceInt((w as Record<string, unknown>).id);
      if (id === null) continue;
      const view = presentAthleteWorkout(w);
      // One atomic group per workout: upsert the workout, then rebuild its exercise rows.
      const group: BatchStmt[] = [
        this.#upsertWorkout(user, w, id, view.logged),
        this.db
          .delete(athleteWorkoutExercise)
          .where(
            and(eq(athleteWorkoutExercise.userId, user), eq(athleteWorkoutExercise.workoutId, id)),
          ),
      ];
      for (const block of view.blocks) {
        for (const ex of block.exercises) {
          group.push(
            this.db.insert(athleteWorkoutExercise).values({
              userId: user,
              workoutId: id,
              blockOrder: block.order,
              blockTitle: block.title,
              isTest: block.isTest ? 1 : 0,
              exerciseId: ex.exerciseId,
              title: ex.title,
              units: JSON.stringify(ex.units),
              prescribed: JSON.stringify(ex.prescribed),
              performed: JSON.stringify(ex.performed),
              instruction: ex.instruction,
            }),
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
    const conditions = [eq(athleteWorkout.userId, user)];
    if (startDate !== undefined) conditions.push(gte(athleteWorkout.date, startDate));
    if (endDate !== undefined) conditions.push(lte(athleteWorkout.date, endDate));
    const rows = await this.db
      .select({
        id: athleteWorkout.id,
        date: athleteWorkout.date,
        title: athleteWorkout.title,
        program_title: athleteWorkout.programTitle,
        team_title: athleteWorkout.teamTitle,
        logged: athleteWorkout.logged,
      })
      .from(athleteWorkout)
      .where(and(...conditions))
      .orderBy(desc(athleteWorkout.date));
    return rows.map((row) => ({ ...row, logged: row.logged === 1 }));
  }

  /** The flattened exercise rows for one stored workout. */
  async workoutExercises(workoutId: number): Promise<unknown[]> {
    const user = await this.user();
    const rows = await this.db
      .select({
        block_order: athleteWorkoutExercise.blockOrder,
        block_title: athleteWorkoutExercise.blockTitle,
        is_test: athleteWorkoutExercise.isTest,
        exercise_id: athleteWorkoutExercise.exerciseId,
        title: athleteWorkoutExercise.title,
        units: athleteWorkoutExercise.units,
        prescribed: athleteWorkoutExercise.prescribed,
        performed: athleteWorkoutExercise.performed,
        instruction: athleteWorkoutExercise.instruction,
      })
      .from(athleteWorkoutExercise)
      .where(
        and(
          eq(athleteWorkoutExercise.userId, user),
          eq(athleteWorkoutExercise.workoutId, workoutId),
        ),
      )
      .orderBy(athleteWorkoutExercise.blockOrder);
    return rows.map((row) => ({
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
