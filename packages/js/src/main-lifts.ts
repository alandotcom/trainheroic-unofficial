// Coach-facing "main lift PRs": resolve each roster athlete's personal records for the big
// barbell lifts. The hard part is resolution. An athlete logs a specific *variant* ("Back Squat",
// not "Squat"), and a naive name->id lookup of the canonical term lands on an empty library entry.
// So we discover what the athlete actually logged (their dated calendar), bucket those exercises
// into lift families, pick the variant they log most, and pull that exercise's PR board. No
// `node:*` here — this runs unchanged on workerd.
import { coerceInt, coerceNum, mapPool } from "./exercise-util";
import {
  fetchCoachAthleteWorkouts,
  fetchExerciseHistoryDetail,
  presentAthleteWorkouts,
  presentExerciseHistory,
} from "./athlete";
import { fetchCoachRoster } from "./coach";
import type { TrainHeroicClient } from "./client";

export type MainLiftFamilyKey =
  | "cleanjerk"
  | "snatch"
  | "deadlift"
  | "squat"
  | "bench"
  | "overhead";

export type MainLiftFamily = {
  key: MainLiftFamilyKey;
  label: string;
  /** True when a lowercased exercise title belongs to this family. */
  matches: (titleLower: string) => boolean;
};

/**
 * The "main lifts" — Big 4 plus the two Olympic lifts. ORDER MATTERS: a title is classified by the
 * first family that matches, so the more specific / easily-confused families come before the broad
 * overhead-press rule. That ordering is why "Bench Press" classifies as `bench` and never gets
 * swept up as an overhead press, and why "Clean & Jerk" is not mistaken for a clean-only movement.
 * This is the single place to edit the lift set.
 */
export const MAIN_LIFT_FAMILIES: readonly MainLiftFamily[] = [
  {
    key: "cleanjerk",
    label: "Clean & Jerk",
    matches: (t) => t.includes("jerk") || (t.includes("clean") && !t.includes("clean pull")),
  },
  { key: "snatch", label: "Snatch", matches: (t) => t.includes("snatch") },
  { key: "deadlift", label: "Deadlift", matches: (t) => t.includes("deadlift") },
  { key: "squat", label: "Squat", matches: (t) => t.includes("squat") },
  { key: "bench", label: "Bench Press", matches: (t) => t.includes("bench") },
  {
    key: "overhead",
    label: "Overhead Press",
    // Qualified press only — never a bare "press", which would swallow leg/floor/chest press.
    matches: (t) =>
      t.includes("ohp") ||
      ((t.includes("overhead") ||
        t.includes("shoulder") ||
        t.includes("military") ||
        t.includes("strict") ||
        t.includes("push")) &&
        t.includes("press")),
  },
];

/** The lift family a logged exercise title belongs to, or null if it is not a main lift. */
export function classifyMainLift(title: string): MainLiftFamilyKey | null {
  const t = title.toLowerCase();
  for (const family of MAIN_LIFT_FAMILIES) {
    if (family.matches(t)) return family.key;
  }
  return null;
}

/** The main-lift variant an athlete actually logs (the most-used exercise in that family). */
export type ResolvedLift = {
  family: MainLiftFamilyKey;
  label: string;
  exerciseId: number;
  title: string;
};

export type MainLiftResolution = {
  athleteId: number;
  athleteName: string | null;
  lifts: ResolvedLift[];
};

