// Fixture datasets for the fake TrainHeroic backend. These exist to simulate a *large* org —
// hundreds of athletes, dozens of teams, programs whose detail only resolves one call at a time —
// which the sparse real test accounts can't. Each builder returns a fully-resolved `Dataset` the
// fake backend answers every route from; builders compose the same primitives so scenarios differ
// only in scale and structure (many programs, large roster, ambiguous titles).

import { historyCorpus } from "./history";
import type { HistoryCorpus } from "./history";

export type AthleteRow = Record<string, unknown> & { id: number; groups: number[] };
export type TeamRow = Record<string, unknown> & { id: number; group_program: number };

export type Dataset = {
  /** Human label, surfaced in failure reports. */
  name: string;
  /** GET /user/simple */
  userSimple: Record<string, unknown>;
  /** GET /1.0/coach/programs — standalone programs, commonly [] for a team-based coach. */
  programs: unknown[];
  /** GET /v5/athletes — the org-wide roster. */
  athletes: AthleteRow[];
  /** GET /1.0/coach/teams (the backend paginates/filters this). */
  teams: TeamRow[];
  /** GET /3.0/coach/program/:id — the deep program object (carries the title). */
  getProgram: (programId: number) => unknown | null;
  /** GET /v5/teams/:id */
  getTeam: (teamId: number) => unknown | null;
  /** GET /v5/athleteProfile/summary?user_id= — all-time training totals, fanned out per athlete. */
  getProfileSummary: (userId: number) => Record<string, unknown> | null;
  /** GET /2.0/coach/athlete/calendar/summary/:athleteId/:year/:month/7 */
  getCalendarSummary: (athleteId: number, year: number, month: number) => unknown[];
  /** POST /v5/analytics/training-summary/users — one row per logged session (team_volume). */
  getTrainingSummary: (
    userIds: number[],
    dateStart: string,
    dateEnd: string,
  ) => { rows: unknown[] };
  /** GET /3.0/coach/athlete/programworkout/range/:athleteId */
  getCoachAthleteRange: (athleteId: number, startDate: string, endDate: string) => unknown[];
  /** GET /v5/exercises/:id/history?userId= — PR board + dated series (athlete_lift_history). */
  getExerciseHistory: (exerciseId: number, athleteId: number) => unknown;
  /** GET /v5/exerciseLibrary/all — the org's exercise catalog (exercise_resolve/search/get). */
  exerciseLibrary: Array<Record<string, unknown>>;
};

/** A small default exercise catalog, matching the exercise_ids the synthetic programs reference. */
function defaultExerciseLibrary(): Array<Record<string, unknown>> {
  const names = [
    "Back Squat",
    "Bench Press",
    "Deadlift",
    "Barbell Row",
    "Overhead Press",
    "Barbell Curl",
  ];
  return names.map((title, e) => ({ id: 900000 + e, title, param_1_type: 1, param_2_type: 2 }));
}

const COACH_ID = 700000;
const ATHLETE_BASE = 100000;
const TEAM_BASE = 10000;
const PROGRAM_BASE = 50000;

function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}

/** A roster athlete row. Padded with realistic-ish fields so a few hundred rows exceed the MCP
 * result budget — which is what forces the agent to narrow rather than swallow the whole list. */
function makeAthlete(i: number, teamIds: number[]): AthleteRow {
  const first = `Athlete${pad(i)}`;
  const last = `Lastname${pad(i)}`;
  return {
    id: ATHLETE_BASE + i,
    name: `${first} ${last}`,
    name_first: first,
    name_last: last,
    email: `athlete${pad(i)}@example.com`,
    groups: teamIds,
    groupTitles: teamIds.map((t) => `Team ${t - TEAM_BASE}`),
    teamCount: teamIds.length,
    daysSinceLastLogin: i % 30,
    gender: i % 2 === 0 ? "M" : "F",
    city: `City${pad(i % 50)}`,
    state: ["CA", "TX", "NY", "FL", "WA"][i % 5],
    height_in: 60 + (i % 18),
    weight_lb: 130 + (i % 110),
    birthdate: `19${80 + (i % 20)}-0${1 + (i % 9)}-1${i % 9}`,
    avatar_url: `https://example.invalid/avatars/${pad(i)}.png`,
    phone: `555-01${pad(i, 2).slice(0, 2)}-${pad(i, 4)}`,
  };
}

