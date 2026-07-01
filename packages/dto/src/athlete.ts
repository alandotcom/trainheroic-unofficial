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
 * One entered set: the value of each parameter slot (param 1 / param 2 — e.g. reps / weight).
 * Shared by every logging write so the per-set shape is defined once.
 */
export const loggedSetSchema = z.object({
  param1: z.union([z.number(), z.string()]).optional(),
  param2: z.union([z.number(), z.string()]).optional(),
});

/**
 * A logged set that can name the prescribed position it fills. `slot` is the 1-based set
 * index in the prescription (10 max) the result should land in; omit it to fill the next
 * sequential position (the first entry is set 1, the second set 2, and so on). Targeting a
 * slot lets a partial log land in the right positions of a multi-set prescription — e.g.
 * three top singles into the 4th/5th/6th positions of an `8,5,3,1,1,1` ramp. Used by the
 * by-set logging write (not the by-exercise session log, where each exercise's sets are
 * always sequential).
 */
export const loggedSetWithSlotSchema = loggedSetSchema.extend({
  // 10 tracks the SDK's MAX_PARAM_SLOTS (param_N_data_1..10); dto cannot import from `js`.
  slot: z.number().int().min(1).max(10).optional(),
});

/**
 * Args for the set-logging write. `date` (the workout's day) locates the saved
 * workout via the range endpoint; `savedWorkoutSetId` picks the set to complete; `results`
 * gives, per exercise in it, the entered value of each set. Each set fills the next position by
 * default, or names its `slot` (1-based) to place a partial log at specific positions. A partial
 * log keeps positions already logged in an earlier call and leaves the positions it does not
 * write empty.
 */
export const logSetArgsSchema = z.object({
  date: dateString,
  savedWorkoutSetId: idArgSchema,
  results: z
    .array(
      z.object({
        savedWorkoutSetExerciseId: idArgSchema,
        sets: z.array(loggedSetWithSlotSchema).min(1),
      }),
    )
    .min(1),
});
export type LogSetArgs = z.infer<typeof logSetArgsSchema>;

/**
 * Args for the coach "log for athlete" write — the same shape as logSetArgsSchema plus the
 * roster `athleteId` whose set is being logged on their behalf.
 */
export const coachLogSetArgsSchema = logSetArgsSchema.extend({ athleteId: idArgSchema });
export type CoachLogSetArgs = z.infer<typeof coachLogSetArgsSchema>;

/**
 * Args for the coach prescription-override write. Like {@link coachLogSetArgsSchema}
 * (athleteId + date + savedWorkoutSetId + per-exercise `sets`), but the values are prescribed
 * targets (param1 = reps, param2 = weight) written to the athlete's plan without marking the set
 * performed. The write replaces this athlete's whole prescription for the set, so its sets are
 * positional and sequential by definition: it deliberately omits the log path's `slot` field (a
 * sparse, slot-targeted prescription has no meaning here) by building its results off
 * {@link loggedSetSchema} rather than {@link loggedSetWithSlotSchema}.
 */
export const coachPrescribeSetArgsSchema = z.object({
  date: dateString,
  savedWorkoutSetId: idArgSchema,
  athleteId: idArgSchema,
  results: z
    .array(
      z.object({
        savedWorkoutSetExerciseId: idArgSchema,
        sets: z.array(loggedSetSchema).min(1),
      }),
    )
    .min(1),
});
export type CoachPrescribeSetArgs = z.infer<typeof coachPrescribeSetArgsSchema>;

/**
 * Args for the coach per-athlete exercise swap: replace the exercise prescribed in one of a
 * roster athlete's saved-workout slots with a different exercise, the API equivalent of the
 * app's per-athlete "swap exercise". `savedWorkoutSetExerciseId` is that athlete's own slot id
 * (the same id `coachLogSetArgsSchema` uses, read off athlete_saved_workouts raw);
 * `exerciseId` is the replacement exercise. The team/program prescription is left untouched.
 */
export const swapAthleteExerciseArgsSchema = z.object({
  savedWorkoutSetExerciseId: idArgSchema,
  exerciseId: idArgSchema,
});
export type SwapAthleteExerciseArgs = z.infer<typeof swapAthleteExerciseArgsSchema>;

/**
 * Args for logging a whole session by exercise (rather than by saved-workout-set id). Each
 * exercise carries its entered sets and an optional 1-based `order`. The athlete path creates
 * or reuses a personal session for the date and logs against it; the coach path resolves each
 * exercise to a set already prescribed on that date and logs against that.
 */
export const logSessionArgsSchema = z.object({
  date: dateString,
  exercises: z
    .array(
      z.object({
        exerciseId: idArgSchema,
        order: z.number().int().positive().optional(),
        sets: z.array(loggedSetSchema).min(1),
      }),
    )
    .min(1),
});
export type LogSessionArgs = z.infer<typeof logSessionArgsSchema>;

/**
 * Args for the coach variant of {@link logSessionArgsSchema}: the same shape plus the roster
 * `athleteId` whose session is being logged on their behalf.
 */
