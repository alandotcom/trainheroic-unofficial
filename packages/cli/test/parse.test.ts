import { describe, expect, it } from "vitest";
import {
  looksLikeJson,
  parseCountArg,
  parseDate,
  parseIdList,
  parseIntArg,
  requireTeamCalendarReassignmentConfirmation,
} from "../src/parse";

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

  it("rejects a blank part and an out-of-range month or day", () => {
    // Number("") is 0, so a trailing dash used to parse as day 0.
    expect(() => parseDate("2026-9-")).toThrow(/YYYY-M-D/u);
    expect(() => parseDate("2026-13-1")).toThrow(/real month and day/u);
    expect(() => parseDate("2026-6-0")).toThrow(/real month and day/u);
  });
});

describe("parseIntArg / parseCountArg / parseIdList", () => {
  it("parses integers and rejects blanks and fractions", () => {
    expect(parseIntArg("42", "--team")).toBe(42);
    expect(parseIntArg(" 7 ", "--team")).toBe(7);
    expect(() => parseIntArg("", "--team")).toThrow(/--team must be an integer/u);
    expect(() => parseIntArg("1.5", "--limit")).toThrow(/--limit must be an integer/u);
    expect(() => parseIntArg("abc", "--team")).toThrow(/--team must be an integer/u);
  });

  it("requires a positive count for limits", () => {
    expect(parseCountArg("5", "--limit")).toBe(5);
    expect(() => parseCountArg("0", "--limit")).toThrow(/positive integer/u);
    expect(() => parseCountArg("-2", "--limit")).toThrow(/positive integer/u);
  });

  it("rejects a trailing comma in an id list instead of emitting id 0", () => {
    expect(parseIdList("1,2, 3", "--athletes")).toEqual([1, 2, 3]);
    expect(() => parseIdList("1234,", "--athletes")).toThrow(/--athletes must be an integer/u);
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

describe("requireTeamCalendarReassignmentConfirmation", () => {
  it("rejects calendar reassignment without explicit confirmation", () => {
    expect(() => requireTeamCalendarReassignmentConfirmation(42, "99", false)).toThrow(
      "reassigning team 42's calendar changes live athlete programming; add --yes.",
    );
  });

  it("allows calendar reassignment with confirmation", () => {
    expect(() => requireTeamCalendarReassignmentConfirmation(42, "99", true)).not.toThrow();
  });

  it("does not require confirmation when no calendar reassignment was requested", () => {
    expect(() => requireTeamCalendarReassignmentConfirmation(42, undefined, false)).not.toThrow();
  });
});
