// The inclusive since/until window over a presented exercise history. Kept out of athlete.ts so
// that file stays the athlete-self surface under 1k lines.

import type { PresentedExerciseHistory } from "@trainheroic-unofficial/dto";

/**
 * Trim a presented exercise history's session time-series to an inclusive YYYY-MM-DD window.
 * The `liftPRs` board stays all-time (PRs are not a windowed concept). Dates compare as their
 * first 10 chars so both "YYYY-MM-DD" and "YYYY-MM-DDThh:mm" values filter correctly. The one
 * window rule shared by the athlete's own history tool, the coach's per-roster-athlete history
 * tool, and the CLI, so a timestamped session cannot fall out of an inclusive upper bound.
 */
export function historyInRange(
  presented: PresentedExerciseHistory,
  since: string | undefined,
  until: string | undefined,
): PresentedExerciseHistory {
  if (since === undefined && until === undefined) return presented;
  const sessions = presented.sessions.filter((s) => {
    const d = (s.date ?? "").slice(0, 10);
    if (since !== undefined && d < since) return false;
    if (until !== undefined && d > until) return false;
    return true;
  });
  return { ...presented, sessions };
}
