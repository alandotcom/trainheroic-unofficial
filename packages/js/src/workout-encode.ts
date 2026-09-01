// Pure encoder for the workout builder. No I/O, so it is unit-testable directly.
// Mirrors build_workout.py: fills every field saveWorkoutSetExercises needs (else
// HTTP 500), keeps RPE out of structured params (the API coerces it to weight), and
// encodes Red-Zone leaderboards.

import type { Advisory, BlockSpec, ExerciseSpec } from "@trainheroic-unofficial/dto";
import {
  type ExerciseIndex,
  PARAM_NONE,
  PARAM_PCT_MAX,
  PARAM_REPS,
  PARAM_RPE,
  PARAM_WEIGHT,
  unitLabel,
} from "./exercise-util";

type AdvisoryIndex = Pick<ExerciseIndex, "defaultsMany" | "ensureFresh">;

export const MAX_SETS_PER_EXERCISE = 10;

export type SetSplit = {
  blockTitle: string;
  exerciseTitle: string;
  setCount: number;
  blockCount: number;
};

// Red-Zone leaderboard unit -> redzone_type. Values from the coach app bundle.
export const LEADERBOARD_TYPE: Readonly<Record<string, number>> = {
  completion: 0,
  "for completion": 0,
  weight: 1,
  lb: 1,
  load: 1,
  reps: 2,
  rep: 2,
  rounds: 3,
  round: 3,
  time: 4,
  yards: 5,
  yd: 5,
  meters: 6,
  m: 6,
  feet: 7,
  ft: 7,
  calories: 8,
  cal: 8,
  cals: 8,
  miles: 10,
  mi: 10,
  inches: 12,
  in: 12,
  watts: 15,
  w: 15,
  velocity: 17,
  "m/s": 17,
  seconds: 18,
  sec: 18,
  s: 18,
};

export const LEADERBOARD_LABEL: Readonly<Record<number, string>> = {
  0: "For Completion",
  1: "Weight",
  2: "Reps",
  3: "Rounds",
  4: "Time",
  5: "Yards",
  6: "Meters",
  7: "Feet",
  8: "Calories",
  10: "Miles",
  12: "Inches",
  13: "Other",
  15: "Watts",
  16: "Percent",
  17: "Velocity",
  18: "Seconds",
};

export type Leaderboard = {
  isRedzone: number | null;
  redzoneType: number;
  smallerIsBetter: number | null;
  redzoneInstruction: string;
};

export function resolveLeaderboard(block: BlockSpec): Leaderboard {
  const lb = block.leaderboard;
  if (lb === undefined || lb === null) {
    return { isRedzone: null, redzoneType: 0, smallerIsBetter: null, redzoneInstruction: "" };
  }

  let unit: string | number | undefined;
  let instruction = "";
  let lowest: boolean | undefined;
  if (typeof lb === "object") {
    unit = lb.unit ?? lb.type;
    instruction = lb.instruction ?? "";
    lowest = lb.lowest_wins;
  } else {
    unit = lb;
  }

  let rz: number;
  if (typeof unit === "string") {
    const found = LEADERBOARD_TYPE[unit.trim().toLowerCase()];
    if (found === undefined) {
      throw new Error(
        `Unknown leaderboard unit '${unit}'. Use one of: ${Object.keys(LEADERBOARD_TYPE).join(", ")}.`,
      );
    }
    rz = found;
  } else if (typeof unit === "number") {
    rz = Math.trunc(unit);
  } else {
    throw new Error("Leaderboard requires a unit.");
  }

  // Default: lowest-wins for Time/Seconds (fastest wins), highest-wins otherwise.
  if (lowest === undefined) lowest = rz === 4 || rz === 18;
  return {
    isRedzone: 1,
    redzoneType: rz,
    smallerIsBetter: lowest ? 1 : 0,
    redzoneInstruction: instruction,
  };
}

function slots(values: readonly string[] | null, n = 10): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(values && i < values.length ? (values[i] ?? "") : "");
  return out;
}

export function repsList(ex: ExerciseSpec): string[] {
  const reps = ex.reps;
  if (Array.isArray(reps)) return reps.map((r) => String(r));
  if (reps === undefined || reps === null) return [];
  const sets = Math.max(1, Math.trunc(Number(ex.sets ?? 1)) || 1);
  return Array.from({ length: sets }, () => String(reps));
}

/** Number of sets that the encoder will write for an exercise. */
export function exerciseSetCount(ex: ExerciseSpec): number {
  const reps = repsList(ex);
  if (reps.length > 0) return reps.length;
  if (Array.isArray(ex.weight)) return ex.weight.length;
  if (ex.weight !== undefined && ex.weight !== null) {
    return Math.max(1, Math.trunc(Number(ex.sets ?? 1)) || 1);
  }
  return 0;
}

