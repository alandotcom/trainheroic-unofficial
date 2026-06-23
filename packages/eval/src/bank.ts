// The historic query bank, ported from .claude/skills/mcp-eval/queries.md as runnable, data-backed
// scenarios. Where the hand-written scenarios (coach-*.eval.ts) target a specific failure mode with
// a tailored grader, the bank is BREADTH: real questions a person types, each mapped to the
// capability that should answer it, graded by a shared light check — reached an answer, the expected
// capability fired successfully, no give-up, and (read mode) nothing was written. Add an entry here
// when a new tool or a new everyday question shows up.

import {
  answerReached,
  didWrite,
  hadSuccessfulRead,
  reportField,
  soundsLikeGivingUp,
} from "./grade";
import type { Dataset } from "./datasets";
import { callsTo } from "./grade";
import type { Grade, Mode, Role, RunTranscript, Scenario } from "./types";

export type BankEntry = {
  /** Section label from the query bank (for reporting). */
  section: string;
  query: string;
  /** Capabilities (canonical names) any one of which firing successfully answers the query. */
  expect: string[];
  /** Write entries name the path fragment the write must hit (e.g. "savedworkoutsetexercise"). */
  expectWrite?: string;
};

/** A capability fired and at least one such call did not error. */
function firedOk(t: RunTranscript, names: readonly string[]): boolean {
  return names.some((n) => callsTo(t, n).some((c) => !c.isError));
}

/** The shared light grader: did the agent answer this query the expected way? */
function gradeBank(entry: BankEntry, mode: Mode) {
  return (t: RunTranscript): Grade => {
    const used = firedOk(t, entry.expect);
    // Reached when the model's own report says yes/partial, OR (no report) it left a real answer.
    // A terse model puts everything in FINAL_ANSWER and leaves answerText empty, so don't require both.
    const report = answerReached(t);
    const reached =
      report === "yes" || report === "partial" || (report === null && t.answerText.length > 0);
    const gaveUp = soundsLikeGivingUp(t);
    if (mode === "write") {
      const wrote = entry.expectWrite ? didWrite(t, entry.expectWrite) : t.writes.length > 0;
      const pass = used && wrote && !gaveUp;
      return {
        pass,
        reason: pass
          ? "performed the write"
          : `usedExpected=${used} wrote=${wrote} gaveUp=${gaveUp}`,
      };
    }
    const pass = used && reached && hadSuccessfulRead(t) && !gaveUp;
    return {
      pass,
      reason: pass
        ? "answered via the expected capability"
        : `usedExpected=${used} reached=${reached} gaveUp=${gaveUp} (report=${reportField(t, "ANSWER_REACHED")})`,
    };
  };
}

/** Turn bank entries into runnable Scenarios against one dataset/role/mode. */
export function bankScenarios(opts: {
  entries: BankEntry[];
  dataset: Dataset;
  role: Role;
  mode: Mode;
  today: string;
  threshold?: number;
}): Scenario[] {
  return opts.entries.map((entry, i) => ({
    name: `bank/${opts.role}/${String(i + 1).padStart(2, "0")} ${entry.section}`,
    dataset: opts.dataset,
    role: opts.role,
    mode: opts.mode,
    query: entry.query,
    today: opts.today,
    threshold: opts.threshold ?? 0.6,
    grade: gradeBank(entry, opts.mode),
  }));
}

// --- Athlete read bank ---

