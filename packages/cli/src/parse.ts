// The YYYY-M-D parser lives in dto (the single home for the WorkoutDate shape), re-exported
// here under the name the CLI commands already use so there is one validation rule, not two.
export { parseWorkoutDate as parseDate } from "@trainheroic-unofficial/js";

/** True when a string looks like inline JSON (starts with { or [) rather than a path. */
export function looksLikeJson(s: string): boolean {
  return /^\s*[[{]/u.test(s);
}

/** Fail closed before changing the live calendar assigned to a team. */
export function requireTeamCalendarReassignmentConfirmation(
  teamId: number,
  groupProgram: string | undefined,
  confirmed: boolean,
): void {
  if (groupProgram !== undefined && !confirmed) {
    throw new Error(
      `reassigning team ${teamId}'s calendar changes live athlete programming; add --yes.`,
    );
  }
}

/**
 * An integer argument. `Number("")` is 0 and `Number("1.5")` is finite, so a bare `Number` check
 * let a trailing comma in an id list become id 0 and a fractional --limit slip through; every
 * integer-valued flag and positional (ids, counts, pages) goes through here instead.
 */
export function parseIntArg(value: string, label: string): number {
  const s = value.trim();
  if (!/^-?\d+$/u.test(s)) throw new Error(`${label} must be an integer, got "${value}".`);
  return Number(s);
}

/** A positive integer argument (a --limit, a page size): 0 and negatives are rejected. */
export function parseCountArg(value: string, label: string): number {
  const n = parseIntArg(value, label);
  if (n < 1) throw new Error(`${label} must be a positive integer, got "${value}".`);
  return n;
}

/** A comma-separated list of integer ids; a blank entry (e.g. a trailing comma) is an error. */
export function parseIdList(value: string, label: string): number[] {
  return value.split(",").map((s) => parseIntArg(s, label));
}
