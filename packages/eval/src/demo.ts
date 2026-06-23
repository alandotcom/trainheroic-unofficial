// Rich demo datasets that back the full query bank — a populated athlete and a populated coach with
// enough real-shaped data that every bank question is answerable. Distinct from the scale/structure
// datasets (largeRoster, manyPrograms, …) and the deep-history corpus: these are "normal account"
// fixtures so the breadth bank exercises the everyday read/write paths, not just failure modes.

import { buildOrg } from "./datasets";
import type { Dataset } from "./datasets";
import {
  athleteRangeWorkout,
  athleteUser,
  calendarSession,
  historyEntry,
  libraryExercise,
  liftPR,
  messageComment,
  messagingStreams,
  personalRecord,
  profileSummary,
  programWorkout,
  userSimple,
  workingMax,
} from "./shapes";

const ATHLETE_ID = 100001;
const TODAY = "2026-03-27";

/** The demo athlete's catalog of lifts, with stable ids the bank scenarios resolve by name. */
const LIFTS = [
  { id: 920001, title: "Back Squat", wm: 315, pr: { reps: 1, weight: 330 } },
  { id: 920002, title: "Bench Press", wm: 225, pr: { reps: 3, weight: 235 } },
  { id: 920003, title: "Deadlift", wm: 405, pr: { reps: 1, weight: 425 } },
  { id: 920004, title: "Overhead Press", wm: 135, pr: { reps: 5, weight: 145 } },
  { id: 920005, title: "Pull-Up", wm: null, pr: { reps: 12, weight: 0 } },
];

/** A 12-week progression series for one lift, ending near the PR (so "how has X progressed" reads). */
function progression(lift: (typeof LIFTS)[number]): unknown {
  const top = lift.pr.weight || 0;
  const history = Array.from({ length: 12 }, (_unused, i) => {
    const weight = Math.max(0, top - (11 - i) * 5);
    return historyEntry({
      date: `2026-0${1 + Math.floor(i / 5)}-${String(1 + (i % 5) * 5).padStart(2, "0")}`,
      reps: 5,
      weight,
    });
  });
  return {
    liftPRs: [
      liftPR({ description: "Heaviest", reps: lift.pr.reps, weight: lift.pr.weight, date: TODAY }),
    ],
    history,
  };
}

/** This-week range: three logged sessions and one upcoming scheduled, filtered to the asked window. */
function demoRange(startDate: string, endDate: string): unknown[] {
  const all = [
    athleteRangeWorkout({
      id: 8801,
      date: "2026-03-23",
      title: "Lower A",
      program: "Strength Block 3",
      logged: true,
      exercises: [
        { exerciseId: 920001, title: "Back Squat", reps: 5, weight: 285 },
        { exerciseId: 920003, title: "Deadlift", reps: 3, weight: 385 },
      ],
    }),
    athleteRangeWorkout({
      id: 8802,
      date: "2026-03-25",
      title: "Upper A",
      program: "Strength Block 3",
      logged: true,
      exercises: [
        { exerciseId: 920002, title: "Bench Press", reps: 5, weight: 205 },
        { exerciseId: 920004, title: "Overhead Press", reps: 5, weight: 125 },
      ],
    }),
    athleteRangeWorkout({
      id: 8803,
      date: "2026-03-27",
      title: "Lower B",
      program: "Strength Block 3",
      logged: true,
      exercises: [{ exerciseId: 920001, title: "Back Squat", reps: 3, weight: 295 }],
    }),
    athleteRangeWorkout({
      id: 8804,
      date: "2026-03-29",
      title: "Upper B",
      program: "Strength Block 3",
      logged: false,
      exercises: [{ exerciseId: 920002, title: "Bench Press", reps: 5, weight: 210 }],
    }),
  ];
  return all.filter((w) => {
    const d = w.date as string;
    return (!startDate || d >= startDate) && (!endDate || d <= endDate);
  });
}

/** A populated athlete account: logged + scheduled workouts, working maxes, PRs, a progression. */
export function demoAthlete(): { dataset: Dataset; athleteId: number; today: string } {
  const base = buildOrg({
    name: "demoAthlete",
    athleteCount: 12,
    programTitles: ["Strength Block 3"],
  });
  const byId = new Map(LIFTS.map((l) => [l.id, l]));
  const dataset: Dataset = {
    ...base,
    name: "demoAthlete",
    userSimple: userSimple({
      id: ATHLETE_ID,
      roles: ["athlete"],
      nameFirst: "Avery",
      nameLast: "Stone",
    }),
    getProfileSummary: () =>
      profileSummary({
        userId: ATHLETE_ID,
        sessions: 146,
        firstDate: "2024-01-08",
        lastDate: TODAY,
      }),
    getUser: (id) => athleteUser({ id, nameFirst: "Avery", nameLast: "Stone" }),
    getExerciseHistory: (exerciseId) => {
      const lift = byId.get(exerciseId);
      return lift ? progression(lift) : { liftPRs: [], history: [] };
    },
    athlete: {
      exercisesList: LIFTS.map((l) => ({
        id: l.id,
        title: l.title,
        isCircuit: false,
        param1Type: "reps",
        param2Type: "lb",
      })),
      range: demoRange,
      workingMaxes: LIFTS.map((l) => workingMax({ exerciseId: l.id, title: l.title, value: l.wm })),
      prefs: { id: ATHLETE_ID, notifications: true },
      getPersonalRecords: (exerciseId) => {
        const lift = byId.get(exerciseId);
        return lift ? [personalRecord(lift.pr)] : [];
      },
      getExerciseStats: () => ({ isLift: true, lastPerformance: null, personalRecord: null }),
    },
  };
  return { dataset, athleteId: ATHLETE_ID, today: TODAY };
}

