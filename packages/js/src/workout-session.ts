// Imperative workout flow: create -> add blocks -> add exercises -> (set note) -> publish,
// plus read-back and removal.

import {
  type BlockSpec,
  blockSpecSchema,
  programsEditResponseSchema,
  type ReadBlock,
  type ReadExercise,
  type ReadResult,
  sessionCreateResponseSchema,
  type WorkoutDate,
} from "@trainheroic-unofficial/dto";
import { z } from "zod";
import type { TrainHeroicClient } from "./client";
import { coerceInt, MAX_PARAM_SLOTS, mapPool, unitLabel } from "./exercise-util";
import { checkResponse } from "./response-check";
import {
  buildBlockPayload,
  LEADERBOARD_LABEL,
  makeExercise,
  setSplitSummary,
  splitOversizedBlocks,
} from "./workout-encode";

export type BuildOptions = {
  programId: number;
  blocks: BlockSpec[];
  date?: WorkoutDate;
  timelineDay?: number;
  publish?: boolean;
  /** Explicitly allow prescriptions above ten sets to become consecutive blocks. */
  confirmSetSplit?: boolean;
  /** Optional session-level note ("Coach Instructions"), set after the blocks save. */
  instruction?: string;
};

const EXERCISE_SAVE_CONCURRENCY = 4;

/**
 * Coach calendar writes (`createWorkoutForDay`, timeline create, `copyProgramWorkout`) 500/401
 * on personal calendars (Coach Plan / `personal_cal`). Shared by `buildSession` and
 * `copySession` so the hint stays in one place.
 */
export function calendarWriteError(
  method: string,
  path: string,
  status: number,
  detail: string,
): Error {
  const base = `${method} ${path} failed (HTTP ${status}): ${detail}`;
  const isCalendarWrite =
    path.includes("/createWorkoutForDay/") ||
    path.includes("/createWorkoutForTimelineDay/") ||
    path.includes("/copyProgramWorkout");
  if (!isCalendarWrite || (status !== 500 && status !== 401)) {
    return new Error(base);
  }
  return new Error(
    `${base}. This often means the programId is not a coach-writable calendar — use a ` +
      "team/group programId (list_teams → group_program) or resolve a roster athlete's " +
      "calendar via GET /v5/calendars/athletes/{athleteId}?year=&month= (workout_build " +
      "athleteId). Athlete-created personal_cal ad-hoc sessions are a different surface.",
  );
}

async function req<T = unknown>(
  client: TrainHeroicClient,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await client.request<T>(method, path, body === undefined ? undefined : { body });
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw calendarWriteError(method, path, res.status, detail);
  }
  return res.data;
}

function createPath(opts: BuildOptions): string {
  if (opts.timelineDay !== undefined) {
    return `/2.0/coach/calendar/workout/createWorkoutForTimelineDay/${opts.programId}/${opts.timelineDay}/null`;
  }
  if (!opts.date) throw new Error("workout build requires either date or timelineDay");
  const [y, m, d] = opts.date;
  return `/2.0/coach/calendar/workout/createWorkoutForDay/${opts.programId}/${y}/${m}/${d}/0`;
}

export async function buildSession(
  client: TrainHeroicClient,
  opts: BuildOptions,
): Promise<{ pwId: number; workoutId: number }> {
  // dto schema is the single empty-block / Circuit invariant (SDK callers may bypass MCP zod).
  const validatedBlocks = z.array(blockSpecSchema).parse(opts.blocks);
  const splitSummary = setSplitSummary(validatedBlocks);
  if (splitSummary !== null && opts.confirmSetSplit !== true) {
    throw new Error(`${splitSummary} Set confirmSetSplit:true to allow this change.`);
  }
  const blocks = splitSummary === null ? validatedBlocks : splitOversizedBlocks(validatedBlocks);
  const sess = await req<Record<string, unknown>>(client, "POST", createPath(opts), {});
  checkResponse(sessionCreateResponseSchema, sess, "session create");
  const workoutId = Number(sess.workout_id);
  const pwId = Number(sess.id);

  const created = await req<Array<{ order: number; id: number }>>(
    client,
    "POST",
    "/2.0/coach/calendar/saveProgramWorkoutSets",
    buildBlockPayload(blocks, workoutId),
  );
  const byOrder = new Map(created.map((b) => [b.order, b.id]));

  // Build exercise payloads first (global key counter), then submit per non-empty block.
  // Skip empty payloads: posting [] to saveWorkoutSetExercises makes the API insert a blank
  // placeholder exercise and can drop the block instruction (breaks text-only Circuit blocks).
  let counter = 0;
  const payloads = blocks.map((block, i) => {
    const wsid = byOrder.get(i + 1);
    if (wsid === undefined) throw new Error(`No saved block for order ${i + 1}.`);
    return block.exercises.map((ex, j) => {
      counter += 1;
      return makeExercise(ex, wsid, j + 1, `k::${workoutId}${String(counter).padStart(3, "0")}`);
    });
  });
  await mapPool(
    payloads.filter((p) => p.length > 0),
    EXERCISE_SAVE_CONCURRENCY,
    (payload) => req(client, "POST", "/2.0/coach/calendar/saveWorkoutSetExercises", payload),
  );

  // Session note (Coach Instructions). Set before publish so it leaves the draft/published
  // state untouched — the PUT echoes `published` back as sent.
  if (opts.instruction !== undefined && opts.instruction !== "") {
    const blockIds = [...byOrder.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id);
    await setSessionInstruction(client, workoutId, sess, opts.instruction, blockIds);
  }

  if (opts.publish ?? false) {
    await req(client, "POST", "/2.0/coach/calendar/programWorkout/publish", [pwId]);
  }
  return { pwId, workoutId };
}

