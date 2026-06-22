import { afterEach, describe, expect, it } from "vitest";
import { presentLogTargets, selectWorkoutsByProgram } from "@trainheroic-unofficial/js";
import {
  ambiguousBodybuilding,
  highEnrollmentAthlete,
  HIGH_ENROLLMENT,
  historyAthlete,
  historyAthleteSelf,
  largeRoster,
  manyPrograms,
} from "../src/datasets";
import { startBackend } from "../src/fake-backend";
import type { BackendHandle } from "../src/fake-backend";
import type { Dataset } from "../src/datasets";
import { demoAthlete, demoCoach } from "../src/demo";
import {
  presentAthleteWorkouts,
  presentExerciseHistory,
  type ExerciseHistoryDetail,
} from "@trainheroic-unofficial/js";

// Deterministic coverage for the fake backend + datasets — no claude, runs in the normal gate.
// These assert the datasets actually serve large orgs (hundreds of athletes, dozens of teams),
// that the list payloads cross the MCP result budget (so the LLM evals exercise real truncation),
// and that the #18 high-enrollment data carries the target log ids. The LLM evals depend on all of
// this being true, so pinning it here catches a dataset/route regression cheaply.

// Mirrors DEFAULT_RESULT_BUDGET in @trainheroic-unofficial/core.
const RESULT_BUDGET = 60_000;

let backend: BackendHandle | null = null;

afterEach(async () => {
  if (backend) await backend.close();
  backend = null;
});

async function boot(dataset: Dataset): Promise<BackendHandle> {
  backend = await startBackend(dataset);
  return backend;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  expect(res.ok, `GET ${url} -> ${res.status}`).toBe(true);
  return res.json();
}

function size(value: unknown): number {
  return JSON.stringify(value).length;
}

describe("largeRoster(300)", () => {
  it("serves 300 athletes, and the roster payload exceeds the result budget", async () => {
    const b = await boot(largeRoster(300));
    const athletes = (await getJson(`${b.url}/v5/athletes`)) as unknown[];
    expect(athletes).toHaveLength(300);
    expect(size(athletes)).toBeGreaterThan(RESULT_BUDGET);
    expect(b.unmatched).toHaveLength(0);
  });

  it("the oversized program payload also exceeds the budget (get_program truncates)", async () => {
    const b = await boot(largeRoster(300));
    const teams = (await getJson(`${b.url}/1.0/coach/teams`)) as Array<{ group_program: number }>;
    const bigProgramId = teams[0]?.group_program;
    const program = await getJson(`${b.url}/3.0/coach/program/${bigProgramId}`);
    expect(size(program)).toBeGreaterThan(RESULT_BUDGET);
  });
});

describe("manyPrograms(30)", () => {
  it("serves 30 distinctly-titled team programs", async () => {
    const b = await boot(manyPrograms(30));
    const teams = (await getJson(`${b.url}/1.0/coach/teams`)) as Array<{ group_program: number }>;
    expect(teams).toHaveLength(30);
    // list_programs (standalone) is empty — the agent must go through teams.
    expect(await getJson(`${b.url}/1.0/coach/programs`)).toEqual([]);
    // each team's program resolves to a titled program object.
    const program = (await getJson(`${b.url}/3.0/coach/program/${teams[5]?.group_program}`)) as {
      title: string;
    };
    expect(typeof program.title).toBe("string");
    expect(program.title.length).toBeGreaterThan(0);
  });

  it("paginates and filters /1.0/coach/teams", async () => {
    const b = await boot(manyPrograms(30));
    const page1 = (await getJson(`${b.url}/1.0/coach/teams?page=1&pageSize=10`)) as unknown[];
    const page2 = (await getJson(`${b.url}/1.0/coach/teams?page=2&pageSize=10`)) as unknown[];
    const page4 = (await getJson(`${b.url}/1.0/coach/teams?page=4&pageSize=10`)) as unknown[];
    expect(page1).toHaveLength(10);
    expect(page2).toHaveLength(10);
    expect(page4).toHaveLength(0);
    const filtered = (await getJson(`${b.url}/1.0/coach/teams?q=Strength`)) as Array<{
      title: string;
    }>;
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((t) => t.title.toLowerCase().includes("strength"))).toBe(true);
  });
});

