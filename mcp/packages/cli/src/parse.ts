import type { WorkoutDate } from "@trainheroic-unofficial/js";

/** Parse a YYYY-M-D date into the [y, m, d] tuple the workout API expects. */
export function parseDate(s: string): WorkoutDate {
  const parts = s.split("-").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error(`date must be YYYY-M-D, got "${s}".`);
  }
  return [parts[0] as number, parts[1] as number, parts[2] as number];
}

/** True when a string looks like inline JSON (starts with { or [) rather than a path. */
export function looksLikeJson(s: string): boolean {
  return /^\s*[[{]/u.test(s);
}