/**
 * Set a session's Coach Instructions (the day-note at the top of a session). `pw` is the
 * programWorkout object (the create-time response or a day's edit-GET entry). The PUT wants
 * the whole object back with `instruction` set and `sets`/`setKeys` as a flat list of block
 * ids. This does NOT change publish state: `published` is sent exactly as it is on `pw`.
 */
export async function setSessionInstruction(
  client: TrainHeroicClient,
  workoutId: number,
  pw: Record<string, unknown>,
  instruction: string,
  blockIds: number[],
): Promise<void> {
  const body = { ...pw, instruction, sets: blockIds, setKeys: blockIds };
  await req(client, "PUT", `/3.0/coach/workout/${workoutId}`, body);
}

export async function removeSession(
  client: TrainHeroicClient,
  programId: number,
  pwId: number,
): Promise<void> {
  await req(client, "POST", "/2.0/coach/calendar/removeProgramWorkout", { programId, pwId });
}

export async function publishSession(client: TrainHeroicClient, pwId: number): Promise<void> {
  await req(client, "POST", "/2.0/coach/calendar/programWorkout/publish", [pwId]);
}

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export async function readSession(
  client: TrainHeroicClient,
  programId: number,
  date: WorkoutDate,
  pwId: number,
): Promise<ReadResult> {
  const [y, m, d] = date;
  const data = await req<{ programWorkouts?: Array<Record<string, unknown>> }>(
    client,
    "GET",
    `/1.0/coach/programs/edit/${programId}/${y}/${m}/${d}`,
  );
  checkResponse(programsEditResponseSchema, data, "programs edit");
  // Coerce: the API may return id as a number or a numeric string (the drift the dto
  // shapes exist to absorb), so a strict === would miss the match on stringified ids.
  const pw = (data.programWorkouts ?? []).find((p) => coerceInt(p.id) === pwId);
  if (!pw) throw new Error(`programWorkout ${pwId} not found on ${y}-${m}-${d}.`);

  const setsObj = (pw.sets ?? {}) as Record<string, Record<string, unknown>>;
  const blocks: ReadBlock[] = Object.values(setsObj)
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((b) => readBlock(b));

  return {
    pwId,
    // Zero-padded so the value round-trips into the YYYY-MM-DD `dateString` args the athlete
    // tools require.
    date: `${str(pw.year)}-${str(pw.month).padStart(2, "0")}-${str(pw.day).padStart(2, "0")}`,
    published: pw.published,
    instruction: str(pw.instruction),
    blocks,
  };
}

function readBlock(b: Record<string, unknown>): ReadBlock {
  const rz = coerceInt(b.redzone_type);
  let leaderboard: string | null = null;
  if (rz && rz > 0) {
    const tag = LEADERBOARD_LABEL[rz] ?? `type ${rz}`;
    leaderboard = `FOR ${tag.toUpperCase()}${b.smaller_is_better ? " (lowest wins)" : ""}`;
  }
  const rawExercises = Array.isArray(b.exercises)
    ? (b.exercises as Array<Record<string, unknown>>)
    : [];
  // Coach edit-GET often returns a null-id placeholder row on text-only Circuit / Conditioning
  // blocks (type 1). Those are UI templates, not saved exercises — drop them on read-back.
  const exercises = rawExercises
    .filter((ex) => coerceInt(ex.id) !== null || str(ex.title) !== "")
    .sort((a, e) => Number(a.order) - Number(e.order))
    .map((ex) => readExercise(ex));
  return {
    order: Number(b.order),
    title: str(b.title),
    instruction: str(b.instruction),
    leaderboard,
    exercises,
  };
}

function readExercise(ex: Record<string, unknown>): ReadExercise {
  // `reps[k]` and `load[k]` must describe the same set, so both arrays run over the same slot
  // range (1 .. the last slot carrying either value) with "" for a gap. Compacting each side on
  // its own would shift a load onto the wrong set whenever one slot is reps-only or load-only.
  // A side with no values at all stays an empty array.
  let last = 0;
  for (let i = 1; i <= MAX_PARAM_SLOTS; i += 1) {
    if (str(ex[`param_1_data_${i}`]) !== "" || str(ex[`param_2_data_${i}`]) !== "") last = i;
  }
  const slots = Array.from({ length: last }, (_, k) => k + 1);
  const repsRaw = slots.map((i) => str(ex[`param_1_data_${i}`]));
  const loadRaw = slots.map((i) => str(ex[`param_2_data_${i}`]));
  const reps = repsRaw.some((r) => r !== "") ? repsRaw : [];
  const load = loadRaw.some((w) => w !== "") ? loadRaw : [];
  return {
    order: Number(ex.order),
    title: str(ex.title),
    reps,
    primaryUnit: unitLabel(coerceInt(ex.param_1_type)),
    load,
    loadUnit: unitLabel(coerceInt(ex.param_2_type)),
    instruction: str(ex.instruction),
  };
}
