import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dateWindows,
  fetchAthleteWorkoutsChunked,
  mergeWorkoutsById,
  presentAthleteWorkout,
  presentAthleteWorkoutExport,
  presentAthleteWorkoutsExport,
} from "../src/athlete";
import { TrainHeroicClient } from "../src/client";
import {
  serializeWorkoutHistory,
  workoutsToCsv,
  workoutsToJson,
  workoutsToText,
} from "../src/workout-export";
import type { ProgramWorkout, WorkoutHistoryExport } from "@trainheroic-unofficial/dto";

const json = (obj: unknown, status = 200): Response =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")) as T;

const exported = presentAthleteWorkoutsExport([fixture<ProgramWorkout>("program-workout.json")]);
const findExercise = (list: WorkoutHistoryExport[], title: string) =>
  list
    .flatMap((w) => w.blocks)
    .flatMap((b) => b.exercises)
    .find((e) => e.title === title);

describe("presentAthleteWorkoutsExport", () => {
  it("carries workout metadata and the logged flag", () => {
    const [w] = exported;
    expect(w?.date).toBe("2026-06-01");
    expect(w?.program).toBe("Bodybuilding 202");
    expect(w?.logged).toBe(true);
  });

  it("breaks reps and weight out of the two positional slots by unit", () => {
    const squat = findExercise(exported, "Back Squat");
    expect(squat?.units).toEqual(["reps", "lb"]);
    expect(squat?.sets).toHaveLength(4);
    const first = squat?.sets[0];
    // Prescription programmed reps only (no weight); the athlete logged 3 @ 275.
    expect(first?.prescribed?.reps).toBe(3);
    expect(first?.prescribed?.weight).toBeNull();
    expect(first?.performed?.reps).toBe(3);
    expect(first?.performed?.weight).toBe(275);
    expect(first?.performed?.weightUnit).toBe("lb");
    expect(first?.performed?.display).toBe("3 @ 275");
    expect(squat?.sets[2]?.performed?.weight).toBe(295);
  });

  it("does not treat prescription pre-fill (made=0) as performed", () => {
    const split = findExercise(exported, "Front Foot Elevated Split Squat");
    expect(split?.sets.length).toBeGreaterThan(0);
    expect(split?.sets.every((s) => s.performed === null)).toBe(true);
    expect(split?.sets.some((s) => s.prescribed !== null)).toBe(true);
  });

  it("appends athlete-added work with no prescription and keeps its raw value when the unit is unknown", () => {
    const bike = findExercise(exported, "Assault Bike");
    expect(bike).toBeDefined();
    const set = bike?.sets[0];
    expect(set?.prescribed).toBeNull();
    // param_1_type 8 has no unit label, so reps/weight stay null but the display keeps "12".
    expect(set?.performed?.reps).toBeNull();
    expect(set?.performed?.display).toBe("12");
  });
});

