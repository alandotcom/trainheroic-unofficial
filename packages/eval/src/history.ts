// Serve a real 2-year training corpus through the raw API shapes the SDK reads. The fixture
// (fixtures/history-2yr.json) is a prescribed-program EXPORT — 1192 dated workouts, ~839 distinct
// exercises, no PII — so it gives the history-pulling tools (athlete_training month calendars,
// athlete_lift_history per-exercise series) far more realistic depth than the synthetic builders.
//
// The export carries prescribed reps only (no performed weights), so:
//  - athlete_training (the month calendar) is served faithfully: real titles, real exercises, an
//    `abr` set-summary synthesized from the prescribed reps.
//  - athlete_lift_history's PR board + dated series is SYNTHESIZED with a deterministic, gently
//    progressive weight per exercise, so a "how has my <lift> trended" question has something to
//    read. Weights are fabricated; the dates and exercise names are real.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ExportExercise = {
  exercise: string;
  instruction?: string;
  prescribed?: string[];
  groupTitle?: string;
};
export type ExportWorkout = {
  date: string;
  title?: string;
  workoutInstruction?: string;
  exercises?: ExportExercise[];
};

const EXERCISE_ID_BASE = 910000;

let cache: {
  workouts: ExportWorkout[];
  exerciseIdByName: Map<string, number>;
  nameById: Map<number, string>;
  byMonth: Map<string, ExportWorkout[]>;
} | null = null;

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function load(): NonNullable<typeof cache> {
  if (cache) return cache;
  const path = join(import.meta.dirname, "../fixtures/history-2yr.json");
  const workouts = JSON.parse(readFileSync(path, "utf8")) as ExportWorkout[];

  // Stable id per distinct exercise name (sorted, so ids are deterministic across runs).
  const names = [
    ...new Set(workouts.flatMap((w) => (w.exercises ?? []).map((e) => e.exercise))),
  ].sort();
  const exerciseIdByName = new Map<string, number>();
  const nameById = new Map<number, string>();
  names.forEach((name, i) => {
    const id = EXERCISE_ID_BASE + i;
    exerciseIdByName.set(name, id);
    nameById.set(id, name);
  });

  const byMonth = new Map<string, ExportWorkout[]>();
  for (const w of workouts) {
    const [y, m] = w.date.split("-");
    if (!y || !m) continue;
    const key = `${y}-${m}`;
    const list = byMonth.get(key) ?? [];
    list.push(w);
    byMonth.set(key, list);
  }

  cache = { workouts, exerciseIdByName, nameById, byMonth };
  return cache;
}

/** A readable set summary from prescribed reps, e.g. ["5","5","5"] → "3 x 5". */
function abr(prescribed: string[] | undefined): string {
  const reps = (prescribed ?? []).filter((r) => r.trim().length > 0);
  if (reps.length === 0) return "";
  const allSame = reps.every((r) => r === reps[0]);
  return allSame ? `${reps.length} x ${reps[0]}` : reps.join(", ");
}

/** Deterministic, gently progressive synthetic weight (lb) for an exercise on the n-th session. */
function synthWeight(exerciseId: number, sessionIndex: number): number {
  // Base 95–200 lb spread across exercises, plus 5 lb each subsequent session (a gentle trend).
  const base = 95 + (exerciseId % 8) * 15;
  return base + sessionIndex * 5;
}

export type HistoryCorpus = {
  athleteName: string;
  /** Total dated workouts in the corpus. */
  sessionCount: number;
  /** Distinct exercise count. */
  exerciseCount: number;
  /** Inclusive date bounds (YYYY-MM-DD). */
  firstDate: string;
  lastDate: string;
  /** A well-populated exercise to target in scenarios (id + name + how many sessions it appears in). */
  topExercise: { id: number; name: string; sessions: number };
  /** Raw `/2.0/coach/athlete/calendar/summary` rows for one month. */
  getCalendarSummary: (year: number, month: number) => unknown[];
  /** Raw `/v5/exercises/{id}/history` — PR board + dated series for one exercise. */
  getExerciseHistory: (exerciseId: number) => unknown;
  /** The corpus exercises as an `/v5/exerciseLibrary/all` catalog (so resolve/search find them). */
  exerciseLibrary: Array<Record<string, unknown>>;
};