/** A program detail object. `blocks` scales its serialized size; the title is a top-level scalar so
 * it survives truncation, which is what get_program's bounded-serialization relies on. */
function makeProgram(programId: number, title: string, blocks: number): unknown {
  const sessions = [];
  for (let b = 0; b < blocks; b += 1) {
    const exercises = [];
    for (let e = 0; e < 6; e += 1) {
      exercises.push({
        id: programId * 100 + b * 10 + e,
        exercise_id: 900000 + e,
        title: `Exercise ${e + 1}`,
        param_1_type: "reps",
        param_2_type: "lb",
        instruction: `Block ${b + 1} exercise ${e + 1}: perform with controlled tempo and full range of motion.`,
        param_1_data_1: "5",
        param_2_data_1: "185",
        param_1_data_2: "5",
        param_2_data_2: "195",
        param_1_data_3: "5",
        param_2_data_3: "205",
      });
    }
    sessions.push({
      id: programId * 10 + b,
      order: b,
      title: `Week ${b + 1} Day 1`,
      workoutSetExercises: exercises,
    });
  }
  return {
    id: programId,
    title,
    name: title,
    description: `${title} — a structured block of training.`,
    weeks: blocks,
    workoutSets: sessions,
  };
}

function makeProfileSummary(userId: number): Record<string, unknown> {
  const i = userId - ATHLETE_BASE;
  const sessions = i % 7 === 0 ? 0 : 10 + (i % 90);
  const day = 1 + (i % 27);
  return {
    user_id: userId,
    sessions_count: sessions,
    first_logged_date: sessions > 0 ? "2026-01-05" : "1970-01-01",
    last_logged_date: sessions > 0 ? `2026-06-${pad(day, 2)}` : "1970-01-01",
    reps_sum: sessions * 120,
    volume_sum: sessions * 14500,
  };
}

/** One month of logged sessions for an athlete, in the calendar-summary shape the coach view reads. */
function makeCalendar(athleteId: number, year: number, month: number, title: string): unknown[] {
  const i = athleteId - ATHLETE_BASE;
  // Some athletes logged nothing this month.
  if (i % 7 === 0) return [];
  const count = 1 + (i % 3);
  const rows = [];
  for (let s = 0; s < count; s += 1) {
    rows.push({
      athleteName: `Athlete${pad(i)} Lastname${pad(i)}`,
      workout_id: athleteId * 100 + s,
      saved_workout_id: athleteId * 1000 + s,
      workout_title: `${title} — Day ${s + 1}`,
      logged: 1,
      completed: 1,
      rpe: 6 + (s % 3),
      session_duration: 45 + s * 5,
      notes: s === 0 ? "Felt strong today." : "",
      sets: [
        {
          exercises: [
            { exercise_id: 900001, title: "Back Squat", abr: "5 x 3 @ 225 lb", completed: 1 },
            { exercise_id: 900002, title: "Bench Press", abr: "5 x 5 @ 185 lb", completed: 1 },
          ],
        },
      ],
    });
  }
  return rows;
}

function baseUserSimple(): Record<string, unknown> {
  return {
    id: COACH_ID,
    org_id: 4242,
    name: "Coach Casey",
    first_name: "Casey",
    last_name: "Coach",
    roles: ["coach"],
    trial_days_remaining: 0,
  };
}

