import { afterEach, describe, expect, it } from "vitest";
import { boundedSerialize, DEFAULT_RESULT_BUDGET, jsonResult, resultBudget } from "../src/context";

function rows(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `athlete ${i}`,
    note: "x".repeat(40),
  }));
}

describe("boundedSerialize", () => {
  it("pretty-prints a small result and round-trips", () => {
    const data = { a: 1, b: "two", c: [1, 2, 3] };
    const out = boundedSerialize(data, DEFAULT_RESULT_BUDGET);
    expect(out).toContain("\n");
    expect(out).toContain("  ");
    expect(JSON.parse(out)).toEqual(data);
    expect(out).not.toContain("__truncated");
  });

  it("falls back to compact when pretty would overflow but compact fits", () => {
    const data: Record<string, number> = {};
    for (let i = 0; i < 80; i++) data[`key_${i}`] = i;
    const compact = JSON.stringify(data);
    const out = boundedSerialize(data, compact.length);
    expect(out).toBe(compact);
    expect(out).not.toContain("\n");
    expect(JSON.parse(out)).toEqual(data);
  });

  it("truncates a top-level array into { items, __truncated }", () => {
    const data = rows(500);
    const budget = 4000;
    const out = boundedSerialize(data, budget);
    expect(out.length).toBeLessThanOrEqual(budget);
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items.length).toBe(parsed["__truncated"].returned);
    expect(parsed["__truncated"].total).toBe(500);
    expect(parsed["__truncated"].omitted).toBe(500 - parsed["__truncated"].returned);
    expect(parsed["__truncated"].returned).toBeLessThan(500);
    expect(parsed["__truncated"].returned).toBeGreaterThan(0);
  });

  it("fills most of the budget without exceeding it", () => {
    const data = rows(500);
    const budget = 4000;
    const out = boundedSerialize(data, budget);
    // Within budget, but not pathologically under it (a small marker reserve aside).
    expect(out.length).toBeLessThanOrEqual(budget);
    expect(out.length).toBeGreaterThan(budget * 0.85);
  });

  it("truncates the largest array property of an object, preserving the rest", () => {
    const data = { meta: { kind: "roster", org: 7 }, athletes: rows(500) };
    const budget = 4000;
    const out = boundedSerialize(data, budget);
    expect(out.length).toBeLessThanOrEqual(budget);
    const parsed = JSON.parse(out);
    expect(parsed["__truncated"].field).toBe("athletes");
    expect(parsed.meta).toEqual({ kind: "roster", org: 7 });
    expect(parsed.athletes.length).toBe(parsed["__truncated"].returned);
    expect(parsed["__truncated"].total).toBe(500);
  });

  it("picks the largest array among several", () => {
    const data = { small: rows(2), big: rows(500) };
    const parsed = JSON.parse(boundedSerialize(data, 4000));
    expect(parsed["__truncated"].field).toBe("big");
  });

  it("hard-caps a deep object with no trimmable array, labeled non-JSON", () => {
    const data = { blob: "y".repeat(5000), kind: "deep" };
    const budget = 1000;
    const out = boundedSerialize(data, budget);
    expect(out.length).toBeLessThanOrEqual(budget);
    expect(out).toContain("[TRUNCATED:");
    expect(() => JSON.parse(out)).toThrow();
  });

  it("hard-caps a huge string", () => {
    const out = boundedSerialize("z".repeat(2000), 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).toContain("[TRUNCATED:");
  });

  it("returns a small string verbatim", () => {
    expect(boundedSerialize("hello", DEFAULT_RESULT_BUDGET)).toBe("hello");
  });

  it("handles undefined and null without throwing", () => {
    expect(boundedSerialize(undefined, DEFAULT_RESULT_BUDGET)).toBe("null");
    expect(boundedSerialize(null, DEFAULT_RESULT_BUDGET)).toBe("null");
  });

  it("emits an empty-but-structured wrapper when the first element alone is too large", () => {
    const data = [{ huge: "q".repeat(5000) }, { huge: "q".repeat(5000) }];
    const out = boundedSerialize(data, 500);
    const parsed = JSON.parse(out);
    expect(parsed.items).toEqual([]);
    expect(parsed["__truncated"].returned).toBe(0);
    expect(parsed["__truncated"].omitted).toBe(2);
  });

  it("never exceeds the budget after adding the marker (reserve works)", () => {
    const data = rows(300);
    for (const budget of [800, 1500, 3000, 7000]) {
      expect(boundedSerialize(data, budget).length).toBeLessThanOrEqual(budget);
    }
  });

  it("propagates a custom hint into the array marker", () => {
    const parsed = JSON.parse(boundedSerialize(rows(500), 4000, "use page/pageSize"));
    expect(parsed["__truncated"].hint).toBe("use page/pageSize");
  });

  it("propagates a custom hint into the hard-cap note", () => {
    const out = boundedSerialize("z".repeat(2000), 500, "narrow me");
    expect(out).toContain("narrow me");
  });

  it("falls back to the default hint when none is given", () => {
    const arr = JSON.parse(boundedSerialize(rows(500), 4000));
    expect(arr["__truncated"].hint).toContain("Narrow it");
    const obj = JSON.parse(boundedSerialize({ rows: rows(500) }, 4000));
    expect(obj["__truncated"].hint).toContain("more specific id");
  });
});

describe("resultBudget", () => {
  afterEach(() => {
    delete process.env.TH_MCP_RESULT_BUDGET;
  });

  it("defaults to DEFAULT_RESULT_BUDGET", () => {
    expect(resultBudget()).toBe(DEFAULT_RESULT_BUDGET);
  });

  it("honors a valid TH_MCP_RESULT_BUDGET override", () => {
    process.env.TH_MCP_RESULT_BUDGET = "12345";
    expect(resultBudget()).toBe(12345);
  });

  it("ignores a non-positive or non-numeric override", () => {
    process.env.TH_MCP_RESULT_BUDGET = "nope";
    expect(resultBudget()).toBe(DEFAULT_RESULT_BUDGET);
    process.env.TH_MCP_RESULT_BUDGET = "-5";
    expect(resultBudget()).toBe(DEFAULT_RESULT_BUDGET);
  });
});

describe("jsonResult wiring", () => {
  it("bounds a large array result and stays within budget", () => {
    const out = jsonResult(rows(5000));
    const part = out.content[0] as { text?: string } | undefined;
    const text = part?.text ?? "";
    expect(text.length).toBeLessThanOrEqual(resultBudget());
    expect(JSON.parse(text)["__truncated"].total).toBe(5000);
  });
});