describe("highEnrollmentAthlete (issue #18)", () => {
  it("returns one saved workout per program with the target log ids reachable", async () => {
    const b = await boot(highEnrollmentAthlete());
    const range = (await getJson(
      `${b.url}/3.0/coach/athlete/programworkout/range/${HIGH_ENROLLMENT.athleteId}?startDate=${HIGH_ENROLLMENT.date}&endDate=${HIGH_ENROLLMENT.date}`,
    )) as Parameters<typeof presentLogTargets>[0];
    expect(range).toHaveLength(HIGH_ENROLLMENT.programCount);

    // The compact log-targets view carries the target program's ids (no raw blob needed).
    const targets = presentLogTargets(range);
    const target = targets.find((t) => t.programId === HIGH_ENROLLMENT.targetProgramId);
    expect(target?.program).toBe(HIGH_ENROLLMENT.targetProgramTitle);
    expect(target?.savedWorkoutSetId).toBe(HIGH_ENROLLMENT.targetSavedWorkoutSetId);
    expect(target?.exercises[0]?.savedWorkoutSetExerciseId).toBe(
      HIGH_ENROLLMENT.targetSavedWorkoutSetExerciseId,
    );

    // The programId filter narrows the range to that one program.
    const narrowed = selectWorkoutsByProgram(range, {
      programId: HIGH_ENROLLMENT.targetProgramId,
    });
    expect(narrowed).toHaveLength(1);
  });

  it("the raw range payload is large enough to truncate (the #18 failure precondition)", async () => {
    const b = await boot(highEnrollmentAthlete());
    const range = await getJson(
      `${b.url}/3.0/coach/athlete/programworkout/range/${HIGH_ENROLLMENT.athleteId}?startDate=${HIGH_ENROLLMENT.date}&endDate=${HIGH_ENROLLMENT.date}`,
    );
    expect(size(range)).toBeGreaterThan(RESULT_BUDGET);
  });
});

describe("ambiguousBodybuilding", () => {
  it("has at least two programs whose titles contain 'Bodybuilding'", async () => {
    const b = await boot(ambiguousBodybuilding());
    const teams = (await getJson(`${b.url}/1.0/coach/teams`)) as Array<{ group_program: number }>;
    const titles: string[] = [];
    for (const t of teams) {
      const program = (await getJson(`${b.url}/3.0/coach/program/${t.group_program}`)) as {
        title: string;
      };
      titles.push(program.title);
    }
    const bodybuilding = titles.filter((t) => t.toLowerCase().includes("bodybuilding"));
    expect(bodybuilding.length).toBeGreaterThanOrEqual(2);
  });
});

