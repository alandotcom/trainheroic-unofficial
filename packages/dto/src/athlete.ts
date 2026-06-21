import { z } from "zod";
import { idArgSchema } from "./common";

// Shapes for the athlete-facing TrainHeroic API. The coach API operates on a roster; the
// athlete API operates on the logged-in user's own training (history, scheduled workouts,
// PRs, working maxes). Response schemas follow the house rule from responses.ts: loose
// objects, id coercion, only the fields we read required — so checkResponse() can warn on
// drift without ever rejecting a live response.

const intLike = z.union([z.number(), z.string()]);
const intLikeOrNull = z.union([z.number(), z.string(), z.null()]);
const numLikeOrNull = z.union([z.number(), z.string(), z.null()]);

/** `/user/simple` — the identity + tenant key (numeric `id`) for any logged-in account. */
export const userSimpleSchema = z.looseObject({
  id: intLike,
  roles: z.array(z.string()).optional(),
  org_id: intLikeOrNull.optional(),
});
export type UserSimple = z.infer<typeof userSimpleSchema>;

/** `/v5/athleteProfile/summary` — lifetime training totals. Needs `use_metric` in the query. */
export const athleteProfileSummarySchema = z.looseObject({
  reps_sum: z.number().optional(),
  volume_sum: z.number().optional(),
  sessions_count: z.number().optional(),
  first_logged_date: z.string().optional(),
  last_logged_date: z.string().optional(),
  duration_hours: z.number().optional(),
});
export type AthleteProfileSummary = z.infer<typeof athleteProfileSummarySchema>;

/** `/v5/users/{id}` — the detailed athlete profile (only the fields we surface). */
export const athleteUserSchema = z.looseObject({
  id: intLike,
  email: z.string().optional(),
  name_first: z.string().optional(),
  name_last: z.string().optional(),
  username: z.string().optional(),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
  use_metric: z.boolean().optional(),
});
export type AthleteUser = z.infer<typeof athleteUserSchema>;

/** `/1.0/athlete/prefs` — notification + display preference flags. */
export const athletePrefsSchema = z.looseObject({ id: intLike });
export type AthletePrefs = z.infer<typeof athletePrefsSchema>;

/** One item of `/2.0/athlete/workingMax` — the athlete's working max for an exercise. */
export const athleteWorkingMaxSchema = z.looseObject({
  exercise_id: intLike,
  title: z.string().optional(),
  param_type: intLikeOrNull.optional(),
  value: numLikeOrNull.optional(),
  type_suffix: z.string().optional(),
  working_max_id: intLikeOrNull.optional(),
});
export const athleteWorkingMaxListSchema = z.array(athleteWorkingMaxSchema);
export type AthleteWorkingMax = z.infer<typeof athleteWorkingMaxSchema>;

/** One item of `/v5/users/exercises/history` — an exercise the athlete has logged. */
export const exerciseHistoryListItemSchema = z.looseObject({
  id: intLike,
  title: z.string(),
  isCircuit: z.boolean().optional(),
  prescription: z.string().optional(),
  param1Type: intLikeOrNull.optional(),
  param2Type: intLikeOrNull.optional(),
});
export const exerciseHistoryListSchema = z.array(exerciseHistoryListItemSchema);
export type ExerciseHistoryListItem = z.infer<typeof exerciseHistoryListItemSchema>;

/** A single completed set inside a history entry (`/v5/exercises/{id}/history`). */
export const historySetSchema = z.looseObject({
  setNumber: z.number(),
  formattedValue: z.string().optional(),
  rawValue1: numLikeOrNull.optional(),
  rawValue2: numLikeOrNull.optional(),
  savedWorkoutSetExerciseId: intLike.optional(),
});

/** A best rep-max derived for a history entry. */
export const repMaxSchema = z.looseObject({ reps: z.number(), weight: z.number() });

