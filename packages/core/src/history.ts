import { presentExerciseHistory } from "@trainheroic-unofficial/js";

/** The shape returned by the js exercise-history presenter (PR board + dated session series). */
export type PresentedHistory = ReturnType<typeof presentExerciseHistory>;

/**
 * Trim a presented exercise history's session time-series to an inclusive YYYY-MM-DD window.
 * The `liftPRs` board stays all-time (PRs are not a windowed concept). Dates compare as their
 * first 10 chars so both "YYYY-MM-DD" and "YYYY-MM-DDThh:mm" values filter correctly. Shared by
 * the athlete's own history tool and the coach's per-roster-athlete history tool.
 */
export function historyInRange(
  presented: PresentedHistory,
  since: string | undefined,
  until: string | undefined,
): PresentedHistory {
  if (since === undefined && until === undefined) return presented;
  const sessions = presented.sessions.filter((s) => {
    const d = (s.date ?? "").slice(0, 10);
    if (since !== undefined && d < since) return false;
    if (until !== undefined && d > until) return false;
    return true;
  });
  return { ...presented, sessions };
}
