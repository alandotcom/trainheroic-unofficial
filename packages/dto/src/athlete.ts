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

function requireUniqueExerciseIds(
  results: readonly { savedWorkoutSetExerciseId: number | string }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  results.forEach((result, index) => {
    const id = String(result.savedWorkoutSetExerciseId).replace(/^0+(?=\d)/u, "");
    if (seen.has(id)) {
      ctx.addIssue({
        code: "custom",
        message: `savedWorkoutSetExerciseId ${id} appears more than once; combine its sets into one result.`,
        path: [index, "savedWorkoutSetExerciseId"],
      });
    }
    seen.add(id);
  });
}

const loggedExerciseResultsSchema = z
  .array(
    z.object({
      savedWorkoutSetExerciseId: idArgSchema,
      sets: z.array(loggedSetWithSlotSchema).min(1),
    }),
  )
  .min(1)
  .superRefine(requireUniqueExerciseIds);

const prescribedExerciseResultsSchema = z
  .array(
    z.object({
      savedWorkoutSetExerciseId: idArgSchema,
      sets: z.array(loggedSetSchema).min(1),
    }),
  )
  .min(1)
  .superRefine(requireUniqueExerciseIds);

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
  results: loggedExerciseResultsSchema,
});
export type LogSetArgs = z.infer<typeof logSetArgsSchema>;

/**
 * Args for the coach "log for athlete" write — the same shape as logSetArgsSchema plus the
 * roster `athleteId` whose set is being logged on their behalf.
 */
export const coachLogSetArgsSchema = logSetArgsSchema.extend({ athleteId: idArgSchema });
export type CoachLogSetArgs = z.infer<typeof coachLogSetArgsSchema>;

/**
 * Args for changing the logged-in athlete's prescribed targets without marking the set performed.
 * The write replaces the exercise's whole prescription, so its sets are positional and sequential
 * by definition: it deliberately omits the log path's `slot` field because a sparse prescription
 * has no meaning here.
 */
export const athletePrescribeSetArgsSchema = z.object({
  date: dateString,
  savedWorkoutSetId: idArgSchema,
  results: prescribedExerciseResultsSchema,
});
export type AthletePrescribeSetArgs = z.infer<typeof athletePrescribeSetArgsSchema>;