describe("workoutsToCsv", () => {
  it("emits a header and one row per set with reps/weight columns", () => {
    const csv = workoutsToCsv(exported);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "date,program,team,workout,block,exercise,set,prescribed_reps,prescribed_weight,performed_reps,performed_weight,weight_unit,prescribed,performed",
    );
    const squatRow = lines.find((l) => l.includes("Back Squat") && l.endsWith(",3 @ 275"));
    expect(squatRow).toBeDefined();
    // date, program, team, workout, block, exercise, set, p_reps, p_wt, perf_reps, perf_wt, unit...
    expect(squatRow).toContain("2026-06-01,Bodybuilding 202,Bodybuilding 202,");
    expect(squatRow).toContain(",Back Squat,1,3,,3,275,lb,3,3 @ 275");
  });

  it("quotes cells containing commas, quotes, or newlines", () => {
    const synthetic: WorkoutHistoryExport[] = [
      {
        id: 1,
        date: "2026-06-01",
        title: 'Leg Day, "heavy"',
        program: "A\nB",
        team: null,
        logged: true,
        personal: false,
        blocks: [
          {
            order: 1,
            title: null,
            isTest: false,
            exercises: [
              {
                exerciseId: 1,
                title: "Squat",
                units: ["reps", "lb"],
                sets: [
                  {
                    set: 1,
                    prescribed: null,
                    performed: {
                      reps: 5,
                      weight: 225,
                      weightUnit: "lb",
                      params: [],
                      display: "5 @ 225",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const csv = workoutsToCsv(synthetic);
    expect(csv).toContain('"Leg Day, ""heavy"""');
    expect(csv).toContain('"A\nB"');
  });

  it("neutralizes spreadsheet formula injection in text cells but leaves numbers intact", () => {
    const synthetic: WorkoutHistoryExport[] = [
      {
        id: 1,
        date: "2026-06-01",
        title: "=HYPERLINK(0)",
        program: "@SUM(1)",
        team: null,
        logged: true,
        personal: false,
        blocks: [
          {
            order: 1,
            title: null,
            isTest: false,
            exercises: [
              {
                exerciseId: 1,
                title: "Squat",
                units: ["reps", "lb"],
                sets: [
                  {
                    set: 1,
                    prescribed: null,
                    performed: {
                      reps: 5,
                      weight: 225,
                      weightUnit: "lb",
                      params: [],
                      display: "5 @ 225",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const row = workoutsToCsv(synthetic).trimEnd().split("\r\n")[1] ?? "";
    // Leading =/@ get a single-quote prefix; the numeric reps/weight (5, 225) are untouched.
    expect(row).toContain("'=HYPERLINK(0)");
    expect(row).toContain("'@SUM(1)");
    expect(row).toContain(",Squat,1,,,5,225,lb,,5 @ 225");
  });
});

describe("workoutsToText", () => {
  it("renders a readable session with performed and planned values", () => {
    const text = workoutsToText(exported);
    expect(text).toContain("2026-06-01");
    expect(text).toContain("Back Squat (reps, lb)");
    expect(text).toContain("3 @ 275");
    expect(text).toContain("(planned 3)");
  });
});

describe("workoutsToJson", () => {
  it("round-trips the structured export", () => {
    const parsed = JSON.parse(workoutsToJson(exported)) as WorkoutHistoryExport[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.date).toBe("2026-06-01");
  });
});

describe("dateWindows", () => {
  it("splits a range into consecutive, non-overlapping, gap-free windows", () => {
    const windows = dateWindows("2026-01-01", "2026-12-31", 180);
    expect(windows[0]).toEqual({ start: "2026-01-01", end: "2026-06-29" });
    // Each window starts the day after the previous ends — no overlap, no gap.
    for (let i = 1; i < windows.length; i += 1) {
      const prevEnd = new Date(`${windows.at(i - 1)?.end}T00:00:00Z`);
      const thisStart = new Date(`${windows.at(i)?.start}T00:00:00Z`);
      expect(thisStart.getTime() - prevEnd.getTime()).toBe(86_400_000);
    }
    expect(windows.at(-1)?.end).toBe("2026-12-31");
  });

  it("returns a single window when the range fits", () => {
    expect(dateWindows("2026-06-01", "2026-06-15", 180)).toEqual([
      { start: "2026-06-01", end: "2026-06-15" },
    ]);
  });

  it("handles a start after end without looping", () => {
    expect(dateWindows("2026-06-15", "2026-06-01", 180)).toEqual([]);
  });
});

describe("serializeWorkoutHistory", () => {
  it("dispatches format to content-type, extension, and filename", () => {
    expect(serializeWorkoutHistory(exported, "json").contentType).toBe("application/json");
    expect(serializeWorkoutHistory(exported, "csv").extension).toBe("csv");
    expect(serializeWorkoutHistory(exported, "text").filename).toBe(
      "trainheroic-workout-history.txt",
    );
    expect(serializeWorkoutHistory(exported, "csv", { filenameBase: "mine" }).filename).toBe(
      "mine.csv",
    );
  });

  it("serializes an empty history without a workout", () => {
    expect(workoutsToCsv([])).toBe(
      "date,program,team,workout,block,exercise,set,prescribed_reps,prescribed_weight," +
        "performed_reps,performed_weight,weight_unit,prescribed,performed\r\n",
    );
    expect(workoutsToText([])).toContain("0 sessions");
    expect(JSON.parse(workoutsToJson([]))).toEqual([]);
    expect(serializeWorkoutHistory([], "json").content).toBe("[]");
  });
});

// The string presenter (`presentAthleteWorkout`) and the export presenter now derive from one
// merge (`mergeAthleteWorkout`). This pins that they cannot silently diverge: a change to either
// projector that drifts block order, exercise identity, set membership, or the display strings
// fails here.
describe("string and export presenters agree", () => {
  const raw = fixture<ProgramWorkout>("program-workout.json");
  const s = presentAthleteWorkout(raw);
  const e = presentAthleteWorkoutExport(raw);

  it("agree on workout metadata and the logged flag", () => {
    expect(e.id).toBe(s.id);
    expect(e.date).toBe(s.date);
    expect(e.title).toBe(s.title);
    expect(e.program).toBe(s.program);
    expect(e.team).toBe(s.team);
    expect(e.logged).toBe(s.logged);
    expect(e.personal).toBe(s.personal);
  });

  it("agree on block order, exercise identity, and every set's prescribed/performed", () => {
    expect(e.blocks.map((b) => b.order)).toEqual(s.blocks.map((b) => b.order));
    expect(e.blocks).toHaveLength(s.blocks.length);
    s.blocks.forEach((sb, i) => {
      const eb = e.blocks[i];
      expect(eb?.title).toBe(sb.title);
      expect(eb?.isTest).toBe(sb.isTest);
      expect(eb?.exercises.map((x) => x.title)).toEqual(sb.exercises.map((x) => x.title));
      expect(eb?.exercises.map((x) => x.exerciseId)).toEqual(sb.exercises.map((x) => x.exerciseId));
      sb.exercises.forEach((se, j) => {
        const ee = eb?.exercises[j];
        const displays = (side: "prescribed" | "performed") =>
          (ee?.sets ?? [])
            .map((set) => set[side]?.display)
            .filter((d): d is string => d !== undefined && d !== "");
        // The string view's joined arrays are exactly the export sets' displays.
        expect(displays("prescribed")).toEqual(se.prescribed);
        expect(displays("performed")).toEqual(se.performed);
      });
    });
  });
});

describe("presentAthleteWorkoutsExport (merge dedup direction)", () => {
  it("keeps a prescribed-and-logged exercise in its prescription block only, never doubled", () => {
    const squats = exported
      .flatMap((w) => w.blocks)
      .flatMap((b) => b.exercises)
      .filter((ex) => ex.title === "Back Squat");
    expect(squats).toHaveLength(1);
    // ...and it carries its logged sets (the merge, not a bare prescription).
    expect(squats[0]?.sets.some((set) => set.performed !== null)).toBe(true);
  });

  it("appends athlete-added work as its own prescription-free block", () => {
    const bikeBlocks = (exported[0]?.blocks ?? []).filter((b) =>
      b.exercises.some((ex) => ex.title === "Assault Bike"),
    );
    expect(bikeBlocks).toHaveLength(1);
    expect(
      bikeBlocks[0]?.exercises.every((ex) => ex.sets.every((set) => set.prescribed === null)),
    ).toBe(true);
  });
});

describe("workoutsToCsv (unlogged sets)", () => {
  it("falls back to the prescribed weight unit when a set was not performed", () => {
    const line = workoutsToCsv(exported)
      .trimEnd()
      .split("\r\n")
      .find((l) => l.startsWith("2026-06-01,") && l.includes("Front Foot Elevated Split Squat"));
    expect(line).toBeDefined();
    // date,program,team,workout,block,exercise,set,p_reps,p_wt,perf_reps(9),perf_wt(10),unit(11),...
    const cols = (line ?? "").split(",");
    // performed_reps (9) and performed_weight (10) are blank (nothing logged); weight_unit (11)
    // is still "lb", carried over from the prescribed side.
    expect(cols[9]).toBe("");
    expect(cols[10]).toBe("");
    expect(cols[11]).toBe("lb");
  });
});

describe("workoutsToText (unlogged sets)", () => {
  it("renders a skipped set with a dash and its planned value", () => {
    const after = workoutsToText(exported).split("Front Foot Elevated Split Squat")[1] ?? "";
    expect(after).toMatch(/set 1\s+—\s+\(planned /u);
  });
});

describe("mergeWorkoutsById", () => {
  const wk = (id: number | null, date: string): ProgramWorkout =>
    ({ id, date }) as unknown as ProgramWorkout;

  it("dedupes a workout on a window boundary (first occurrence wins)", () => {
    const merged = mergeWorkoutsById([
      [wk(1, "2026-02-01"), wk(20, "2026-06-29")],
      [wk(20, "2026-06-29"), wk(30, "2026-08-01")],
    ]);
    expect(merged.map((w) => (w as { id: number }).id)).toEqual([1, 20, 30]);
  });

  it("keeps id-less rows and sorts everything oldest-first by date", () => {
    const merged = mergeWorkoutsById([
      [wk(30, "2026-09-01"), wk(null, "2026-03-15")],
      [wk(1, "2026-01-10")],
    ]);
    expect(merged.map((w) => (w as { date: string }).date)).toEqual([
      "2026-01-10",
      "2026-03-15",
      "2026-09-01",
    ]);
  });
});

describe("fetchAthleteWorkoutsChunked", () => {
  afterEach(() => vi.unstubAllGlobals());

  const startParam = (url: string) => new URL(url, "https://x").searchParams.get("startDate") ?? "";

  it("fetches each window, dedupes the boundary session, sorts, and reports progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        // A >180-day range splits into two windows; workout 20 straddles the seam.
        return startParam(url) === "2026-01-01"
          ? json([
              { id: 10, date: "2026-02-01" },
              { id: 20, date: "2026-06-29" },
            ])
          : json([
              { id: 20, date: "2026-06-29" },
              { id: 30, date: "2026-08-01" },
            ]);
      }),
    );
    const progress: Array<[number, number]> = [];
    const out = await fetchAthleteWorkoutsChunked(
      new TrainHeroicClient("a@b.com", "pw"),
      "2026-01-01",
      "2026-12-31",
      { onProgress: (done, total) => progress.push([done, total]) },
    );
    expect(out.map((w) => (w as { id: number }).id)).toEqual([10, 20, 30]);
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress.at(-1)).toEqual([progress.length, progress.length]);
  });

  it("delegates a range that fits one window to the plain fetch (no chunking)", async () => {
    const ranges: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        ranges.push(startParam(url));
        return json([{ id: 1, date: "2026-06-05" }]);
      }),
    );
    const out = await fetchAthleteWorkoutsChunked(
      new TrainHeroicClient("a@b.com", "pw"),
      "2026-06-01",
      "2026-06-15",
    );
    expect(ranges).toEqual(["2026-06-01"]);
    expect(out).toHaveLength(1);
  });
});
