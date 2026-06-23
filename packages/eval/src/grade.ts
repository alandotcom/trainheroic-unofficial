// Reusable predicates over a run transcript. Scenario files compose these into a grader; keeping
// the predicates here (not inline) makes the behavior each scenario asserts explicit and shared.

import type { RunTranscript, ToolCall } from "./types";

export function callsTo(t: RunTranscript, name: string): ToolCall[] {
  return t.toolCalls.filter((c) => c.name === name);
}

export function countCalls(t: RunTranscript, name: string): number {
  return callsTo(t, name).length;
}

const NARROWING_ARGS = [
  "q",
  "limit",
  "page",
  "pageSize",
  "summary",
  "loggedOnly",
  "since",
  "until",
  "startDate",
  "endDate",
  "athleteIds",
  "athleteId",
  "program",
  "programId",
  "teamId",
];

function hasNarrowingArg(call: ToolCall): boolean {
  return NARROWING_ARGS.some((k) => call.input[k] !== undefined);
}

/**
 * True when, after any truncated result, a later call carried a narrowing argument — i.e. the agent
 * responded to "too much" by scoping down rather than stopping. Also true when the agent narrowed
 * from the very first call (it pre-empted the truncation), which is the ideal behavior.
 */
export function narrowedAfterTruncation(t: RunTranscript): boolean {
  const firstTruncatedIdx = t.toolCalls.findIndex((c) => c.truncated);
  if (firstTruncatedIdx === -1) return false;
  return t.toolCalls.slice(firstTruncatedIdx + 1).some(hasNarrowingArg);
}

/** True when any call to `name` carried a narrowing argument (filter/limit/page/date scope). */
export function usedNarrowingArg(t: RunTranscript, name: string): boolean {
  return callsTo(t, name).some(hasNarrowingArg);
}

/** A successful (non-error) read happened — the agent actually grounded its answer. */
export function hadSuccessfulRead(t: RunTranscript): boolean {
  return t.toolCalls.some((c) => !c.isError);
}

const GIVE_UP_PHRASES = [
  "i wasn't able to",
  "i was unable to",
  "i couldn't",
  "i could not",
  "too much data",
  "too many results",
  "unable to retrieve",
  "i don't have enough",
];

export function soundsLikeGivingUp(t: RunTranscript): boolean {
  const text = t.answerText.toLowerCase();
  return GIVE_UP_PHRASES.some((p) => text.includes(p));
}

export function finalIsQuestion(t: RunTranscript): boolean {
  return /\?\s*$/.test(t.answerText.trim()) || /\?/.test(t.answerText);
}

export function mentionsAny(t: RunTranscript, words: readonly string[]): boolean {
  const text = t.answerText.toLowerCase();
  return words.some((w) => text.includes(w.toLowerCase()));
}

/**
 * Like mentionsAny but over the FULL final output (answer + the model-authored EVAL REPORT). Use for
 * "did the agent surface this fact" checks: a terse model puts its whole answer in the report's
 * FINAL_ANSWER and leaves answerText empty, so an answerText-only check misses it. Don't use it for
 * "did the answer prose ask/say X" checks (the report would create false positives).
 */
export function finalMentions(t: RunTranscript, words: readonly string[]): boolean {
  const text = t.finalText.toLowerCase();
  return words.some((w) => text.includes(w.toLowerCase()));
}

export function noWrites(t: RunTranscript, writeNames: readonly string[]): boolean {
  return !t.toolCalls.some((c) => writeNames.includes(c.name));
}

/** Read the value of a field line from the model-authored EVAL REPORT (e.g. "ANSWER_REACHED"). */
export function reportField(t: RunTranscript, field: string): string | null {
  if (!t.evalReport) return null;
  const re = new RegExp(`^\\s*${field}\\s*:\\s*(.+)$`, "im");
  const m = re.exec(t.evalReport);
  return m ? (m[1]?.trim() ?? null) : null;
}

export function answerReached(t: RunTranscript): "yes" | "partial" | "no" | null {
  const v = reportField(t, "ANSWER_REACHED")?.toLowerCase();
  if (v === "yes" || v === "partial" || v === "no") return v;
  return null;
}

// --- write-mode predicates (over the writes the fake backend recorded for this run) ---

/** Writes whose path contains the given fragment (e.g. "savedworkoutsetexercise"). */
export function writesTo(t: RunTranscript, pathFragment: string): RunTranscript["writes"] {
  return t.writes.filter((w) => w.path.includes(pathFragment));
}

export function didWrite(t: RunTranscript, pathFragment: string): boolean {
  return writesTo(t, pathFragment).length > 0;
}

/** True when a recorded write's JSON body (deep) contains the given value as a string or number. */
export function writeBodyHas(
  t: RunTranscript,
  pathFragment: string,
  value: string | number,
): boolean {
  const needle = String(value);
  return writesTo(t, pathFragment).some((w) => JSON.stringify(w.body ?? "").includes(needle));
}
