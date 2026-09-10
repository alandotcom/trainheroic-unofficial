import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProgramWorkout } from "@trainheroic-unofficial/dto";
import { TrainHeroicClient } from "../src/client";
import {
  classifyMainLift,
  fetchAthleteMainLiftPRs,
  resolveAthleteMainLifts,
} from "../src/main-lifts";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A real logged workout from the fixtures: a performed Back Squat (plus accessory work). Used to
// exercise the range-based discovery path end to end.
const PROGRAM_WORKOUT = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "program-workout.json"), "utf8"),
) as ProgramWorkout;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifyMainLift", () => {
  it("buckets the squat variants an athlete actually logs", () => {
    expect(classifyMainLift("Back Squat")).toBe("squat");
    expect(classifyMainLift("Front Squat")).toBe("squat");
    // The canonical bare term still classifies — discovery just never finds it under this name.
    expect(classifyMainLift("Squat")).toBe("squat");
  });

  it("keeps bench and overhead press distinct (the press ambiguity)", () => {
    expect(classifyMainLift("Bench Press")).toBe("bench");
    expect(classifyMainLift("Incline Bench Press")).toBe("bench");
    expect(classifyMainLift("Overhead Press")).toBe("overhead");
    expect(classifyMainLift("Shoulder Press")).toBe("overhead");
    expect(classifyMainLift("Push Press")).toBe("overhead");
    // A bare "press" accessory is not a main lift.
    expect(classifyMainLift("Leg Press")).toBeNull();
  });

  it("buckets deadlift and the Olympic lifts", () => {
    expect(classifyMainLift("Deadlift")).toBe("deadlift");
    expect(classifyMainLift("Romanian Deadlift")).toBe("deadlift");
    expect(classifyMainLift("Power Snatch")).toBe("snatch");
    expect(classifyMainLift("Clean & Jerk")).toBe("cleanjerk");
    expect(classifyMainLift("Hang Clean")).toBe("cleanjerk");
  });

  it("returns null for accessory work", () => {
    expect(classifyMainLift("Bicep Curl")).toBeNull();
    expect(classifyMainLift("Pull-up")).toBeNull();
  });
});

const ATHLETE = 2858055;

// One PR board, returned for whichever exercise the fixture's logged squat resolves to.
const SQUAT_HISTORY = {
  liftPRs: [
    { weight: 315, reps: 5, dateCompleted: "2026-05-01", description: "5 rep max" },
    { weight: 335, reps: 3, dateCompleted: "2026-06-01", description: "3 rep max" },
  ],
  history: [],
};

describe("fetchAthleteMainLiftPRs", () => {
  it("splits long workout history reads into non-overlapping 180-day windows", async () => {
    const ranges: Array<{ start: string; end: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        const parsed = new URL(url);
        ranges.push({
          start: parsed.searchParams.get("startDate") ?? "",
          end: parsed.searchParams.get("endDate") ?? "",
        });
        return json([]);
      }),
    );

    await resolveAthleteMainLifts(new TrainHeroicClient("a@b.com", "pw"), ATHLETE, {
      months: 12,
      now: new Date(2026, 11, 31),
    });

    expect(ranges).toHaveLength(3);
    expect(ranges[0]?.start).toBe("2026-01-01");
    expect(ranges.at(-1)?.end).toBe("2026-12-31");
    for (const [index, range] of ranges.entries()) {
      const days =
        (Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) /
          86_400_000 +
        1;
      expect(days).toBeLessThanOrEqual(180);
      const next = ranges[index + 1];
      if (next) {
        expect(Date.parse(`${next.start}T00:00:00Z`)).toBe(
          Date.parse(`${range.end}T00:00:00Z`) + 86_400_000,
        );
      }
    }
  });

  it("discovers the logged variant from the workout range and returns its heaviest PR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/coach/athlete/programworkout/range/")) return json([PROGRAM_WORKOUT]);
        if (/\/v5\/exercises\/\d+\/history/u.test(url)) return json(SQUAT_HISTORY);
        return json({});
      }),
    );

    const result = await fetchAthleteMainLiftPRs(new TrainHeroicClient("a@b.com", "pw"), ATHLETE, {
      months: 3,
      now: new Date("2026-06-22T00:00:00Z"),
    });

    // One entry per family, always in the canonical order.
    expect(result.prs.map((p) => p.family)).toEqual([
      "cleanjerk",
      "snatch",
      "deadlift",
      "squat",
      "bench",
      "overhead",
    ]);

    // The fixture's logged Back Squat resolves to a real exercise id, and its board's heaviest set
    // (335 x 3) is reported.
    const squat = result.prs.find((p) => p.family === "squat");
    expect(squat?.exerciseId).not.toBeNull();
    expect(squat?.title).toBe("Back Squat");
    expect(squat).toMatchObject({ weight: 335, reps: 3 });

    // Families the athlete never logged come back as the "no PR yet" shape.
    const deadlift = result.prs.find((p) => p.family === "deadlift");
    expect(deadlift).toMatchObject({ exerciseId: null, weight: null, reps: null });
  });

  it("returns all-null rows for an athlete with no logged main lifts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/auth") ? json({ id: 1, session_id: "s" }) : json([]),
      ),
    );
    const result = await fetchAthleteMainLiftPRs(new TrainHeroicClient("a@b.com", "pw"), ATHLETE, {
      months: 1,
      now: new Date("2026-06-22T00:00:00Z"),
    });
    expect(result.prs).toHaveLength(6);
    expect(result.prs.every((p) => p.exerciseId === null && p.weight === null)).toBe(true);
  });
});
