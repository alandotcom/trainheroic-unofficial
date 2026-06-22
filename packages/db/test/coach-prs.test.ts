import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { CoachAthletePrStore } from "../src/index";
import { applyMigrations, makeSqliteWarehouse } from "../src/sqlite";

// End-to-end proof of the coach PR sync seam on the local node:sqlite adapter: list the roster,
// resolve each athlete's logged main lifts, and persist their best PRs — then read them back. The
// same store runs against D1 in the worker; here it runs against an in-memory SQLite db.

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORG = 7;
const ALAN = 2858055;
const DEMO = 999;

const ROSTER = [
  { id: ALAN, fullName: "Alan Test" },
  { id: DEMO, fullName: "Demo Athlete" },
];

// A minimal logged program-workout: one performed exercise (param_1_made = 1) under its real
// title, in the shape presentAthleteWorkout flattens. The prescription exercise `id` and the saved
// copy's `workout_set_exercise_id` must match so the logged values land on the exercise.
function loggedWorkout(
  workoutId: number,
  exId: number,
  title: string,
  reps: number,
  weight: number,
): unknown {
  const ex = {
    id: 100,
    exercise_id: exId,
    title,
    exercise_title: title,
    param_1_type: 1,
    param_2_type: 3,
    param_1_data_1: String(reps),
    param_2_data_1: String(weight),
  };
  return {
    id: workoutId,
    date: "2026-06-01",
    workout_title: "Day",
    summarizedSavedWorkout: {
      workout: { workoutSets: [{ id: 1, order: 1, workoutSetExercises: [ex] }] },
      saved_workout: {
        id: 5,
        workoutSets: [
          {
            id: 1,
            workout_set_id: 1,
            workoutSetExercises: [
              { ...ex, id: 200, workout_set_exercise_id: 100, param_1_made: 1 },
            ],
          },
        ],
      },
    },
  };
}

const ALAN_WORKOUTS = [
  loggedWorkout(1, 1, "Back Squat", 5, 225),
  loggedWorkout(2, 424, "Deadlift", 5, 315),
];

const HISTORY: Record<number, unknown> = {
  1: { liftPRs: [{ weight: 335, reps: 3, dateCompleted: "2026-06-01" }], history: [] },
  424: { liftPRs: [{ weight: 405, reps: 1, dateCompleted: "2026-06-10" }], history: [] },
};

function stub(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
      if (url.includes("/v5/athletes")) return json(ROSTER);
      const range = url.match(/\/programworkout\/range\/(\d+)/u);
      if (range) return json(Number(range[1]) === ALAN ? ALAN_WORKOUTS : []);
      const hist = url.match(/\/v5\/exercises\/(\d+)\/history/u);
      if (hist) return json(HISTORY[Number(hist[1])] ?? { liftPRs: [], history: [] });
      return json({});
    }),
  );
}

function store(): CoachAthletePrStore {
  const sqlite = new DatabaseSync(":memory:");
  applyMigrations(sqlite);
  return new CoachAthletePrStore(
    makeSqliteWarehouse(sqlite),
    new TrainHeroicClient("a@b.com", "pw"),
    ORG,
  );
}

describe("CoachAthletePrStore.sync", () => {
  it("syncs the roster's main-lift PRs into the local store and reads them back", async () => {
    stub();
    const s = store();

    const result = await s.sync({ months: 1, now: new Date("2026-06-22T00:00:00Z") });
    expect(result.athletes).toBe(2);
    // Alan logged squat + deadlift (two rows); the demo athlete logged nothing (zero rows).
    expect(result.rows).toBe(2);
    expect(result.syncedAt).toBeGreaterThan(0);

    const rows = await s.read();
    expect(rows).toHaveLength(2);
    const squat = rows.find((r) => r.family === "squat");
    expect(squat).toMatchObject({
      athleteId: ALAN,
      athleteName: "Alan Test",
      exerciseId: 1,
      exerciseTitle: "Back Squat",
      weight: 335,
      reps: 3,
    });
    const deadlift = rows.find((r) => r.family === "deadlift");
    expect(deadlift).toMatchObject({ athleteId: ALAN, weight: 405, reps: 1 });

    expect(await s.lastSynced()).toBe(result.syncedAt);
  });

  it("replaces an athlete's rows on re-sync (no stale duplicates)", async () => {
    stub();
    const s = store();
    await s.sync({ months: 1, now: new Date("2026-06-22T00:00:00Z") });
    await s.sync({ months: 1, now: new Date("2026-06-22T00:00:00Z") });
    // The per-athlete delete-then-reinsert keeps the board at two rows, not four.
    expect(await s.read()).toHaveLength(2);
  });
});
