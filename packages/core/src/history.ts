import { historyInRange, type PresentedExerciseHistory } from "@trainheroic-unofficial/js";

/** The shape returned by the js exercise-history presenter (PR board + dated session series). */
export type PresentedHistory = PresentedExerciseHistory;

/**
 * The inclusive since/until window filter for a presented exercise history. It lives in the js
 * SDK so the CLI applies the same rule as the MCP tools; re-exported here for the tool modules.
 */
export { historyInRange };