/** One performed session of an exercise (`/v5/exercises/{id}/history` → `history[]`). */
export const historyEntrySchema = z.looseObject({
  dateCompleted: z.string(),
  notes: z.string().nullable().optional(),
  isLift: z.boolean().optional(),
  param1Type: intLikeOrNull.optional(),
  param2Type: intLikeOrNull.optional(),
  savedWorkoutSetExerciseId: intLike.optional(),
  teamId: intLikeOrNull.optional(),
  programWorkoutId: intLikeOrNull.optional(),
  abr: z.string().optional(),
  bestEstimated1RM: z.number().optional(),
  repMaxes: z.array(repMaxSchema).optional(),
  sets: z.array(historySetSchema).optional(),
});

/** A lifetime PR row from `/v5/exercises/{id}/history` → `liftPRs[]`. */
export const liftPRSchema = z.looseObject({
  weight: z.number().optional(),
  savedWorkoutSetExerciseId: intLike.optional(),
  setNumber: z.number().optional(),
  dateCompleted: z.string().optional(),
  reps: z.number().optional(),
  units: z.string().optional(),
  isMetric: z.boolean().optional(),
  description: z.string().optional(),
});

/** `/v5/exercises/{id}/history` — the per-exercise PRs + session history. */
export const exerciseHistoryDetailSchema = z.looseObject({
  liftPRs: z.array(liftPRSchema).optional(),
  singleParamPRs: z.array(z.unknown()).optional(),
  history: z.array(historyEntrySchema).optional(),
});
export type ExerciseHistoryDetail = z.infer<typeof exerciseHistoryDetailSchema>;

/** One item of `/v5/exercises/{id}/personalRecords` — a standards-filtered PR. */
export const personalRecordSchema = z.looseObject({
  id: intLike.optional(),
  savedWorkoutSetExerciseId: intLike.optional(),
  setNumber: z.number().optional(),
  reps: z.number().optional(),
  weight: z.number().optional(),
  scaledWeight: z.number().optional(),
  units: z.string().optional(),
  isMetric: z.boolean().optional(),
});
export const personalRecordListSchema = z.array(personalRecordSchema);
export type PersonalRecord = z.infer<typeof personalRecordSchema>;

/** `/v5/exercises/{id}/stats` — last performance + PR for an exercise. Needs `date` in the query. */
export const exerciseStatsSchema = z.looseObject({
  isLift: z.boolean().optional(),
  lastPerformance: z.unknown().optional(),
  personalRecord: z.unknown().optional(),
});
export type ExerciseStats = z.infer<typeof exerciseStatsSchema>;

/**
 * One item of `/3.0/athlete/programworkout/range` — a scheduled/completed workout. The deep
 * `summarizedSavedWorkout` tree is left loose: the presenter in `js` flattens it, so dto only
 * pins the top-level fields the warehouse and presenter key off.
 */
export const programWorkoutSchema = z.looseObject({
  id: intLike,
  date: z.string().optional(),
  workout_title: z.string().optional(),
  program_id: intLikeOrNull.optional(),
  program_title: z.string().optional(),
  team_id: intLikeOrNull.optional(),
  team_title: z.string().optional(),
  summarizedSavedWorkout: z.unknown().optional(),
});
export const programWorkoutListSchema = z.array(programWorkoutSchema);
export type ProgramWorkout = z.infer<typeof programWorkoutSchema>;

// --- Tool/CLI input schemas (these validate, per the house rule) ---

/** A `YYYY-MM-DD` date argument. The single definition reused across athlete tool inputs. */
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "expected YYYY-MM-DD");

/** Args for the workout-range read: an inclusive `YYYY-MM-DD` window. */
export const athleteWorkoutRangeArgsSchema = z.object({
  startDate: dateString,
  endDate: dateString,
});
export type AthleteWorkoutRangeArgs = z.infer<typeof athleteWorkoutRangeArgsSchema>;

/**
 * Args for the set-logging write. `date` (the workout's day) locates the saved
 * workout via the range endpoint; `savedWorkoutSetId` picks the set to complete; `results`
 * gives, per exercise in it, the entered value of each set (param 1 / param 2 by entry slot).
 */
