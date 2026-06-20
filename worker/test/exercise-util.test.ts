import { describe, expect, it } from "vitest";
import {
  asExerciseList,
  buildSearchText,
  chunk,
  coerceInt,
  rankSearch,
  unitLabel,
  unwrapEnvelope,
  withUnits,
} from "../src/store/exercise-util";

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
    expect(view.param_1_unit).toBe("reps");
    expect(view.param_2_unit).toBe("lb");
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
