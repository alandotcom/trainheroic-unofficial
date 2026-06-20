// The YYYY-M-D parser lives in dto (the single home for the WorkoutDate shape), re-exported
// here under the name the CLI commands already use so there is one validation rule, not two.
export { parseWorkoutDate as parseDate } from "@trainheroic-unofficial/js";

/** True when a string looks like inline JSON (starts with { or [) rather than a path. */
export function looksLikeJson(s: string): boolean {
  return /^\s*[[{]/u.test(s);
}
