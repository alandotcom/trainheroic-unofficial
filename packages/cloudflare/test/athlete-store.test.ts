import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema1 from "../../db/migrations/0001_init.sql?raw";
import schema3 from "../../db/migrations/0003_athlete.sql?raw";
import schema4 from "../../db/migrations/0004_athlete_performed.sql?raw";
import { AthleteTrainingStore, AthleteWorkoutStore } from "@trainheroic-unofficial/db";
import { makeD1Warehouse } from "@trainheroic-unofficial/db/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { observeD1Queries } from "./d1-query-observer";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function statements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const USER = 42;
const WORKOUT = {
  id: 555,
  date: "2026-06-02",
  workout_title: "Day 1",
  program_id: 7,
  program_title: "Prog",
  team_id: 10,
  team_title: "Team",
  summarizedSavedWorkout: {
    workout: {
      title: "Day 1",
      instruction: "session note",
      workoutSets: [
        {
          id: 1,
          title: "Primary",
          order: 1,
          instruction: "warm up",
          is_test: 0,
          type: 4,
          workoutSetExercises: [
            {
              id: 100,
              exercise_id: 1,
              title: "Back Squat",
              instruction: "heavy",
              param_1_type: 3,
              param_2_type: 1,
              param_1_data_1: "5",
              param_2_data_1: "185",
              param_1_data_2: "5",
              param_2_data_2: "205",
            },
          ],
        },
      ],
    },
    saved_workout: {
      id: 9001,
      completed: 0,
      workoutSets: [
        {
          id: 9002,
          order: 1,
          title: "Primary",
          workoutSetExercises: [
            {
              id: 9003,
              workout_set_exercise_id: 100,
              exercise_id: 1,
              exercise_title: "Back Squat",
              param_1_type: 3,
              param_2_type: 1,
              param_1_data_1: "5",
              param_2_data_1: "190",
              param_1_made: 1,
            },
          ],
        },
      ],
    },
  },
};
const CATALOG = [{ id: 1, title: "Back Squat", param1Type: 3, param2Type: 1, isCircuit: false }];
const DETAIL = {
  liftPRs: [
    {
      weight: 225,
      reps: 1,
      description: "1 Rep Max",
      dateCompleted: "2026-01-01",
      savedWorkoutSetExerciseId: 99,
      units: "lb",
    },
  ],
  history: [
    {
      dateCompleted: "2026-06-02",
      savedWorkoutSetExerciseId: 99,
      abr: "5 @ 185",
      bestEstimated1RM: 208,
      programWorkoutId: 555,
      teamId: 10,
      sets: [],
    },
  ],
};
const WORKING_MAX = [
  {
    exercise_id: 1,
    title: "Back Squat",
    param_type: 3,
    value: 225,
    type_suffix: "lb",
    working_max_id: 1,
  },
];

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/auth")) return json({ id: USER, session_id: "sess" });
      if (url.includes("/3.0/athlete/programworkout/range")) return json([WORKOUT]);
      if (url.includes("/v5/users/exercises/history")) return json(CATALOG);
      if (url.includes("/v5/exercises/1/history")) return json(DETAIL);
      if (url.includes("/2.0/athlete/workingMax")) return json(WORKING_MAX);
      return json({});
    }),
  );
}

const client = (): TrainHeroicClient => new TrainHeroicClient("a@b.com", "pw");