/** Coach variant of {@link athletePrescribeSetArgsSchema}, with the roster athlete to update. */
export const coachPrescribeSetArgsSchema = athletePrescribeSetArgsSchema.extend({
  athleteId: idArgSchema,
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

/**
 * Args for the athlete session-note write. `programWorkoutId` is the range item's top-level `id`
 * (athlete_workouts); `date` locates that day so the SDK can resolve the saved-workout id the PUT
 * targets. `notes` is the free-text box on the workout screen (empty string clears it). `rpe` is
 * the session RPE (1–10). At least one of `notes` / `rpe` is required — a notes-only PUT leaves
 * rpe untouched and vice versa.
 */
export const athleteWorkoutNoteObject = z.object({
  date: dateString,
  programWorkoutId: idArgSchema,
  notes: z.string().optional(),
  rpe: z.number().int().min(1).max(10).optional(),
});
export const athleteWorkoutNoteArgsSchema = athleteWorkoutNoteObject.refine(
  (v) => v.notes !== undefined || v.rpe !== undefined,
  { message: "Provide notes and/or rpe" },
);
export type AthleteWorkoutNoteArgs = z.infer<typeof athleteWorkoutNoteArgsSchema>;

/**
 * Args for the athlete per-exercise note write (the "Add exercise note" box on the exercise
 * screen — band color, etc.). `savedWorkoutSetExerciseId` is the slot id from athlete_log_targets.
 * Empty `notes` clears the note. Distinct from {@link athleteWorkoutNoteArgsSchema} (session note).
 */
export const athleteExerciseNoteArgsSchema = z.object({
  savedWorkoutSetExerciseId: idArgSchema,
  notes: z.string(),
});
export type AthleteExerciseNoteArgs = z.infer<typeof athleteExerciseNoteArgsSchema>;

// --- Presented (model-friendly) view schemas, produced by the `js` presenters ---

const presentedNullNumber = z.number().nullable();
const presentedNullString = z.string().nullable();

/** Flattened exercise within a presented workout: prescriptions, logged results, units. */
export const athleteWorkoutExerciseSchema = z.object({
  exerciseId: presentedNullNumber,
  title: z.string(),
  instruction: presentedNullString,
  notes: presentedNullString,
  units: z.array(presentedNullString),
  prescribed: z.array(z.string()),
  performed: z.array(z.string()),
});
export type AthleteWorkoutExercise = z.infer<typeof athleteWorkoutExerciseSchema>;

export const athleteWorkoutBlockSchema = z.object({
  order: z.number(),
  title: presentedNullString,
  instruction: presentedNullString,
  isTest: z.boolean(),
  exercises: z.array(athleteWorkoutExerciseSchema),
});
export type AthleteWorkoutBlock = z.infer<typeof athleteWorkoutBlockSchema>;

export const athleteWorkoutViewSchema = z.object({
  id: presentedNullNumber,
  date: z.string(),
  title: z.string(),
  program: presentedNullString,
  team: presentedNullString,
  instruction: presentedNullString,
  notes: presentedNullString,
  rpe: presentedNullNumber,
  logged: z.boolean(),
  personal: z.boolean(),
  blocks: z.array(athleteWorkoutBlockSchema),
});
export type AthleteWorkoutView = z.infer<typeof athleteWorkoutViewSchema>;

export const athleteWorkoutSummarySchema = z.object({
  id: presentedNullNumber,
  date: z.string(),
  title: z.string(),
  program: presentedNullString,
  team: presentedNullString,
  logged: z.boolean(),
  personal: z.boolean(),
  exerciseCount: z.number().int().nonnegative(),
  performedCount: z.number().int().nonnegative(),
});
export type AthleteWorkoutSummary = z.infer<typeof athleteWorkoutSummarySchema>;

/** Presented views first so a summary/detail row cannot be swallowed by the loose raw list. */
export const athleteWorkoutsOutputSchema = z.union([
  z.array(athleteWorkoutSummarySchema),
  z.array(athleteWorkoutViewSchema),
  programWorkoutListSchema,
]);

export const athleteProfileOutputSchema = z.looseObject({
  summary: athleteProfileSummarySchema,
  user: athleteUserSchema,
});

export const athleteExerciseCatalogOutputSchema = z.array(
  z.object({
    id: z.union([z.number(), z.string()]),
    title: z.string(),
    isCircuit: z.boolean(),
    units: z.array(presentedNullString),
  }),
);

export const coachAthleteExerciseSchema = z.object({
  exerciseId: presentedNullNumber,
  title: z.string(),
  summary: presentedNullString,
  completed: z.boolean(),
});
export type CoachAthleteExercise = z.infer<typeof coachAthleteExerciseSchema>;

export const coachAthleteSessionSchema = z.object({
  workoutId: presentedNullNumber,
  savedWorkoutId: presentedNullNumber,
  title: z.string(),
  logged: z.boolean(),
  completed: z.boolean(),
  rpe: presentedNullNumber,
  durationMin: presentedNullNumber,
  notes: presentedNullString,
  exercises: z.array(coachAthleteExerciseSchema),
});
export type CoachAthleteSession = z.infer<typeof coachAthleteSessionSchema>;

export const coachAthleteTrainingSchema = z.object({
  athleteId: presentedNullNumber,
  athleteName: presentedNullString,
  year: z.number().int(),
  month: z.number().int(),
  sessions: z.array(coachAthleteSessionSchema),
});
export type CoachAthleteTraining = z.infer<typeof coachAthleteTrainingSchema>;
export const coachAthleteTrainingOutputSchema = coachAthleteTrainingSchema;

export const rosterActivityRowSchema = z.object({
  athleteId: z.number(),
  sessionsCount: presentedNullNumber,
  firstLoggedDate: presentedNullString,
  lastLoggedDate: presentedNullString,
  totalReps: presentedNullNumber,
  totalVolume: presentedNullNumber,
});
export type RosterActivityRow = z.infer<typeof rosterActivityRowSchema>;

export const teamVolumeAthleteSchema = z.object({
  athleteId: z.number(),
  name: presentedNullString,
  sessions: z.number(),
  reps: z.number(),
  volume: z.number(),
  firstLoggedDate: presentedNullString,
  lastLoggedDate: presentedNullString,
});
export type TeamVolumeAthlete = z.infer<typeof teamVolumeAthleteSchema>;

export const teamVolumeReportSchema = z.object({
  window: z.object({ start: z.string(), end: z.string() }),
  athletes: z.array(teamVolumeAthleteSchema),
  totals: z.object({
    athletes: z.number(),
    sessions: z.number(),
    reps: z.number(),
    volume: z.number(),
  }),
});
export type TeamVolumeReport = z.infer<typeof teamVolumeReportSchema>;
export const teamVolumeOutputSchema = teamVolumeReportSchema;

export const rosterActivityOutputSchema = z.array(rosterActivityRowSchema);

export const presentedExerciseSessionSchema = z.object({
  date: z.string(),
  abr: presentedNullString,
  notes: presentedNullString,
  estimated1RM: presentedNullNumber,
  sets: z.array(z.object({ setNumber: z.number(), value: presentedNullString })),
});
export type PresentedExerciseSession = z.infer<typeof presentedExerciseSessionSchema>;

export const presentedExerciseHistorySchema = z.object({
  liftPRs: z.array(
    z.object({
      description: presentedNullString,
      reps: presentedNullNumber,
      weight: presentedNullNumber,
      units: presentedNullString,
      date: presentedNullString,
    }),
  ),
  sessions: z.array(presentedExerciseSessionSchema),
});
export type PresentedExerciseHistory = z.infer<typeof presentedExerciseHistorySchema>;

/** Presented history first so the loose raw detail schema cannot swallow it. */
export const exerciseHistoryOutputSchema = z.union([
  presentedExerciseHistorySchema,
  exerciseHistoryDetailSchema,
]);

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