type OrgOptions = {
  name: string;
  athleteCount: number;
  /** Titles for each team's program, one per team. */
  programTitles: string[];
  /** Serialized size of each program's detail, in blocks (large → truncates get_program). */
  programBlocks?: number | ((teamIndex: number) => number);
  /** Standalone programs returned by list_programs (usually empty). */
  standalonePrograms?: unknown[];
};

/**
 * Build a coach org from athlete count + a program title per team. Athletes are distributed
 * round-robin across teams (so every team has members and most athletes carry a couple of teams).
 */
function buildOrg(opts: OrgOptions): Dataset {
  const teamCount = opts.programTitles.length;
  const teams: TeamRow[] = opts.programTitles.map((title, t) => ({
    id: TEAM_BASE + t,
    title: `Team ${t} — ${title}`,
    name: `Team ${t}`,
    group_program: PROGRAM_BASE + t,
    member_count: 0,
    athlete_count: 0,
    athleteIds: [COACH_ID],
  }));

  const athletes: AthleteRow[] = [];
  for (let i = 1; i <= opts.athleteCount; i += 1) {
    // Each athlete belongs to one primary team and, for variety, a second team.
    const primary = TEAM_BASE + (i % teamCount);
    const secondary = TEAM_BASE + ((i + 1) % teamCount);
    const teamIds = primary === secondary ? [primary] : [primary, secondary];
    athletes.push(makeAthlete(i, teamIds));
  }

  const programByTeamIndex = (teamIndex: number): unknown => {
    const title = opts.programTitles[teamIndex] ?? `Program ${teamIndex}`;
    const blocks =
      typeof opts.programBlocks === "function"
        ? opts.programBlocks(teamIndex)
        : (opts.programBlocks ?? 3);
    return makeProgram(PROGRAM_BASE + teamIndex, title, blocks);
  };

  const titleFor = (teamIndex: number): string =>
    opts.programTitles[teamIndex] ?? `Program ${teamIndex}`;

  return {
    name: opts.name,
    userSimple: baseUserSimple(),
    programs: opts.standalonePrograms ?? [],
    athletes,
    teams,
    getProgram: (programId) => {
      const teamIndex = programId - PROGRAM_BASE;
      if (teamIndex < 0 || teamIndex >= teamCount) return null;
      return programByTeamIndex(teamIndex);
    },
    getTeam: (teamId) => teams.find((t) => t.id === teamId) ?? null,
    getProfileSummary: (userId) =>
      athletes.some((a) => a.id === userId) ? makeProfileSummary(userId) : null,
    getCalendarSummary: (athleteId, year, month) => {
      const athlete = athletes.find((a) => a.id === athleteId);
      if (!athlete) return [];
      const teamIndex = (athlete.groups[0] ?? TEAM_BASE) - TEAM_BASE;
      return makeCalendar(athleteId, year, month, titleFor(teamIndex));
    },
    getTrainingSummary: (userIds, _dateStart, _dateEnd) => {
      const rows: unknown[] = [];
      for (const userId of userIds) {
        const summary = makeProfileSummary(userId);
        const sessions = Number(summary.sessions_count) || 0;
        if (sessions === 0) continue;
        const logged = Math.min(sessions, 8);
        const i = userId - ATHLETE_BASE;
        for (let s = 0; s < logged; s += 1) {
          rows.push({
            user_id: userId,
            name_first: `Athlete${pad(i)}`,
            name_last: `Lastname${pad(i)}`,
            date_completed: `2026-06-${pad(1 + ((i + s) % 27), 2)}`,
            reps: 80 + ((i + s) % 60),
            volume: 9000 + ((i + s) % 4000),
          });
        }
      }
      return { rows };
    },
    getCoachAthleteRange: () => [],
    getExerciseHistory: () => ({ liftPRs: [], history: [] }),
    exerciseLibrary: defaultExerciseLibrary(),
  };
}

/**
 * Dozens of distinctly-titled team programs (list_programs returns []), so resolving "what
 * programs do I run" forces the agent through list_teams and one get_program per team — the real
 * "no program-title index" cost that confuses agents when there are many.
 */
