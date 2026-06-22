import { afterEach, describe, expect, it } from "vitest";
import { presentLogTargets, selectWorkoutsByProgram } from "@trainheroic-unofficial/js";
import {
  ambiguousBodybuilding,
  highEnrollmentAthlete,
  HIGH_ENROLLMENT,
  historyAthlete,
  largeRoster,
  manyPrograms,
} from "../src/datasets";
import { startBackend } from "../src/fake-backend";
import type { BackendHandle } from "../src/fake-backend";
import type { Dataset } from "../src/datasets";

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