export const coachLogSessionArgsSchema = logSessionArgsSchema.extend({ athleteId: idArgSchema });
export type CoachLogSessionArgs = z.infer<typeof coachLogSessionArgsSchema>;

/**
 * Args for removing a personal (athlete-created) workout session. `programWorkoutId` is the
 * range item's top-level `id`; `date` is that session's day, used to look the item back up so the
 * write can confirm it is a personal session (`personal_cal === true`) before deleting. A
 * coach-scheduled workout is never removed this way.
 */
export const athleteSessionRemoveArgsSchema = z.object({
  programWorkoutId: idArgSchema,
  date: dateString,
});
export type AthleteSessionRemoveArgs = z.infer<typeof athleteSessionRemoveArgsSchema>;

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
  /**
   * True when this is a personal session the athlete created (the API's `personal_cal` flag),
   * rather than a coach-scheduled workout. Only a personal session can be removed with
   * `athlete_session_remove`; its `id` is the `programWorkoutId` that tool takes.
   */
  personal: boolean;
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
  /** True when this is a personal session the athlete created, not a coach-scheduled workout. */
  personal: boolean;
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

/**
 * One athlete's all-time training snapshot in a coach's roster-activity ranking. `lastLoggedDate`
 * is the real training-recency signal (null means the athlete has never logged a session),
 * distinct from `list_athletes`'s `daysSinceLastLogin`, which is app-login recency.
 */
export type RosterActivityRow = {
  athleteId: number;
  sessionsCount: number | null;
  firstLoggedDate: string | null;
  lastLoggedDate: string | null;
  totalReps: number | null;
  totalVolume: number | null;
};

/**
 * One athlete's logged volume over a date window, aggregated from the `training-summary-athlete`
 * analytics report (which returns one row per logged session). `volume` is in pounds.
 */
export type TeamVolumeAthlete = {
  athleteId: number;
  name: string | null;
  sessions: number;
  reps: number;
  volume: number;
  firstLoggedDate: string | null;
  lastLoggedDate: string | null;
};

/**
 * A coach's team-wide training volume over an inclusive `YYYY-MM-DD` window: per-athlete rows
 * (only athletes who logged in range appear) plus the rolled-up team totals. The windowed
 * counterpart to the all-time {@link RosterActivityRow} snapshot.
 */
export type TeamVolumeReport = {
  window: { start: string; end: string };
  athletes: TeamVolumeAthlete[];
  totals: { athletes: number; sessions: number; reps: number; volume: number };
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
    units: string | null;
    date: string | null;
  }>;
  sessions: PresentedExerciseSession[];
};

// --- Structured workout-history export (for CSV/JSON/text download) ---

/**
 * One positional parameter of a set, carrying its unit label and raw value. TrainHeroic stores
 * each set as two generic slots (`param_1`/`param_2`); the unit tells you what the slot means
 * (`reps`, `lb`, `sec`, `%max`, `RPE`, …). The value is kept raw: a number when the slot holds a
 * number, or a string for a non-numeric prescription such as `AMRAP` or a rep range like `8-12`.
 */
export type ExportSetParam = {
  unit: string | null;
  value: number | string | null;
};

/**
 * One side (prescribed or performed) of a single set. `reps`/`weight` are pulled out of the two
 * generic params by unit for the common lifting case; `params` keeps both slots verbatim so a
 * time/distance/percentage exercise loses nothing. `display` is the readable `"5 @ 225"` form used
 * by the text export.
 */
export type ExportSetSide = {
  reps: number | string | null;
  weight: number | string | null;
  weightUnit: string | null;
  params: ExportSetParam[];
  display: string;
};

/**
 * A single set of an exercise, aligned by its positional slot (1-based). `prescribed` is what the
 * coach programmed and `performed` is what the athlete logged; either can be null (a skipped set
 * has no `performed`; athlete-added work has no `prescribed`).
 */
export type ExportSet = {
  set: number;
  prescribed: ExportSetSide | null;
  performed: ExportSetSide | null;
};

/** An exercise within an exported workout: its unit labels and the per-set prescribed/performed. */
export type ExportExercise = {
  exerciseId: number | null;
  title: string;
  units: Array<string | null>;
  sets: ExportSet[];
};

/** A block (workout set / superset) within an exported workout. */
export type ExportBlock = {
  order: number;
  title: string | null;
  isTest: boolean;
  exercises: ExportExercise[];
};

/**
 * A single workout flattened for a history export: the same session `presentAthleteWorkout`
 * produces, but with structured numeric sets (reps/weight broken out) instead of joined strings,
 * so it serializes cleanly to CSV and JSON. Produced by `presentAthleteWorkoutsExport` in `js`.
 */
export type WorkoutHistoryExport = {
  id: number | null;
  date: string;
  title: string;
  program: string | null;
  team: string | null;
  logged: boolean;
  personal: boolean;
  blocks: ExportBlock[];
};