function buildCalendarSummary(
  c: NonNullable<typeof cache>,
  athleteName: string,
  year: number,
  month: number,
): unknown[] {
  const workouts = c.byMonth.get(monthKey(year, month)) ?? [];
  return workouts.map((w, i) => ({
    athleteName,
    workout_id: Number(`${year}${String(month).padStart(2, "0")}${String(i).padStart(2, "0")}`),
    saved_workout_id: 148000000 + i,
    workout_title: w.title ?? "Session",
    logged: 1,
    completed: 1,
    rpe: 7,
    session_duration: 55,
    notes: w.workoutInstruction ?? "",
    sets: [
      {
        exercises: (w.exercises ?? []).map((e) => ({
          exercise_id: c.exerciseIdByName.get(e.exercise) ?? 0,
          title: e.exercise,
          abr: abr(e.prescribed),
          completed: 1,
        })),
      },
    ],
  }));
}

function buildExerciseHistory(c: NonNullable<typeof cache>, exerciseId: number): unknown {
  const name = c.nameById.get(exerciseId);
  if (name === undefined) return { liftPRs: [], history: [] };
  // Every dated session this exercise appears in, oldest first.
  const dated = c.workouts
    .filter((w) => (w.exercises ?? []).some((e) => e.exercise === name))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const history = dated.map((w, i) => {
    const ex = (w.exercises ?? []).find((e) => e.exercise === name);
    const reps = Number((ex?.prescribed ?? [])[0] ?? 5) || 5;
    const weight = synthWeight(exerciseId, i);
    return {
      dateCompleted: w.date,
      abr: `${reps} x ${weight} lb`,
      bestEstimated1RM: Math.round(weight * (1 + reps / 30)),
      sets: [{ setNumber: 1, formattedValue: `${reps} @ ${weight} lb` }],
    };
  });

  // The PR board: the heaviest (latest, since weights progress) session.
  const last = history.at(-1);
  const lastWorkout = dated.at(-1);
  const liftPRs = last
    ? [
        {
          description: "Heaviest",
          reps:
            Number(
              (lastWorkout?.exercises?.find((e) => e.exercise === name)?.prescribed ?? [])[0] ?? 5,
            ) || 5,
          weight: synthWeight(exerciseId, history.length - 1),
          dateCompleted: last.dateCompleted,
          units: "lb",
        },
      ]
    : [];
  return { liftPRs, history };
}

/** Load (and cache) the 2-year corpus, with per-month and per-exercise raw views for the backend. */
export function historyCorpus(athleteName: string): HistoryCorpus {
  const c = load();
  const dates = c.workouts.map((w) => w.date).sort();

  // The exercise appearing in the most distinct sessions — a good "trend" target. Counted per
  // workout (not per row), so it matches the dated series getExerciseHistory builds.
  const counts = new Map<string, number>();
  for (const w of c.workouts) {
    const seen = new Set((w.exercises ?? []).map((e) => e.exercise));
    for (const name of seen) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let topName = "";
  let topCount = 0;
  for (const [name, n] of counts) {
    if (n > topCount) {
      topCount = n;
      topName = name;
    }
  }

  return {
    athleteName,
    sessionCount: c.workouts.length,
    exerciseCount: c.exerciseIdByName.size,
    firstDate: dates[0] ?? "",
    lastDate: dates.at(-1) ?? "",
    topExercise: { id: c.exerciseIdByName.get(topName) ?? 0, name: topName, sessions: topCount },
    getCalendarSummary: (year, month) => buildCalendarSummary(c, athleteName, year, month),
    getExerciseHistory: (exerciseId) => buildExerciseHistory(c, exerciseId),
    exerciseLibrary: [...c.exerciseIdByName].map(([title, id]) => ({
      id,
      title,
      param_1_type: 1,
      param_2_type: 2,
    })),
  };
}
