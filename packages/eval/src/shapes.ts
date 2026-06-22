// Typed builders for the raw TrainHeroic API response shapes the fake backend serves. One place per
// shape, so they are not duplicated across datasets/history/backend (the calendar-session and
// saved-workout shapes were previously hand-built in two files each) and so other tests can reuse
// them. The shapes mirror the loose, passthrough responses the SDK reads — the field names match
// what packages/js/src/athlete.ts and the dto schemas key on.

const SESSION_TOKEN = "s".repeat(48);

/** POST /auth */
export function authResponse(
  opts: { id?: number; scope?: string; role?: string } = {},
): Record<string, unknown> {
  return {
    id: opts.id ?? 700000,
    session_id: SESSION_TOKEN,
    scope: opts.scope ?? "coach",
    role: opts.role ?? "coach",
  };
}

/** GET /v5/headCoach */
export function headCoach(orgId = 4242): Record<string, unknown> {
  return { id: 700000, org_id: orgId, license: "active", trial: false };
}

/** GET /v5/notifications/counts */
export function notificationCounts(): Record<string, unknown> {
  return { countMessagingNotViewed: 0, countNotificationsNotViewed: 0 };
}

/** GET /user/simple — the authenticated account (coach or athlete). */
export function userSimple(opts: {
  id: number;
  roles?: string[];
  orgId?: number;
  nameFirst?: string;
  nameLast?: string;
}): Record<string, unknown> {
  return {
    id: opts.id,
    org_id: opts.orgId ?? 4242,
    name_first: opts.nameFirst ?? "User",
    name_last: opts.nameLast ?? "Account",
    roles: opts.roles ?? ["coach"],
  };
}

/** One exercise in a calendar-summary session row, with its set summary string (`abr`). */
export type SessionExerciseSummary = {
  exerciseId: number;
  title: string;
  abr: string;
  completed?: boolean;
};

/**
 * One `/2.0/coach/athlete/calendar/summary` row — a logged session. Built here so the synthetic
 * monthly calendar (datasets) and the real-corpus calendar (history) share one shape.
 */
export function calendarSession(opts: {
  athleteName: string;
  workoutId: number;
  savedWorkoutId: number;
  workoutTitle: string;
  exercises: SessionExerciseSummary[];
  rpe?: number;
  durationMin?: number;
  notes?: string;
}): Record<string, unknown> {
  return {
    athleteName: opts.athleteName,
    workout_id: opts.workoutId,
    saved_workout_id: opts.savedWorkoutId,
    workout_title: opts.workoutTitle,
    logged: 1,
    completed: 1,
    rpe: opts.rpe ?? 7,
    session_duration: opts.durationMin ?? 55,
    notes: opts.notes ?? "",
    sets: [
      {
        exercises: opts.exercises.map((e) => ({
          exercise_id: e.exerciseId,
          title: e.title,
          abr: e.abr,
          completed: e.completed === false ? 0 : 1,
        })),
      },
    ],
  };
}

/** A per-set prescription/result slot (param_N_data) inside a workoutSetExercise. */
export type ParamSlot = { reps?: string; weight?: string };

/** One `workoutSetExercises[]` entry — carries the savedWorkoutSetExerciseId (`id`) + param slots. */
export function workoutSetExercise(opts: {
  id: number;
  exerciseId: number;
  title: string;
  instruction?: string;
  sets: ParamSlot[];
}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: opts.id,
    exercise_id: opts.exerciseId,
    exercise_title: opts.title,
    title: opts.title,
    param_1_type: "reps",
    param_2_type: "lb",
    instruction: opts.instruction ?? "",
  };
  opts.sets.forEach((s, i) => {
    row[`param_1_data_${i + 1}`] = s.reps ?? "";
    row[`param_2_data_${i + 1}`] = s.weight ?? "";
  });
  return row;
}

/**
 * One `/3.0/coach/athlete/programworkout/range` (or athlete range) item — a scheduled workout with
 * its saved copy, carrying program/team identity and the saved-set ids logging needs. Built here so
 * the high-enrollment dataset and any range-based fixture share one shape.
 */
export function programWorkout(opts: {
  id: number;
  date: string;
  workoutTitle: string;
  programId: number;
  programTitle: string;
  teamId: number;
  savedWorkoutId: number;
  savedWorkoutSetId: number;
  setTitle?: string;
  exercises: Array<Parameters<typeof workoutSetExercise>[0]>;
}): Record<string, unknown> {
  return {
    id: opts.id,
    date: opts.date,
    workout_title: opts.workoutTitle,
    program_id: opts.programId,
    program_title: opts.programTitle,
    team_id: opts.teamId,
    team_title: opts.programTitle,
    summarizedSavedWorkout: {
      saved_workout: {
        id: opts.savedWorkoutId,
        workoutSets: [
          {
            id: opts.savedWorkoutSetId,
            title: opts.setTitle ?? "Main",
            order: 0,
            workoutSetExercises: opts.exercises.map(workoutSetExercise),
          },
        ],
      },
    },
  };
}

/** GET /v5/athleteProfile/summary — all-time training totals. */
export function profileSummary(opts: {
  userId: number;
  sessions: number;
  firstDate: string;
  lastDate: string;
  reps?: number;
  volume?: number;
}): Record<string, unknown> {
  return {
    user_id: opts.userId,
    sessions_count: opts.sessions,
    first_logged_date: opts.sessions > 0 ? opts.firstDate : "1970-01-01",
    last_logged_date: opts.sessions > 0 ? opts.lastDate : "1970-01-01",
    reps_sum: opts.reps ?? opts.sessions * 120,
    volume_sum: opts.volume ?? opts.sessions * 14500,
  };
}

/** One `/v5/exerciseLibrary/all` row (also the athlete exercise-list shape, with extra fields). */
export function libraryExercise(id: number, title: string): Record<string, unknown> {
  return { id, title, param_1_type: 1, param_2_type: 2 };
}

/** One dated session in a `/v5/exercises/{id}/history` series. */
export function historyEntry(opts: {
  date: string;
  reps: number;
  weight: number;
}): Record<string, unknown> {
  return {
    dateCompleted: opts.date,
    abr: `${opts.reps} x ${opts.weight} lb`,
    bestEstimated1RM: Math.round(opts.weight * (1 + opts.reps / 30)),
    sets: [{ setNumber: 1, formattedValue: `${opts.reps} @ ${opts.weight} lb` }],
  };
}

/** A `/v5/exercises/{id}/history` → liftPRs[] row. */
export function liftPR(opts: {
  description: string;
  reps: number;
  weight: number;
  date: string;
}): Record<string, unknown> {
  return {
    description: opts.description,
    reps: opts.reps,
    weight: opts.weight,
    dateCompleted: opts.date,
    units: "lb",
  };
}
