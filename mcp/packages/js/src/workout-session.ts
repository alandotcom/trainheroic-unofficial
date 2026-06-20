// Imperative workout flow: create -> add blocks -> add exercises -> (set note) -> publish,
// plus read-back and removal.

import type {
  BlockSpec,
  ReadBlock,
  ReadExercise,
  ReadResult,
  WorkoutDate,
} from "@trainheroic-unofficial/dto";
import type { TrainHeroicClient } from "./client";
import { coerceInt, unitLabel } from "./exercise-util";
import { buildBlockPayload, LEADERBOARD_LABEL, makeExercise } from "./workout-encode";

export type BuildOptions = {
  programId: number;
  blocks: BlockSpec[];
  date?: WorkoutDate;
  timelineDay?: number;
  publish?: boolean;
  /** Optional session-level note ("Coach Instructions"), set after the blocks save. */
  instruction?: string;
};

async function req<T = unknown>(
  client: TrainHeroicClient,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await client.request<T>(method, path, body === undefined ? undefined : { body });
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`${method} ${path} failed (HTTP ${res.status}): ${detail}`);
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
  const sess = await req<Record<string, unknown>>(client, "POST", createPath(opts), {});
  const workoutId = Number(sess.workout_id);
  const pwId = Number(sess.id);

  const created = await req<Array<{ order: number; id: number }>>(
    client,
    "POST",
    "/2.0/coach/calendar/saveProgramWorkoutSets",
    buildBlockPayload(opts.blocks, workoutId),
  );
  const byOrder = new Map(created.map((b) => [b.order, b.id]));

  // Build all exercise payloads first (global key counter), then submit per block.
  let counter = 0;
  const payloads = opts.blocks.map((block, i) => {
    const wsid = byOrder.get(i + 1);
    if (wsid === undefined) throw new Error(`No saved block for order ${i + 1}.`);
    return block.exercises.map((ex, j) => {
      counter += 1;
      return makeExercise(ex, wsid, j + 1, `k::${workoutId}${String(counter).padStart(3, "0")}`);
    });
  });
  await Promise.all(
    payloads.map((p) => req(client, "POST", "/2.0/coach/calendar/saveWorkoutSetExercises", p)),
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
  const pw = (data.programWorkouts ?? []).find((p) => p.id === pwId);
  if (!pw) throw new Error(`programWorkout ${pwId} not found on ${y}-${m}-${d}.`);

  const setsObj = (pw.sets ?? {}) as Record<string, Record<string, unknown>>;
  const blocks: ReadBlock[] = Object.values(setsObj)
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((b) => readBlock(b));

  return {
    pwId,
    date: `${str(pw.year)}-${str(pw.month)}-${str(pw.day)}`,
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
  const exercises = rawExercises
    .sort((a, e) => Number(a.order) - Number(e.order))
    .map((ex) => readExercise(ex));
  return { order: Number(b.order), title: str(b.title), leaderboard, exercises };
}

function readExercise(ex: Record<string, unknown>): ReadExercise {
  const reps: string[] = [];
  const load: string[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const r = str(ex[`param_1_data_${i}`]);
    if (r !== "") reps.push(r);
    const w = str(ex[`param_2_data_${i}`]);
    if (w !== "") load.push(w);
  }
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
