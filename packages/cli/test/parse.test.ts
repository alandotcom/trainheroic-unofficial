import { describe, expect, it } from "vitest";
import { looksLikeJson, parseDate } from "../src/parse";

describe("parseDate", () => {
  it("parses YYYY-M-D into a tuple", () => {
    expect(parseDate("2026-6-20")).toEqual([2026, 6, 20]);
    expect(parseDate("2026-12-1")).toEqual([2026, 12, 1]);
  });

  it("rejects malformed dates", () => {
    expect(() => parseDate("2026-06")).toThrow(/YYYY-M-D/u);
    expect(() => parseDate("nope")).toThrow(/YYYY-M-D/u);
    expect(() => parseDate("2026-6-x")).toThrow(/YYYY-M-D/u);
  });
});

describe("looksLikeJson", () => {
  it("detects inline JSON vs file paths", () => {
    expect(looksLikeJson('[{"a":1}]')).toBe(true);
    expect(looksLikeJson('  {"a":1}')).toBe(true);
    expect(looksLikeJson("./spec.json")).toBe(false);
    expect(looksLikeJson("spec.json")).toBe(false);
  });
});