export function findSetSplits(blocks: readonly BlockSpec[]): SetSplit[] {
  return blocks.flatMap((block) =>
    block.exercises.flatMap((exercise) => {
      const setCount = exerciseSetCount(exercise);
      if (setCount <= MAX_SETS_PER_EXERCISE) return [];
      return [
        {
          blockTitle: block.title,
          exerciseTitle: exercise.title ?? String(exercise.id),
          setCount,
          blockCount: Math.ceil(setCount / MAX_SETS_PER_EXERCISE),
        },
      ];
    }),
  );
}

export function setSplitSummary(blocks: readonly BlockSpec[]): string | null {
  const splits = findSetSplits(blocks);
  if (splits.length === 0) return null;
  const details = splits
    .map(
      ({ blockTitle, exerciseTitle, setCount, blockCount }) =>
        `${blockTitle} / ${exerciseTitle}: ${setCount} sets into ${blockCount} blocks`,
    )
    .join("; ");
  return (
    `TrainHeroic supports at most ${MAX_SETS_PER_EXERCISE} sets per exercise block. ` +
    `The following will be split into consecutive same-titled blocks: ${details}.`
  );
}

function sliceExercise(exercise: ExerciseSpec, start: number): ExerciseSpec | null {
  const setCount = exerciseSetCount(exercise);
  if (start > 0 && setCount <= start) return null;

  const chunkCount =
    setCount === 0 ? 0 : Math.min(MAX_SETS_PER_EXERCISE, Math.max(0, setCount - start));
  const chunk = { ...exercise };

  if (Array.isArray(exercise.reps)) {
    chunk.reps = exercise.reps.slice(start, start + MAX_SETS_PER_EXERCISE);
    delete chunk.sets;
  } else if (exercise.reps !== undefined && exercise.reps !== null) {
    chunk.sets = chunkCount;
  }

  if (Array.isArray(exercise.weight)) {
    chunk.weight = exercise.weight.slice(start, start + MAX_SETS_PER_EXERCISE);
    if (exercise.reps === undefined || exercise.reps === null) delete chunk.sets;
  } else if (
    (exercise.reps === undefined || exercise.reps === null) &&
    exercise.weight !== undefined &&
    exercise.weight !== null
  ) {
    chunk.sets = chunkCount;
  }

  return chunk;
}

/**
 * Split blocks so no encoded exercise exceeds TrainHeroic's ten parameter slots.
 * Exercises in a superset stay aligned by set range; shorter exercises appear only in
 * chunks where they still have sets.
 */
export function splitOversizedBlocks(blocks: readonly BlockSpec[]): BlockSpec[] {
  return blocks.flatMap((block) => {
    const largestSetCount = Math.max(0, ...block.exercises.map(exerciseSetCount));
    const chunkCount = Math.max(1, Math.ceil(largestSetCount / MAX_SETS_PER_EXERCISE));
    if (chunkCount === 1) return [block];

    return Array.from({ length: chunkCount }, (_, index) => {
      const start = index * MAX_SETS_PER_EXERCISE;
      const exercises = block.exercises
        .map((exercise) => sliceExercise(exercise, start))
        .filter((exercise): exercise is ExerciseSpec => exercise !== null);
      return { ...block, exercises };
    });
  });
}

/** Build one saveWorkoutSetExercises payload entry with all ten param slots filled. */
export function makeExercise(
  ex: ExerciseSpec,
  workoutSetId: number,
  order: number,
  key: string,
): Record<string, unknown> {
  const reps = repsList(ex);
  let instruction = ex.instr ?? "";
  if (instruction === "" && ex.rpe !== undefined && ex.rpe !== null) instruction = `RPE ${ex.rpe}`;

  const hasWeight = ex.weight !== undefined && ex.weight !== null;
  const weightArr = Array.isArray(ex.weight) ? ex.weight : null;

  // Effective set count: reps drive it; for a weight-only prescription fall back to
  // the weight array length, else the sets count (or 1). Without this a scalar weight
  // with no reps would be silently dropped (reps.length === 0).
  const count = exerciseSetCount(ex);

  let param2Type: number;
  let param2Values: string[] | null;
  if (hasWeight) {
    param2Type = ex.param_2_type ?? PARAM_WEIGHT;
    const arr = weightArr ?? Array.from({ length: count }, () => ex.weight as number);
    param2Values = arr.map((v) => String(v));
  } else {
    param2Type = PARAM_NONE;
    param2Values = null;
  }

  const entry: Record<string, unknown> = {
    exercise_id: ex.id,
    workout_set_id: workoutSetId,
    set_id: workoutSetId,
    setKey: workoutSetId,
    title: ex.title ?? "",
    instruction,
    order,
    param_1_type: ex.param_1_type ?? PARAM_REPS,
    param_2_type: param2Type,
    workout_set_exercise_template_id: null,
    no_sets: 0,
    param_count: count,
    set_num: count,
    key,
    video_url: "",
    thumbnail_url: "",
    tags: [],
    eType: "e",
    use_count: 0,
  };

  const p1 = slots(reps, MAX_SETS_PER_EXERCISE);
  const p2 = slots(param2Values, MAX_SETS_PER_EXERCISE);
  for (let i = 0; i < MAX_SETS_PER_EXERCISE; i += 1) {
    entry[`param_1_data_${i + 1}`] = p1[i] ?? "";
    entry[`param_2_data_${i + 1}`] = p2[i] ?? "";
  }
  return entry;
}