export const ATHLETE_READ_BANK: BankEntry[] = [
  {
    section: "logged-vs-prescribed",
    query: "Did I record anything this week?",
    expect: ["athlete_workouts"],
  },
  {
    section: "logged-vs-prescribed",
    query: "What did I do in my last training session?",
    expect: ["athlete_workouts"],
  },
  {
    section: "logged-vs-prescribed",
    query: "Have I logged any workouts in the last few days?",
    expect: ["athlete_workouts"],
  },
  {
    section: "logged-vs-prescribed",
    query: "Did I actually do my squats yesterday, or just have them scheduled?",
    expect: ["athlete_workouts"],
  },
  {
    section: "schedule",
    query: "What's on my training schedule for this week?",
    expect: ["athlete_workouts"],
  },
  { section: "schedule", query: "What's my next workout?", expect: ["athlete_workouts"] },
  {
    section: "history",
    query: "Show me how my back squat has progressed over the last 3 months.",
    expect: ["athlete_exercise_history", "athlete_exercises"],
  },
  {
    section: "history",
    query: "What have I been training lately? Give me a sense of my recent workouts.",
    expect: ["athlete_workouts"],
  },
  {
    section: "history",
    query: "How's my bench trending this year?",
    expect: ["athlete_exercise_history", "athlete_exercises"],
  },
  {
    section: "prs-maxes",
    query: "What's my current bench press personal record?",
    expect: ["athlete_personal_records", "athlete_exercise_history", "athlete_exercises"],
  },
  {
    section: "prs-maxes",
    query: "What are my working maxes right now?",
    expect: ["athlete_working_maxes"],
  },
  {
    section: "prs-maxes",
    query: "What's the most I've ever squatted?",
    expect: ["athlete_personal_records", "athlete_exercise_history", "athlete_exercises"],
  },
  {
    section: "identity",
    query: "Whose account is this and how many sessions have I logged all-time?",
    expect: ["athlete_profile", "athlete_whoami"],
  },
];

// --- Coach read bank ---

export const COACH_READ_BANK: BankEntry[] = [
  { section: "roster", query: "Who's on my roster?", expect: ["list_athletes"] },
  {
    section: "roster",
    query: "What teams do I have and how many athletes are on each?",
    expect: ["list_teams", "list_athletes"],
  },
  {
    section: "athlete-drilldown",
    query: "How has my most recently active athlete been training lately?",
    expect: ["roster_activity", "athlete_training"],
  },
  {
    section: "athlete-drilldown",
    query: "What are Athlete001 Lastname001's recent PRs?",
    expect: ["athlete_training", "athlete_lift_history"],
  },
  {
    section: "athlete-drilldown",
    query: "Is anyone on my roster falling behind on their programming?",
    expect: ["roster_activity"],
  },
  {
    section: "exercise-resolution",
    query: 'What\'s the exercise id for "Romanian Deadlift"?',
    expect: ["exercise_resolve", "exercise_search"],
  },
  {
    section: "exercise-resolution",
    query: "Do I have a custom exercise for sled pushes?",
    expect: ["exercise_search", "exercise_resolve"],
  },
  {
    section: "programming",
    query: "What programs am I running right now?",
    expect: ["list_teams", "list_programs", "get_program"],
  },
  {
    section: "programming",
    // "whole roster" not "team-wide" — the demo coach has several teams, so "the team" is
    // genuinely ambiguous and a good model asks which; the roster framing tests team_volume directly.
    query: "Show me training volume across my whole roster over the last couple of weeks.",
    expect: ["team_volume"],
  },
  {
    section: "messaging",
    query: "Have any of my athletes messaged me recently?",
    expect: ["messaging_conversations", "messaging_read"],
  },
];

// --- Write bank (TEST account; write mode only) ---

export const ATHLETE_WRITE_BANK: BankEntry[] = [
  {
    section: "athlete-write",
    query: "Log today's session: I did 5 sets of 5 back squats at 185.",
    expect: ["athlete_log_session", "athlete_log_set"],
    expectWrite: "savedworkoutset",
  },
];

export const COACH_WRITE_BANK: BankEntry[] = [
  {
    section: "coach-write",
    query: "Log a result for Athlete001 Lastname001: they did 3x8 at 135 on bench today.",
    expect: ["log_athlete_set", "coach_log_session"],
    expectWrite: "savedworkoutset",
  },
];