describe("historyAthlete (2-year corpus)", () => {
  it("serves ~1192 sessions across 24 months and ~839 distinct exercises", async () => {
    const { dataset, info } = historyAthlete();
    expect(info.corpus.sessionCount).toBeGreaterThan(1000);
    expect(info.corpus.exerciseCount).toBeGreaterThan(700);
    expect(info.corpus.firstDate).toBe("2024-03-27");
    expect(info.corpus.lastDate).toBe("2026-03-27");

    const b = await boot(dataset);
    // A populated month returns that month's real sessions.
    const may2025 = (await getJson(
      `${b.url}/2.0/coach/athlete/calendar/summary/${info.athleteId}/2025/5/7`,
    )) as Array<{ workout_title: string; sets: Array<{ exercises: unknown[] }> }>;
    expect(may2025.length).toBeGreaterThan(0);
    expect(may2025[0]?.sets[0]?.exercises.length).toBeGreaterThan(0);
    // A different athlete on this dataset has no deep history.
    const otherMonth = (await getJson(
      `${b.url}/2.0/coach/athlete/calendar/summary/999999/2025/5/7`,
    )) as unknown[];
    expect(otherMonth).toHaveLength(0);
    expect(b.unmatched).toHaveLength(0);
  });

  it("serves a per-exercise dated history series across the corpus (athlete_lift_history)", async () => {
    const { dataset, info } = historyAthlete();
    const b = await boot(dataset);
    const detail = (await getJson(
      `${b.url}/v5/exercises/${info.corpus.topExercise.id}/history?userId=${info.athleteId}`,
    )) as { liftPRs: unknown[]; history: Array<{ dateCompleted: string }> };
    // The most-prescribed exercise should appear in many dated sessions, spanning the 2 years.
    expect(detail.history.length).toBe(info.corpus.topExercise.sessions);
    expect(detail.history.length).toBeGreaterThan(20);
    expect(detail.liftPRs.length).toBeGreaterThan(0);
    const dates = detail.history.map((h) => h.dateCompleted);
    expect(dates[0] < (dates.at(-1) ?? "")).toBe(true);
  });
});

describe("historyAthleteSelf (athlete surface)", () => {
  it("serves /user/simple as the athlete and the athlete's own exercise list + history", async () => {
    const { dataset, info } = historyAthleteSelf();
    const b = await boot(dataset);

    // The logged-in user IS the athlete (not the coach), so athlete tools resolve the right userId.
    const me = (await getJson(`${b.url}/user/simple`)) as { id: number; roles: string[] };
    expect(me.id).toBe(info.athleteId);
    expect(me.roles).toContain("athlete");

    // The athlete's own exercise list (athlete_exercises) carries the corpus exercises.
    const list = (await getJson(`${b.url}/v5/users/exercises/history`)) as Array<{ id: number }>;
    expect(list.length).toBe(info.corpus.exerciseCount);

    // The per-exercise series (athlete_exercise_history) resolves for the athlete's own userId.
    const detail = (await getJson(
      `${b.url}/v5/exercises/${info.corpus.topExercise.id}/history?userId=${info.athleteId}`,
    )) as { history: unknown[] };
    expect(detail.history.length).toBe(info.corpus.topExercise.sessions);

    // The empty-default athlete endpoints answer (no unmatched routes).
    await getJson(`${b.url}/1.0/athlete/prefs`);
    await getJson(`${b.url}/2.0/athlete/workingMax`);
    await getJson(
      `${b.url}/3.0/athlete/programworkout/range?startDate=2026-03-01&endDate=2026-03-27`,
    );
    expect(b.unmatched).toHaveLength(0);
  });
});