const DEFAULT_MONTHS = 12;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** A local Date as a YYYY-MM-DD day string (the range endpoint's date format). */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Discover a roster athlete's main lifts from what they actually logged. Reads the athlete's
 * logged workouts over the last `months` (default 12) — the program-workout range, the reliable
 * record of performed sets — buckets every performed exercise into a lift family, and for each
 * family picks the variant logged most often. Returns one entry per family the athlete has logged;
 * families they never trained are simply absent. (The monthly calendar summary is not used: it
 * comes back empty for some accounts that have logged sets in the range endpoint.)
 */
export async function resolveAthleteMainLifts(
  client: TrainHeroicClient,
  athleteId: number,
  opts: { months?: number; now?: Date } = {},
): Promise<MainLiftResolution> {
  const months = opts.months ?? DEFAULT_MONTHS;
  const now = opts.now ?? new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  // family -> exerciseId -> { count, title }: how often the athlete logged each variant.
  const tally = new Map<MainLiftFamilyKey, Map<number, { count: number; title: string }>>();

  let workouts: Awaited<ReturnType<typeof fetchCoachAthleteWorkouts>> = [];
  try {
    workouts = await fetchCoachAthleteWorkouts(client, athleteId, isoDay(start), isoDay(now));
  } catch {
    // A failed range read leaves the athlete with no resolved lifts rather than aborting a roster.
    workouts = [];
  }

  for (const view of presentAthleteWorkouts(workouts)) {
    for (const block of view.blocks) {
      for (const ex of block.exercises) {
        // Only count a lift the athlete actually performed (logged a set), not merely prescribed.
        if (ex.performed.length === 0 || ex.exerciseId === null) continue;
        const family = classifyMainLift(ex.title);
        if (family === null) continue;
        const byId = tally.get(family) ?? new Map<number, { count: number; title: string }>();
        const prev = byId.get(ex.exerciseId);
        byId.set(ex.exerciseId, { count: (prev?.count ?? 0) + 1, title: prev?.title ?? ex.title });
        tally.set(family, byId);
      }
    }
  }

  const lifts: ResolvedLift[] = [];
  for (const family of MAIN_LIFT_FAMILIES) {
    const byId = tally.get(family.key);
    if (!byId || byId.size === 0) continue;
    // The dominant variant: most-logged, breaking ties on the lower exercise id for stability.
    let best: { exerciseId: number; count: number; title: string } | null = null;
    for (const [exerciseId, { count, title }] of byId) {
      if (
        best === null ||
        count > best.count ||
        (count === best.count && exerciseId < best.exerciseId)
      ) {
        best = { exerciseId, count, title };
      }
    }
    if (best)
      lifts.push({
        family: family.key,
        label: family.label,
        exerciseId: best.exerciseId,
        title: best.title,
      });
  }

  // The range view carries no athlete name; roster-level callers supply it from /v5/athletes.
  return { athleteId, athleteName: null, lifts };
}

/** One main lift's best PR for an athlete. A family the athlete has not logged has a null body. */
export type MainLiftPR = {
  family: MainLiftFamilyKey;
  label: string;
  exerciseId: number | null;
  title: string | null;
  weight: number | null;
  reps: number | null;
  units: string | null;
  date: string | null;
};

export type AthleteMainLiftPRs = {
  athleteId: number;
  athleteName: string | null;
  prs: MainLiftPR[];
};

const PR_CONCURRENCY = 5;

type BestPr = { weight: number; reps: number | null; units: string | null; date: string | null };

/** The heaviest PR on an exercise's board (ties broken by more reps). */
function bestPr(liftPRs: ReturnType<typeof presentExerciseHistory>["liftPRs"]): BestPr | null {
  let best: BestPr | null = null;
  for (const pr of liftPRs) {
    const weight = coerceNum(pr.weight);
    if (weight === null) continue;
    const reps = coerceInt(pr.reps);
    if (
      best === null ||
      weight > best.weight ||
      (weight === best.weight && (reps ?? 0) > (best.reps ?? 0))
    ) {
      best = { weight, reps, units: pr.units, date: pr.date };
    }
  }
  return best;
}

/**
 * A roster athlete's best PR for each main lift. Discovers the lift variants they log
 * ({@link resolveAthleteMainLifts}), then pulls each variant's PR board and keeps the heaviest set.
 * The result always carries one entry per family in {@link MAIN_LIFT_FAMILIES} order; a family the
 * athlete has not logged comes back with null fields (the "no PR yet" case), so a dashboard can
 * render a stable row of columns.
 */
export async function fetchAthleteMainLiftPRs(
  client: TrainHeroicClient,
  athleteId: number,
  opts: { months?: number; now?: Date } = {},
): Promise<AthleteMainLiftPRs> {
  const { athleteName, lifts } = await resolveAthleteMainLifts(client, athleteId, opts);
  const byFamily = new Map(lifts.map((l) => [l.family, l]));

  const prs = await mapPool(
    MAIN_LIFT_FAMILIES,
    PR_CONCURRENCY,
    async (family): Promise<MainLiftPR> => {
      const lift = byFamily.get(family.key);
      const base = { family: family.key, label: family.label };
      const empty = {
        exerciseId: null,
        title: null,
        weight: null,
        reps: null,
        units: null,
        date: null,
      };
      if (!lift) return { ...base, ...empty };
      const known = { exerciseId: lift.exerciseId, title: lift.title };
      try {
        const detail = await fetchExerciseHistoryDetail(client, lift.exerciseId, athleteId);
        const best = bestPr(presentExerciseHistory(detail).liftPRs);
        return {
          ...base,
          ...known,
          weight: best?.weight ?? null,
          reps: best?.reps ?? null,
          units: best?.units ?? null,
          date: best?.date ?? null,
        };
      } catch {
        // Lift is known but its history could not be read — surface the variant without a PR.
        return { ...base, ...known, weight: null, reps: null, units: null, date: null };
      }
    },
  );

  return { athleteId, athleteName, prs };
}

const ROSTER_CONCURRENCY = 4;

/**
 * Every roster athlete's main-lift PRs in one call: list the roster ({@link fetchCoachRoster}) and
 * resolve each athlete's board ({@link fetchAthleteMainLiftPRs}), fanned out with a bounded pool.
 * `athleteIds` restricts to a subset (else the whole roster). Each entry's `athleteName` falls back
 * to the roster name when the per-athlete read can't supply one. This is the single roster-level
 * primitive the CLI, the MCP tool, and the warehouse store all build on.
 */
export async function fetchRosterMainLiftPRs(
  client: TrainHeroicClient,
  opts: { athleteIds?: readonly number[]; months?: number; now?: Date; concurrency?: number } = {},
): Promise<AthleteMainLiftPRs[]> {
  const roster = await fetchCoachRoster(client, opts.athleteIds);
  const inner: { months?: number; now?: Date } = {
    ...(opts.months !== undefined ? { months: opts.months } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  };
  return mapPool(roster, opts.concurrency ?? ROSTER_CONCURRENCY, async (athlete) => {
    const result = await fetchAthleteMainLiftPRs(client, athlete.id, inner);
    return {
      athleteId: athlete.id,
      athleteName: result.athleteName ?? athlete.name,
      prs: result.prs,
    };
  });
}