/** Block `type` values the coach calendar accepts (verified in workout-creation.md). */
export const BLOCK_TYPE_CONDITIONING = 1;
export const BLOCK_TYPE_HYPERTROPHY = 2;

/**
 * Default block type: text-only (empty exercises) blocks are Conditioning / Circuit (type 1);
 * structured exercise blocks default to Hypertrophy (type 2). An explicit `type` always wins.
 */
export function defaultBlockType(block: BlockSpec): number {
  if (block.type !== undefined) return block.type;
  return block.exercises.length === 0 ? BLOCK_TYPE_CONDITIONING : BLOCK_TYPE_HYPERTROPHY;
}

export function buildBlockPayload(
  blocks: readonly BlockSpec[],
  workoutId: number,
): Array<Record<string, unknown>> {
  return blocks.map((b, i) => {
    const lb = resolveLeaderboard(b);
    return {
      workout_id: workoutId,
      order: i + 1,
      type: defaultBlockType(b),
      instruction: b.instruction ?? "",
      is_redzone: lb.isRedzone,
      redzone_type: lb.redzoneType,
      smaller_is_better: lb.smallerIsBetter,
      redzone_instruction: lb.redzoneInstruction,
      exercises: [],
      exerciseKeys: [],
      key: `k::${workoutId}${i + 1}`,
      title: b.title,
    };
  });
}

function unitOr(t: number | null): string {
  return unitLabel(t) ?? "?";
}

/** Flag spec params the API will silently override to the exercise's fixed units. */
export function unitAdvisory(
  blockTitle: string,
  ex: ExerciseSpec,
  defaults: { param1: number | null; param2: number | null },
): Advisory {
  const notes: string[] = [];
  const warnings: string[] = [];
  const u = unitOr;
  const label = `${blockTitle} / ${ex.title ?? ex.id}`;

  // An explicit `sets` is ignored when `reps` is an array (array length wins); surface
  // it rather than silently building a different number of sets than asked for.
  if (Array.isArray(ex.reps) && ex.sets !== undefined && ex.reps.length !== ex.sets) {
    warnings.push(
      `${label}: reps array has ${ex.reps.length} entr${ex.reps.length === 1 ? "y" : "ies"}; sets:${ex.sets} is ignored — building ${ex.reps.length} set(s).`,
    );
  }

  const sentP1 = ex.param_1_type;
  if (sentP1 !== undefined && sentP1 !== null && Math.trunc(Number(sentP1)) !== defaults.param1) {
    const sp1 = Math.trunc(Number(sentP1));
    warnings.push(
      `${label}: param_1_type ${sentP1} (${u(sp1)}) is ignored — this exercise is fixed to ${u(defaults.param1)}; values render as ${u(defaults.param1)}.`,
    );
  } else if (defaults.param1 !== PARAM_REPS && defaults.param1 !== null) {
    notes.push(
      `${label}: values are in ${u(defaults.param1)} (the exercise's fixed primary unit).`,
    );
  }

  if (ex.weight !== undefined && ex.weight !== null) {
    const sentP2 = Math.trunc(Number(ex.param_2_type ?? PARAM_WEIGHT));
    const effP2 =
      defaults.param2 === PARAM_NONE || defaults.param2 === null ? PARAM_WEIGHT : defaults.param2;
    if (sentP2 !== effP2) {
      if (sentP2 === PARAM_PCT_MAX || sentP2 === PARAM_RPE) {
        warnings.push(
          `${label}: ${u(sentP2)} does not stick on this exercise — it renders as ${u(effP2)}. Put it in the exercise 'instr' text and leave load blank.`,
        );
      } else {
        warnings.push(
          `${label}: load renders as ${u(effP2)}, not ${u(sentP2)} (this exercise's secondary unit is fixed).`,
        );
      }
    }
  }
  return { notes, warnings };
}

/**
 * Run unit advisories across a whole block list against an exercise index. Shared by the
 * MCP workout_build tool and the CLI so both surface the same notes/warnings. Ensures the
 * index is loaded first, otherwise the defaults map is empty on a cold index and every
 * advisory is silently dropped.
 */
export async function collectAdvisories(
  blocks: readonly BlockSpec[],
  index: AdvisoryIndex,
): Promise<Advisory> {
  await index.ensureFresh();
  const pairs = blocks.flatMap((b) => b.exercises.map((ex) => ({ block: b, ex })));
  const ids = [...new Set(pairs.map((p) => Number(p.ex.id)).filter((id) => Number.isFinite(id)))];
  const defaultsById = await index.defaultsMany(ids);
  const notes: string[] = [];
  const warnings: string[] = [];
  pairs.forEach((p) => {
    const def = defaultsById.get(Number(p.ex.id));
    if (!def) return;
    const advisory = unitAdvisory(p.block.title, p.ex, def);
    notes.push(...advisory.notes);
    warnings.push(...advisory.warnings);
  });
  return { notes, warnings };
}