describe("write routes (write-mode support)", () => {
  it("records mutating requests and returns success for the set-write + swap paths", async () => {
    const b = await boot(highEnrollmentAthlete());

    // Coach prescribe/log data write (step 1).
    const setWrite = await fetch(
      `${b.url}/1.0/coach/savedworkoutsetexercise/${HIGH_ENROLLMENT.targetSavedWorkoutSetExerciseId}/${HIGH_ENROLLMENT.athleteId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          param_1_data_1: "5",
          param_2_data_1: "235",
          athleteId: HIGH_ENROLLMENT.athleteId,
        }),
      },
    );
    expect(setWrite.ok).toBe(true);

    // Per-athlete swap echoes the row the SDK reads back.
    const swap = await fetch(`${b.url}/v5/savedWorkoutSetExercises/770500?exerciseId=900042`, {
      method: "PUT",
    });
    const swapRow = (await swap.json()) as { exercise_id: number; exercise: { title: string } };
    expect(swapRow.exercise_id).toBe(900042);
    expect(typeof swapRow.exercise.title).toBe("string");

    // Both were recorded for a grader to assert on; reads (GET) are not.
    expect(b.writes).toHaveLength(2);
    expect(b.writes[0]?.method).toBe("PUT");
    expect(b.writes[0]?.path).toContain("savedworkoutsetexercise");
    expect(JSON.stringify(b.writes[0]?.body)).toContain("235");
    expect(b.unmatched).toHaveLength(0);
  });
});

describe("demoAthlete (query bank fixture)", () => {
  it("serves logged + scheduled workouts, working maxes, PRs, and a progression", async () => {
    const { dataset } = demoAthlete();
    const b = await boot(dataset);

    // athlete_workouts: some logged (performed), one scheduled-only.
    const range = (await getJson(
      `${b.url}/3.0/athlete/programworkout/range?startDate=2026-03-22&endDate=2026-03-29`,
    )) as Parameters<typeof presentAthleteWorkouts>[0];
    const views = presentAthleteWorkouts(range);
    expect(views.filter((w) => w.logged).length).toBeGreaterThanOrEqual(2);
    expect(views.some((w) => !w.logged)).toBe(true);

    // athlete_working_maxes + athlete_personal_records answer non-empty.
    expect((await getJson(`${b.url}/2.0/athlete/workingMax`)) as unknown[]).not.toHaveLength(0);
    const prs = (await getJson(`${b.url}/v5/exercises/920002/personalRecords`)) as unknown[];
    expect(prs).not.toHaveLength(0);

    // athlete_exercise_history: a back-squat progression that trends up.
    const detail = (await getJson(
      `${b.url}/v5/exercises/920001/history?userId=100001`,
    )) as ExerciseHistoryDetail;
    const series = presentExerciseHistory(detail).sessions;
    expect(series.length).toBeGreaterThan(5);
    expect(b.unmatched).toHaveLength(0);
  });
});

describe("demoCoach (query bank fixture)", () => {
  it("serves a named roster, a resolvable custom exercise, a recent message, a session to log", async () => {
    const { dataset } = demoCoach();
    const b = await boot(dataset);

    const roster = (await getJson(`${b.url}/v5/athletes`)) as unknown[];
    expect(roster.length).toBeGreaterThan(0);

    const library = (await getJson(`${b.url}/v5/exerciseLibrary/all`)) as Array<{ title: string }>;
    expect(library.some((e) => e.title === "Romanian Deadlift")).toBe(true);
    expect(library.some((e) => e.title.toLowerCase().includes("sled push"))).toBe(true);

    const streams = (await getJson(`${b.url}/v5/messaging/streams`)) as { athletes: unknown[] };
    expect(streams.athletes.length).toBeGreaterThan(0);
    const msgs = (await getJson(`${b.url}/v5/messaging/streams/5001/comments`)) as unknown[];
    expect(msgs.length).toBeGreaterThan(0);

    // A coach "log a result" has a prescribed bench session for athlete 100001 today.
    const coachRange = (await getJson(
      `${b.url}/3.0/coach/athlete/programworkout/range/100001?startDate=2026-03-27&endDate=2026-03-27`,
    )) as unknown[];
    expect(coachRange).toHaveLength(1);
    expect(b.unmatched).toHaveLength(0);
  });
});

describe("auth + unmatched routing", () => {
  it("answers POST /auth and records nothing as unmatched for known routes", async () => {
    const b = await boot(manyPrograms(4));
    const auth = (await (
      await fetch(`${b.url}/auth`, { method: "POST", body: "email=x&password=y" })
    ).json()) as { session_id?: string };
    expect(typeof auth.session_id).toBe("string");
    await getJson(`${b.url}/user/simple`);
    await getJson(`${b.url}/v5/athletes`);
    expect(b.unmatched).toHaveLength(0);
  });

  it("records an unknown route as unmatched (so routing gaps fail loudly)", async () => {
    const b = await boot(manyPrograms(4));
    const res = await fetch(`${b.url}/v5/this/route/does/not/exist`);
    expect(res.status).toBe(501);
    expect(b.unmatched).toContain("GET /v5/this/route/does/not/exist");
  });
});