/** A populated coach account: a named roster, teams/programs, a resolvable custom exercise, a
 * recent inbound message — enough to answer the coach read + write bank. */
export function demoCoach(): { dataset: Dataset; today: string; firstAthlete: string } {
  const base = buildOrg({
    name: "demoCoach",
    athleteCount: 12,
    programTitles: ["Varsity Strength", "Summer Conditioning", "Off-season Powerlifting"],
  });
  const library = [
    ...base.exerciseLibrary,
    libraryExercise(900100, "Romanian Deadlift"),
    libraryExercise(900101, "Front Squat"),
    { ...libraryExercise(900102, "Eval Test Sled Push"), can_edit: 1, user_id: 700000 },
  ];
  const firstAthleteId = 100001;
  const dataset: Dataset = {
    ...base,
    name: "demoCoach",
    exerciseLibrary: library,
    // Athlete001 has a bench session prescribed today, so a coach "log a result" has a set to log to.
    getCoachAthleteRange: (athleteId, startDate, endDate) =>
      athleteId === firstAthleteId &&
      (!startDate || startDate <= TODAY) &&
      (!endDate || endDate >= TODAY)
        ? [
            programWorkout({
              id: 770001,
              date: TODAY,
              workoutTitle: "Upper — Bench",
              programId: 50000,
              programTitle: "Varsity Strength",
              teamId: 10000,
              savedWorkoutId: 771001,
              savedWorkoutSetId: 772001,
              exercises: [
                {
                  id: 773001,
                  exerciseId: 920002,
                  title: "Bench Press",
                  sets: [{ reps: "8", weight: "135" }],
                },
              ],
            }),
          ]
        : [],
    messagingStreams: messagingStreams([
      { id: 5001, title: "Athlete001 Lastname001", userId: 100001 },
    ]),
    getMessages: (streamId) =>
      streamId === 5001
        ? [
            messageComment({
              id: 1,
              content: "Coach, should I add weight next week?",
              authorName: "Athlete001 Lastname001",
            }),
            messageComment({
              id: 2,
              content: "Felt strong on squats today!",
              authorName: "Athlete001 Lastname001",
            }),
          ]
        : [],
  };
  return { dataset, today: TODAY, firstAthlete: "Athlete001 Lastname001" };
}

/**
 * A coach whose athlete logged a session TODAY, plus other days. Set up to test the per-date
 * discoverability gap finding #5: athlete_training is a month overview with no per-session dates, so
 * "what did <athlete> do today" must go through athlete_saved_workouts with a one-day window (which
 * carries the date and the performed sets). The month view (getCalendarSummary) is populated and
 * noisy so a model that reaches for it gets many undated sessions and can't pin today.
 */
export function coachDayLogged(): {
  dataset: Dataset;
  athleteId: number;
  today: string;
  athleteName: string;
} {
  const base = buildOrg({
    name: "coachDayLogged",
    athleteCount: 10,
    programTitles: ["Varsity Strength"],
  });
  const athleteId = 100001;
  const athleteName = "Athlete001 Lastname001";
  const dayWorkouts: Record<string, { reps: number; weight: number; title: string }> = {
    "2026-03-20": { title: "Lower", reps: 5, weight: 285 },
    "2026-03-24": { title: "Upper", reps: 5, weight: 205 },
    [TODAY]: { title: "Lower B", reps: 3, weight: 305 },
  };
  const dataset: Dataset = {
    ...base,
    name: "coachDayLogged",
    getCoachAthleteRange: (id, startDate, endDate) => {
      if (id !== athleteId) return [];
      return Object.entries(dayWorkouts)
        .filter(([d]) => (!startDate || d >= startDate) && (!endDate || d <= endDate))
        .map(([d, w], i) =>
          athleteRangeWorkout({
            id: 760000 + i,
            date: d,
            title: w.title,
            program: "Varsity Strength",
            logged: true,
            exercises: [
              { exerciseId: 920001, title: "Back Squat", reps: w.reps, weight: w.weight },
            ],
          }),
        );
    },
    // The month overview: several undated sessions (athlete_training can't pin a specific day).
    getCalendarSummary: (id, _year, _month) =>
      id === athleteId
        ? Object.values(dayWorkouts).map((w, i) =>
            calendarSession({
              athleteName,
              workoutId: 750000 + i,
              savedWorkoutId: 751000 + i,
              workoutTitle: w.title,
              exercises: [
                { exerciseId: 920001, title: "Back Squat", abr: `${w.reps} x ${w.weight} lb` },
              ],
            }),
          )
        : [],
  };
  return { dataset, athleteId, today: TODAY, athleteName };
}
