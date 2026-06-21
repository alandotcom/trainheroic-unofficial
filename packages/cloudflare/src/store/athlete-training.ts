import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import {
  buildSearchText,
  coerceInt,
  coerceNum,
  fetchExerciseHistoryDetail,
  fetchExerciseHistoryList,
  fetchWorkingMaxes,
} from "@trainheroic-unofficial/js";
import { AthleteScopedStore } from "./base";
import { type BatchStmt, mapPool, runBatches, runGroups } from "./d1";
import { athleteExercise, athleteExerciseSession, athletePr, athleteWorkingMax } from "./schema";

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
    const stmts: BatchStmt[] = [];
    for (const item of list) {
      const id = coerceInt(item.id);
      if (id === null) continue;
      const title = item.title;
      stmts.push(
        this.db
          .insert(athleteExercise)
          .values({
            userId: user,
            id,
            title,
            searchText: buildSearchText(title),
            param1Type: coerceInt(item.param1Type),
            param2Type: coerceInt(item.param2Type),
            isCircuit: item.isCircuit ? 1 : 0,
            raw: JSON.stringify(item),
          })
          // sessions_synced_at is intentionally NOT in the set clause: re-syncing the catalog
          // must preserve each exercise's history watermark.
          .onConflictDoUpdate({
            target: [athleteExercise.userId, athleteExercise.id],
            set: {
              title: sql`excluded.title`,
              searchText: sql`excluded.search_text`,
              param1Type: sql`excluded.param_1_type`,
              param2Type: sql`excluded.param_2_type`,
              isCircuit: sql`excluded.is_circuit`,
              raw: sql`excluded.raw`,
            },
          }),
      );
    }
    await runBatches(this.db, stmts);
    return stmts.length;
  }

  /** Replace the working-max rows (one upsert per exercise). */
  async syncWorkingMaxes(): Promise<number> {
    const user = await this.user();
    const maxes = await fetchWorkingMaxes(this.client);
    const stmts: BatchStmt[] = [];
    for (const m of maxes) {
      const exId = coerceInt(m.exercise_id);
      if (exId === null) continue;
      stmts.push(
        this.db
          .insert(athleteWorkingMax)
          .values({
            userId: user,
            exerciseId: exId,
            title: m.title ?? null,
            paramType: coerceInt(m.param_type),
            value: coerceNum(m.value),
            typeSuffix: m.type_suffix ?? null,
            workingMaxId: coerceInt(m.working_max_id),
            raw: JSON.stringify(m),
          })
          .onConflictDoUpdate({
            target: [athleteWorkingMax.userId, athleteWorkingMax.exerciseId],
            set: {
              title: sql`excluded.title`,
              paramType: sql`excluded.param_type`,
              value: sql`excluded.value`,
              typeSuffix: sql`excluded.type_suffix`,
              workingMaxId: sql`excluded.working_max_id`,
              raw: sql`excluded.raw`,
            },
          }),
      );
    }
    await runBatches(this.db, stmts);
    return stmts.length;
  }

  /** Pull one exercise's session history + PRs, then mark it synced (atomic group). */
  async syncExercise(exerciseId: number): Promise<ExerciseSyncResult> {
    const user = await this.user();
    const detail = await fetchExerciseHistoryDetail(this.client, exerciseId, user);
    const group: BatchStmt[] = [
      this.db
        .delete(athletePr)
        .where(and(eq(athletePr.userId, user), eq(athletePr.exerciseId, exerciseId))),
    ];

    let prs = 0;
    for (const pr of detail.liftPRs ?? []) {
      group.push(
        this.db.insert(athletePr).values({
          userId: user,
          exerciseId,
          description: pr.description ?? null,
          reps: coerceInt(pr.reps),
          weight: coerceNum(pr.weight),
          units: pr.units ?? null,
          date: pr.dateCompleted ?? null,
          savedWorkoutSetExerciseId: coerceInt(pr.savedWorkoutSetExerciseId),
        }),
      );
      prs += 1;
    }

    let sessions = 0;
    for (const h of detail.history ?? []) {
      const sid = coerceInt(h.savedWorkoutSetExerciseId);
      if (sid === null) continue;
      group.push(
        this.db
          .insert(athleteExerciseSession)
          .values({
            userId: user,
            savedWorkoutSetExerciseId: sid,
            exerciseId,
            date: h.dateCompleted ?? null,
            abr: h.abr ?? null,
            bestEstimated1rm: coerceNum(h.bestEstimated1RM),
            programWorkoutId: coerceInt(h.programWorkoutId),
            teamId: coerceInt(h.teamId),
            raw: JSON.stringify(h),
          })
          .onConflictDoUpdate({
            target: [
              athleteExerciseSession.userId,
              athleteExerciseSession.savedWorkoutSetExerciseId,
            ],
            set: {
              date: sql`excluded.date`,
              abr: sql`excluded.abr`,
              bestEstimated1rm: sql`excluded.best_estimated_1rm`,
              programWorkoutId: sql`excluded.program_workout_id`,
              teamId: sql`excluded.team_id`,
              raw: sql`excluded.raw`,
            },
          }),
      );
      sessions += 1;
    }

    group.push(
      this.db
        .update(athleteExercise)
        .set({ sessionsSyncedAt: Date.now() })
        .where(and(eq(athleteExercise.userId, user), eq(athleteExercise.id, exerciseId))),
    );
    await runGroups(this.db, [group]);
    return { exerciseId, sessions, prs };
  }

  /** Sync the next batch of exercises whose history has not been pulled yet. */
  async syncNextBatch(batchSize = DEFAULT_BATCH): Promise<ExerciseSyncResult[]> {
    const user = await this.user();
    const rows = await this.db
      .select({ id: athleteExercise.id })
      .from(athleteExercise)
      .where(and(eq(athleteExercise.userId, user), isNull(athleteExercise.sessionsSyncedAt)))
      .orderBy(athleteExercise.id)
      .limit(batchSize);
    const ids = rows.map((r) => r.id);
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
    return this.db.$count(
      athleteExercise,
      and(eq(athleteExercise.userId, user), isNull(athleteExercise.sessionsSyncedAt)),
    );
  }

  /** Forget the per-exercise watermark so the next batch sync re-pulls every exercise. */
  async resetSessionsWatermark(): Promise<void> {
    const user = await this.user();
    await this.db
      .update(athleteExercise)
      .set({ sessionsSyncedAt: null })
      .where(eq(athleteExercise.userId, user));
  }

  // --- queries ---

  async searchCatalog(q: string | undefined, limit: number): Promise<unknown[]> {
    const user = await this.user();
    const cols = {
      id: athleteExercise.id,
      title: athleteExercise.title,
      param_1_type: athleteExercise.param1Type,
      param_2_type: athleteExercise.param2Type,
      is_circuit: athleteExercise.isCircuit,
    };
    if (q === undefined || q.trim() === "") {
      return this.db
        .select(cols)
        .from(athleteExercise)
        .where(eq(athleteExercise.userId, user))
        .orderBy(athleteExercise.title)
        .limit(limit);
    }
    return this.db
      .select(cols)
      .from(athleteExercise)
      .where(
        and(
          eq(athleteExercise.userId, user),
          like(athleteExercise.searchText, `%${buildSearchText(q)}%`),
        ),
      )
      .orderBy(sql`length(${athleteExercise.title})`, athleteExercise.title)
      .limit(limit);
  }

  async sessions(exerciseId: number, limit: number): Promise<unknown[]> {
    const user = await this.user();
    return this.db
      .select({
        date: athleteExerciseSession.date,
        abr: athleteExerciseSession.abr,
        best_estimated_1rm: athleteExerciseSession.bestEstimated1rm,
        program_workout_id: athleteExerciseSession.programWorkoutId,
        saved_workout_set_exercise_id: athleteExerciseSession.savedWorkoutSetExerciseId,
      })
      .from(athleteExerciseSession)
      .where(
        and(
          eq(athleteExerciseSession.userId, user),
          eq(athleteExerciseSession.exerciseId, exerciseId),
        ),
      )
      .orderBy(desc(athleteExerciseSession.date))
      .limit(limit);
  }

  async prs(exerciseId: number): Promise<unknown[]> {
    const user = await this.user();
    return this.db
      .select({
        description: athletePr.description,
        reps: athletePr.reps,
        weight: athletePr.weight,
        units: athletePr.units,
        date: athletePr.date,
      })
      .from(athletePr)
      .where(and(eq(athletePr.userId, user), eq(athletePr.exerciseId, exerciseId)))
      .orderBy(athletePr.reps);
  }

  async workingMaxes(): Promise<unknown[]> {
    const user = await this.user();
    return this.db
      .select({
        exercise_id: athleteWorkingMax.exerciseId,
        title: athleteWorkingMax.title,
        param_type: athleteWorkingMax.paramType,
        value: athleteWorkingMax.value,
        type_suffix: athleteWorkingMax.typeSuffix,
      })
      .from(athleteWorkingMax)
      .where(eq(athleteWorkingMax.userId, user))
      .orderBy(athleteWorkingMax.title);
  }
}