beforeEach(async () => {
  // The test D1 persists across beforeEach runs. CREATE TABLE IF NOT EXISTS is idempotent, but
  // 0004's ALTER TABLE ADD COLUMN is not — re-applying it raises "duplicate column", which is
  // the already-migrated state we want, so swallow just that.
  for (const s of [...statements(schema1), ...statements(schema3), ...statements(schema4)]) {
    try {
      await env.TH_DB.prepare(s).run();
    } catch (e) {
      if (!String(e).includes("duplicate column")) throw e;
    }
  }
  await env.TH_DB.batch(
    [
      "athlete_workout",
      "athlete_workout_exercise",
      "athlete_exercise",
      "athlete_exercise_session",
      "athlete_pr",
      "athlete_working_max",
      "athlete_sync_state",
    ].map((t) => env.TH_DB.prepare(`DELETE FROM ${t}`)),
  );
  stubApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AthleteWorkoutStore", () => {
  it("syncs a window into workouts + flattened exercise rows, then reads them", async () => {
    const store = new AthleteWorkoutStore(makeD1Warehouse(env.TH_DB), client(), USER);
    const result = await store.sync("2026-06-01", "2026-06-07");
    expect(result).toMatchObject({ workouts: 1, exercises: 1 });

    const list = (await store.list()) as Array<{ id: number; title: string; logged: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("Day 1");
    expect(list[0]?.logged).toBe(true);

    const rows = (await store.workoutExercises(555)) as Array<{
      title: string;
      prescribed: unknown;
      performed: unknown;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Back Squat");
    expect(rows[0]?.prescribed).toEqual(["5 @ 185", "5 @ 205"]);
    // Only the made-gated set is performed (190, not the prescription's 185/205).
    expect(rows[0]?.performed).toEqual(["5 @ 190"]);
  });

  it("is idempotent: re-sync rebuilds exercise rows without duplicating", async () => {
    const store = new AthleteWorkoutStore(makeD1Warehouse(env.TH_DB), client(), USER);
    await store.sync("2026-06-01", "2026-06-07");
    await store.sync("2026-06-01", "2026-06-07");
    expect((await store.workoutExercises(555)).length).toBe(1);
  });
});

describe("AthleteTrainingStore", () => {
  it("syncs catalog, working maxes, and per-exercise sessions + PRs", async () => {
    const store = new AthleteTrainingStore(makeD1Warehouse(env.TH_DB), client(), USER);
    expect(await store.syncCatalog()).toBe(1);
    expect(await store.syncWorkingMaxes()).toBe(1);

    const batch = await store.syncNextBatch(10);
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ exerciseId: 1, sessions: 1, prs: 1 });
    expect(await store.unsyncedCount()).toBe(0);

    expect((await store.searchCatalog("squat", 10)).length).toBe(1);
    expect((await store.sessions(1, 10)).length).toBe(1);
    expect((await store.prs(1)).length).toBe(1);
    expect((await store.workingMaxes()).length).toBe(1);
  });

  it("drains the batch queue incrementally and re-pulls on full reset", async () => {
    const store = new AthleteTrainingStore(makeD1Warehouse(env.TH_DB), client(), USER);
    await store.syncCatalog();
    await store.syncNextBatch(10);
    // Watermark set, so a second batch syncs nothing.
    expect(await store.syncNextBatch(10)).toHaveLength(0);
    await store.resetSessionsWatermark();
    expect(await store.unsyncedCount()).toBe(1);
    // Re-sync rebuilds PRs (delete+reinsert), not duplicating them.
    await store.syncNextBatch(10);
    expect((await store.prs(1)).length).toBe(1);
  });

  it("refreshes reference data once while draining history across calls", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requests.push(url);
        if (url.endsWith("/auth")) return json({ id: USER, session_id: "sess" });
        if (url.includes("/v5/users/exercises/history")) {
          return json([
            ...CATALOG,
            { id: 2, title: "Bench Press", param1Type: 3, param2Type: 1, isCircuit: false },
          ]);
        }
        if (url.includes("/v5/exercises/") && url.includes("/history")) return json(DETAIL);
        if (url.includes("/2.0/athlete/workingMax")) return json(WORKING_MAX);
        return json({});
      }),
    );

    const store = new AthleteTrainingStore(makeD1Warehouse(env.TH_DB), client(), USER);
    const first = await store.syncBatch({ batchSize: 1 });
    const second = await store.syncBatch({ batchSize: 1 });

    expect(first).toMatchObject({ catalog: 2, workingMaxes: 1, exercisesSynced: 1, remaining: 1 });
    expect(second).toMatchObject({ catalog: 0, workingMaxes: 0, exercisesSynced: 1, remaining: 0 });
    expect(requests.filter((url) => url.includes("/v5/users/exercises/history"))).toHaveLength(1);
    expect(requests.filter((url) => url.includes("/2.0/athlete/workingMax"))).toHaveLength(1);
  });

  it("writes bulk training rows in bounded multi-row statements", async () => {
    const catalog = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      title: `Exercise ${index + 1}`,
      param1Type: 3,
      param2Type: 1,
      isCircuit: false,
    }));
    const detail = {
      liftPRs: Array.from({ length: 25 }, (_, index) => ({
        ...DETAIL.liftPRs[0],
        reps: index + 1,
        savedWorkoutSetExerciseId: 1_000 + index,
      })),
      history: Array.from({ length: 25 }, (_, index) => ({
        ...DETAIL.history[0],
        dateCompleted: `2026-06-${String(index + 1).padStart(2, "0")}`,
        savedWorkoutSetExerciseId: 1_000 + index,
      })),
    };
    const maxes = catalog.map((exercise) => ({
      ...WORKING_MAX[0],
      exercise_id: exercise.id,
      title: exercise.title,
      working_max_id: exercise.id,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: USER, session_id: "sess" });
        if (url.includes("/v5/users/exercises/history")) return json(catalog);
        if (url.includes("/v5/exercises/1/history")) return json(detail);
        if (url.includes("/2.0/athlete/workingMax")) return json(maxes);
        return json({});
      }),
    );

    const observed = observeD1Queries(env.TH_DB);
    const store = new AthleteTrainingStore(makeD1Warehouse(observed.database), client(), USER);

    expect(await store.syncCatalog()).toBe(25);
    expect(await store.syncWorkingMaxes()).toBe(25);
    expect(await store.syncExercise(1)).toMatchObject({ sessions: 25, prs: 25 });
    expect(await store.sessions(1, 100)).toHaveLength(25);
    expect(await store.prs(1)).toHaveLength(25);
    expect(await store.workingMaxes()).toHaveLength(25);

    const insertCount = (table: string) =>
      observed.queries.filter((query) => query.toLowerCase().startsWith(`insert into "${table}"`))
        .length;
    expect(insertCount("athlete_exercise")).toBe(3);
    expect(insertCount("athlete_working_max")).toBe(3);
    expect(insertCount("athlete_pr")).toBe(3);
    expect(insertCount("athlete_exercise_session")).toBe(3);
  });
});
