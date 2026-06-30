import { describe, expect, it } from "vitest";
import { demoAthlete } from "../src/demo";
import { callsTo, finalMentions } from "../src/grade";
import { evalGate, runScenario, scenarioSurfaces } from "../src/harness";
import { libraryExercise, programWorkout } from "../src/shapes";
import type { Scenario } from "../src/types";

// GH #28: an athlete logs an off-plan session for a lift that is ALSO on a coach-scheduled workout
// that day. athlete_log_session keeps its ad-hoc semantics (it does not silently redirect), but the
// result now surfaces the scheduled match so the agent can flag it and point at athlete_log_set. This
// drives a model end to end and asserts the off-plan log ran AND the agent relayed the warning.

const { dataset: base, today } = demoAthlete();

// A coach-scheduled Bench Press workout today (loggable saved copy) — the overlap the warning detects.
const scheduledBench = programWorkout({
  id: 149200,
  date: today,
  workoutTitle: "Upper — Day 1",
  programId: 50100,
  programTitle: "Strength Block 3",
  teamId: 10100,
  savedWorkoutId: 148200,
  savedWorkoutSetId: 880200,
  exercises: [
    { id: 770200, exerciseId: 920002, title: "Bench Press", sets: [{ reps: "5", weight: "210" }] },
  ],
});

const dataset = {
  ...base,
  name: "athlete-log-session-warns-scheduled",
  // Pin Bench Press to one id (920002) across BOTH catalogs the agent might resolve through — the
  // coach library (`coach exercise resolve`) and the athlete's own list — so the id it logs matches
  // the scheduled fixture's exercise_id and the scheduled-duplicate warning can fire.
  exerciseLibrary: [libraryExercise(920002, "Bench Press")],
  athlete: {
    ...base.athlete,
    range: (start: string, end: string) =>
      (!start || today >= start) && (!end || today <= end) ? [scheduledBench] : [],
  },
};

const scenario: Scenario = {
  name: "athlete-log-session-warns-scheduled",
  dataset,
  role: "athlete",
  mode: "write",
  today,
  query:
    `Log an extra, off-plan Bench Press session I did on my own today — 3 sets of 5 at 185 lb — as a ` +
    `separate session.`,
  threshold: 0.6,
  grade: (t) => {
    const loggedSession = callsTo(t, "athlete_log_session").length > 0;
    // The agent relayed the scheduled-duplicate heads-up (the tool returns scheduledAlternatives + a hint).
    const warned = finalMentions(t, [
      "also scheduled",
      "already scheduled",
      "scheduled workout",
      "on your schedule",
      "scheduled bench",
      "log_set",
      "log-set",
      "log set",
    ]);
    const pass = loggedSession && warned;
    return {
      pass,
      reason: pass
        ? "logged the off-plan session and flagged the scheduled Bench Press"
        : `loggedSession=${loggedSession} warned=${warned}`,
    };
  },
};

const gate = evalGate();

describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: logs off-plan and warns about the scheduled duplicate`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