export function manyPrograms(teamCount = 30): Dataset {
  const flavors = [
    "Strength",
    "Hypertrophy",
    "Powerlifting",
    "Olympic Lifting",
    "Conditioning",
    "Speed & Agility",
    "Endurance",
    "Mobility",
    "Off-season",
    "In-season",
    "Pre-season",
    "GPP",
    "Linebackers",
    "Sprinters",
    "Volleyball",
    "Wrestling",
    "Rowing",
    "CrossFit",
    "Bodyweight",
    "Return-to-Play",
  ];
  const titles = Array.from(
    { length: teamCount },
    (_, t) => `${flavors[t % flavors.length]} Block ${Math.floor(t / flavors.length) + 1}`,
  );
  return buildOrg({ name: `manyPrograms(${teamCount})`, athleteCount: 80, programTitles: titles });
}

/**
 * A few hundred athletes plus one oversized program. list_athletes returns the whole roster, which
 * exceeds the result budget and truncates — the agent must narrow (q/limit) or pivot to a targeted
 * tool rather than give up. The big program also truncates get_program.
 */
export function largeRoster(athleteCount = 300): Dataset {
  const titles = ["Varsity Strength", "JV Strength", "Summer Conditioning", "Team Powerlifting"];
  return buildOrg({
    name: `largeRoster(${athleteCount})`,
    athleteCount,
    programTitles: titles,
    // First team's program is huge; the rest are normal.
    programBlocks: (t) => (t === 0 ? 60 : 3),
  });
}

/**
 * Several teams whose program titles all contain "Bodybuilding", among other programs. "Today's
 * bodybuilding" is therefore ambiguous — the right move is to ask which one, not to guess.
 */
export function ambiguousBodybuilding(): Dataset {
  const titles = [
    "Summer Bodybuilding",
    "Off-season Bodybuilding Hypertrophy",
    "Beginner Bodybuilding",
    "Powerlifting",
    "Olympic Lifting",
    "Conditioning",
    "Bodybuilding Prep (Advanced)",
    "Mobility & Recovery",
  ];
  return buildOrg({ name: "ambiguousBodybuilding", athleteCount: 60, programTitles: titles });
}

// --- High-enrollment athlete (issue #18) ---

const HE_PROGRAM_TITLES = [
  "Strength",
  "Hypertrophy",
  "Conditioning",
  "Olympic Lifting",
  "Speed Development",
  // The unique target program (index 5).
  "Powerlifting",
  "Mobility",
  "GPP",
];
const HE_TARGET_INDEX = 5;
const HE_SAVED_SET_BASE = 880000;
const HE_SAVED_EX_BASE = 770000;

/** Identifiers the #18 scenario asserts against — the target program's saved log ids. */
export const HIGH_ENROLLMENT = {
  athleteId: ATHLETE_BASE + 1,
  athleteName: `Athlete${pad(1)} Lastname${pad(1)}`,
  date: "2026-06-22",
  programCount: HE_PROGRAM_TITLES.length,
  targetProgramTitle: HE_PROGRAM_TITLES[HE_TARGET_INDEX] as string,
  targetProgramId: PROGRAM_BASE + HE_TARGET_INDEX,
  targetSavedWorkoutSetId: HE_SAVED_SET_BASE + HE_TARGET_INDEX,
  targetSavedWorkoutSetExerciseId: HE_SAVED_EX_BASE + HE_TARGET_INDEX * 100,
};