export const logSetArgsSchema = z.object({
  date: dateString,
  savedWorkoutSetId: idArgSchema,
  results: z
    .array(
      z.object({
        savedWorkoutSetExerciseId: idArgSchema,
        sets: z
          .array(
            z.object({
              param1: z.union([z.number(), z.string()]).optional(),
              param2: z.union([z.number(), z.string()]).optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export type LogSetArgs = z.infer<typeof logSetArgsSchema>;

// --- Presented (model-friendly) view types, produced by the `js` presenters ---

/** A flattened exercise within a presented workout: prescriptions, logged results, units. */
export type AthleteWorkoutExercise = {
  exerciseId: number | null;
  title: string;
  instruction: string | null;
  units: Array<string | null>;
  /** Per-set prescriptions, e.g. ["5 @ 225 lb", "3 @ 245 lb"] or ["AMRAP"]. */
  prescribed: string[];
  /**
   * Per-set values the athlete actually logged, same shape as `prescribed`. Empty when
   * nothing was recorded for this exercise. This — not any "completed" flag — is the
   * reliable signal that a set was performed (the API leaves completion flags at 0 even
   * when results were entered).
   */
  performed: string[];
};

/** A block (workout set) within a presented workout. */
export type AthleteWorkoutBlock = {
  order: number;
  title: string | null;
  instruction: string | null;
  isTest: boolean;
  exercises: AthleteWorkoutExercise[];
};

/** A scheduled/completed workout flattened for reading. */
export type AthleteWorkoutView = {
  id: number | null;
  date: string;
  title: string;
  program: string | null;
  team: string | null;
  instruction: string | null;
  /**
   * True when the athlete logged at least one set on this workout (any exercise has
   * `performed` values). Use this to tell a recorded session from a merely scheduled one;
   * the API's own completion flags are unreliable.
   */
  logged: boolean;
  blocks: AthleteWorkoutBlock[];
};

/**
 * A compact per-workout header with no block/exercise detail. Produced by the summary
 * projection so an overview question ("what's on my schedule this week", "what have I been
 * training lately") returns one small row per session instead of the full prescribed/performed
 * sets — a dense multi-program week of `AthleteWorkoutView`s can run tens of KB and force a
 * follow-up drill-in.
 */
export type AthleteWorkoutSummary = {
  id: number | null;
  date: string;
  title: string;
  program: string | null;
  team: string | null;
  /** True when the athlete logged at least one set on this workout. */
  logged: boolean;
  /** Total prescribed exercises across all blocks. */
  exerciseCount: number;
  /**
   * How many of those exercises have at least one logged set. Read it against exerciseCount
   * (e.g. 1 of 12), not in isolation — a low number means the session was mostly unlogged, not
   * that only one exercise was prescribed.
   */
  performedCount: number;
};

/** One exercise inside a coach-viewed athlete session (from the calendar summary). */
export type CoachAthleteExercise = {
  exerciseId: number | null;
  title: string;
  /** The set summary the API returns, e.g. "5 x 2 @ 205 lb" or "3 x 5 @ 24 in". */
  summary: string | null;
  completed: boolean;
};

/** One session in a coach's view of a roster athlete's training month. */
export type CoachAthleteSession = {
  workoutId: number | null;
  savedWorkoutId: number | null;
  title: string;
  /** True when the athlete logged this session (the reliable did-they-train signal). */
  logged: boolean;
  completed: boolean;
  rpe: number | null;
  durationMin: number | null;
  notes: string | null;
  exercises: CoachAthleteExercise[];
};

/**
 * A coach's month view of a roster athlete's training, presented from
 * `/2.0/coach/athlete/calendar/summary`. Sessions are in calendar order within the month; the
 * API carries no per-session date, so the month comes from year/month.
 */
export type CoachAthleteTraining = {
  athleteId: number | null;
  athleteName: string | null;
  year: number;
  month: number;
  sessions: CoachAthleteSession[];
};

/** One performed session in a presented exercise history. */
export type PresentedExerciseSession = {
  date: string;
  abr: string | null;
  estimated1RM: number | null;
  sets: Array<{ setNumber: number; value: string | null }>;
};

/** A presented per-exercise history: PRs plus the session time-series. */
export type PresentedExerciseHistory = {
  liftPRs: Array<{
    description: string | null;
    reps: number | null;
    weight: number | null;
    date: string | null;
  }>;
  sessions: PresentedExerciseSession[];
};
