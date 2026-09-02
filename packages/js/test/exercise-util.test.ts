import { describe, expect, it } from "vitest";
import {
  asExerciseList,
  buildSearchText,
  chunk,
  coerceInt,
  createLimiter,
  mapPool,
  rankSearch,
  unitLabel,
  unwrapEnvelope,
  withUnits,
} from "../src/exercise-util";

describe("coerceInt", () => {
  it("handles numbers, strings, booleans, and junk", () => {
    expect(coerceInt(5)).toBe(5);
    expect(coerceInt(5.7)).toBe(5);
    expect(coerceInt("1162")).toBe(1162);
    expect(coerceInt(true)).toBe(1);
    expect(coerceInt(null)).toBeNull();
    expect(coerceInt("")).toBeNull();
    expect(coerceInt("nope")).toBeNull();
  });
});

describe("unitLabel / withUnits", () => {
  it("maps param types to fixed units", () => {
    expect(unitLabel(3)).toBe("reps");
    expect(unitLabel(1)).toBe("lb");
    expect(unitLabel(10)).toBe("mi");
    expect(unitLabel(14)).toBe("RPE");
    expect(unitLabel(999)).toBeNull();
    expect(unitLabel(null)).toBeNull();
  });

  it("annotates a row", () => {
    const view = withUnits({
      id: 1,
      title: "Back Squat",
      param_1_type: 3,
      param_2_type: 1,
      can_edit: 0,
      user_id: null,
      use_count: 0,
    });
    expect(view.units).toEqual(["reps", "lb"]);
    expect(view).not.toHaveProperty("param_1_type");
    expect(view).not.toHaveProperty("param_2_type");
  });
});

describe("unwrapEnvelope / asExerciseList", () => {
  it("unwraps the {success,data} envelope", () => {
    expect(unwrapEnvelope({ success: 1, data: { id: 9 } })).toEqual({ id: 9 });
    expect(unwrapEnvelope({ id: 9 })).toEqual({ id: 9 });
  });

  it("extracts an exercise array from several shapes", () => {
    expect(asExerciseList([{ id: 1 }, { id: 2 }])).toHaveLength(2);
    expect(asExerciseList({ success: 1, data: [{ id: 1 }] })).toHaveLength(1);
    expect(asExerciseList({ exercises: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
    expect(asExerciseList({ "1": { id: 1 }, "2": { id: 2 } })).toHaveLength(2);
    expect(asExerciseList("garbage")).toEqual([]);
    expect(asExerciseList(null)).toEqual([]);
  });
});

describe("buildSearchText", () => {
  it("lowercases and trims", () => {
    expect(buildSearchText("  Back SQUAT ")).toBe("back squat");
  });
});

describe("rankSearch", () => {
  const rows = [
    { title: "Incline Bench Press", can_edit: 0 },
    { title: "Bench Press", can_edit: 0 },
    { title: "Bench", can_edit: 0 },
  ];

  it("ranks an exact title first", () => {
    expect(rankSearch(rows, "bench press", 10)[0]?.title).toBe("Bench Press");
  });

  it("prefers the prefix/exact for a single token", () => {
    expect(rankSearch(rows, "bench", 10)[0]?.title).toBe("Bench");
  });

  it("respects the limit", () => {
    expect(rankSearch(rows, "bench", 2)).toHaveLength(2);
  });
});

describe("chunk", () => {
  it("splits into fixed-size groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("mapPool", () => {
  it("stops scheduling after a failure and waits for started calls before rejecting", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const run = mapPool([0, 1, 2, 3], 2, async (i) => {
      started.push(i);
      await tick(i === 1 ? 20 : 1);
      finished.push(i);
      if (i === 0) throw new Error("boom");
      return i;
    });
    await expect(run).rejects.toThrow("boom");
    // Item 1 was in flight when 0 failed: it ran to completion before the rejection surfaced.
    expect(finished).toContain(1);
    // Nothing queued behind the failure was started.
    expect(started).toEqual([0, 1]);
  });

  it("keeps results in input order", async () => {
    const out = await mapPool([3, 1, 2], 3, async (n) => {
      await tick(n);
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });
});

describe("createLimiter", () => {
  it("caps the number of tasks in flight across independent callers", async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(2);
      active -= 1;
    };
    await Promise.all([
      mapPool([1, 2, 3], 3, () => limit.run(task)),
      mapPool([4, 5, 6], 3, () => limit.run(task)),
    ]);
    expect(peak).toBe(2);
  });

  it("cancel skips queued tasks and rejects later runs while started tasks finish", async () => {
    const limit = createLimiter(1);
    const ran: string[] = [];
    const boom = new Error("boom");
    const first = limit.run(async () => {
      ran.push("first");
      await tick(2);
      limit.cancel(boom);
      return "done";
    });
    const second = limit.run(async () => {
      ran.push("second");
      return "never";
    });
    await expect(first).resolves.toBe("done");
    await expect(second).rejects.toBe(boom);
    await expect(limit.run(async () => "late")).rejects.toBe(boom);
    expect(ran).toEqual(["first"]);
  });
});