/** One coach-athlete-range workout for program index t, in the raw saved-copy shape the SDK reads. */
function makeCoachWorkout(t: number, date: string): unknown {
  const title = HE_PROGRAM_TITLES[t] ?? `Program ${t}`;
  const named = ["Back Squat", "Bench Press", "Deadlift", "Row", "Press", "Curl"];
  const exercises = [];
  // Enough exercises that the RAW range across all programs exceeds the MCP result budget (so it
  // truncates, per #18) while the compact log-targets view stays well under it.
  for (let e = 0; e < 24; e += 1) {
    exercises.push({
      id: HE_SAVED_EX_BASE + t * 100 + e,
      exercise_id: 900000 + e,
      exercise_title: named[e] ?? `Exercise ${e + 1}`,
      param_1_type: "reps",
      param_2_type: "lb",
      instruction: `${title} — perform set ${e + 1} with controlled tempo through a full range of motion, resting as prescribed.`,
      param_1_data_1: "5",
      param_2_data_1: "185",
      param_1_data_2: "5",
      param_2_data_2: "195",
      param_1_data_3: "5",
      param_2_data_3: "205",
    });
  }
  return {
    id: 149000000 + t,
    date,
    workout_title: `${title} — Day 1`,
    program_id: PROGRAM_BASE + t,
    program_title: title,
    team_id: TEAM_BASE + t,
    team_title: title,
    summarizedSavedWorkout: {
      saved_workout: {
        id: 148000000 + t,
        workoutSets: [
          { id: HE_SAVED_SET_BASE + t, title: "Main", order: 0, workoutSetExercises: exercises },
        ],
      },
    },
  };
}

/**
 * One athlete enrolled in many programs, all with a session on the same day (issue #18). The raw
 * coach-athlete range is large enough to truncate the MCP result, so the savedWorkoutSetId /
 * savedWorkoutSetExerciseId a coach needs to prescribe or log are reachable only via the compact
 * default view or a programId filter — which is exactly what the fix provides. The target is the
 * uniquely-titled "Powerlifting" session.
 */
export function highEnrollmentAthlete(programCount = HE_PROGRAM_TITLES.length): Dataset {
  const titles = HE_PROGRAM_TITLES.slice(0, programCount);
  const base = buildOrg({
    name: `highEnrollmentAthlete(${programCount})`,
    athleteCount: 40,
    programTitles: titles,
  });
  const athleteId = ATHLETE_BASE + 1;
  return {
    ...base,
    getCoachAthleteRange: (id, _startDate, _endDate) =>
      id === athleteId ? titles.map((_title, t) => makeCoachWorkout(t, HIGH_ENROLLMENT.date)) : [],
  };
}

// --- Deep training history (2-year real corpus) ---

/** Identifiers the history scenarios assert against, filled in from the loaded corpus. */
export type HistoryAthleteInfo = {
  athleteId: number;
  corpus: HistoryCorpus;
};

/**
 * One athlete with a real 2-year training history (1192 sessions, ~839 exercises) served through
 * the month-calendar and per-exercise-history endpoints. This is the dataset for testing that an
 * agent can navigate deep history — pull a month, trend one lift across the corpus — at a scale the
 * sparse real test accounts can't reach. The history is read-only program content (no PII); see
 * src/history.ts for how the prescribed export maps onto the raw API shapes.
 */
export function historyAthlete(): { dataset: Dataset; info: HistoryAthleteInfo } {
  const athleteId = ATHLETE_BASE + 1;
  const corpus = historyCorpus(`Athlete${pad(1)} Lastname${pad(1)}`);
  const base = buildOrg({
    name: "historyAthlete(2yr)",
    athleteCount: 20,
    programTitles: ["Bodybuilding", "Strength", "Conditioning"],
  });
  const dataset: Dataset = {
    ...base,
    name: "historyAthlete(2yr)",
    getCalendarSummary: (id, year, month) =>
      id === athleteId ? corpus.getCalendarSummary(year, month) : [],
    getExerciseHistory: (exerciseId, id) =>
      id === athleteId ? corpus.getExerciseHistory(exerciseId) : { liftPRs: [], history: [] },
    exerciseLibrary: corpus.exerciseLibrary,
  };
  return { dataset, info: { athleteId, corpus } };
}
