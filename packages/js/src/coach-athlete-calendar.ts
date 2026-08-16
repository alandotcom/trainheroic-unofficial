// Coach view of roster-athlete calendars: month summaries, date-range workouts, and the
// coach-writable calendar program id used by createWorkoutForDay (My Athletes → calendar).
// Kept out of athlete.ts so that file stays the athlete-self surface under 1k lines.

import type { ProgramWorkout } from "@trainheroic-unofficial/dto";
import { parseWorkoutDate } from "@trainheroic-unofficial/dto";
import type { TrainHeroicClient } from "./client";
import { coerceInt, isRecord, str } from "./exercise-util";

async function getArray<T>(client: TrainHeroicClient, path: string, label: string): Promise<T[]> {
  const res = await client.request<unknown>("GET", path);
  if (!res.ok || !Array.isArray(res.data)) throw new Error(`${label} failed (HTTP ${res.status}).`);
  return res.data as T[];
}

/**
 * A coach's view of a roster athlete's scheduled + completed workouts in an inclusive
 * YYYY-MM-DD window (`/3.0/coach/athlete/programworkout/range/{athleteId}`). Returns the same
 * `ProgramWorkout[]` shape as `fetchAthleteWorkouts`, so the same presenters and
 * `findSavedWorkoutSet` apply — it just reads another athlete's data through the coach surface.
 */
export function fetchCoachAthleteWorkouts(
  client: TrainHeroicClient,
  athleteId: number,
  startDate: string,
  endDate: string,
): Promise<ProgramWorkout[]> {
  return getArray(
    client,
    `/3.0/coach/athlete/programworkout/range/${athleteId}?startDate=${startDate}&endDate=${endDate}`,
    "coach athlete workouts",
  );
}

/**
 * A coach's month view of a roster athlete's logged sessions
 * (`/2.0/coach/athlete/calendar/summary`). The trailing path segment is required by the API but
 * ignored (any value returns the whole month); it mirrors the coach web app, which sends 7. The
 * `userId` in each row is the roster athlete, not the calling coach.
 */
export function fetchCoachAthleteCalendarSummary(
  client: TrainHeroicClient,
  athleteId: number,
  year: number,
  month: number,
): Promise<unknown[]> {
  return getArray(
    client,
    `/2.0/coach/athlete/calendar/summary/${athleteId}/${year}/${month}/7`,
    "coach athlete calendar summary",
  );
}

/** A roster athlete's coach-writable calendar (from `GET /v5/calendars/athletes/{id}`). */
export type CoachAthleteCalendar = {
  programId: number;
  title: string;
  /** Program type: 5 = individual athlete calendar, 4 = coach own calendar (observed). */
  type: number | null;
  groupId: number | null;
};

/**
 * Resolve a roster athlete's coach-writable calendar program id
 * (`GET /v5/calendars/athletes/{athleteId}?year=&month=`).
 *
 * Year and month are required by the API (HTTP 400 without them); the returned `programId` is
 * stable for the athlete, so any month works. This is the calendar the coach web app writes
 * with `createWorkoutForDay` when you open an athlete from My Athletes → calendar — distinct
 * from athlete-created `personal_cal` ad-hoc sessions.
 */
export async function fetchCoachAthleteCalendar(
  client: TrainHeroicClient,
  athleteId: number,
  year: number,
  month: number,
): Promise<CoachAthleteCalendar> {
  const path = `/v5/calendars/athletes/${athleteId}?year=${year}&month=${month}`;
  const res = await client.request<unknown>("GET", path);
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`GET ${path} failed (HTTP ${res.status}): ${detail}`);
  }
  if (!isRecord(res.data)) throw new Error("Unexpected athlete calendar response.");
  const programId = coerceInt(res.data.id);
  if (programId === null || programId <= 0) {
    throw new Error(`Athlete calendar for ${athleteId} did not include a program id.`);
  }
  return {
    programId,
    title: str(res.data.title) ?? "",
    type: coerceInt(res.data.type),
    groupId: coerceInt(res.data.group_id),
  };
}

/**
 * Companion calendar for a roster athlete (`GET /v5/calendars/athletes/{id}/coachAthleteTeam`).
 * Distinct from `fetchCoachAthleteCalendar` (type-5 individual calendar).
 */
export async function fetchCoachAthleteTeamCalendar(
  client: TrainHeroicClient,
  athleteId: number,
): Promise<Record<string, unknown>> {
  if (athleteId <= 0) throw new Error("athleteId must be positive.");
  const path = `/v5/calendars/athletes/${athleteId}/coachAthleteTeam`;
  const res = await client.request("GET", path);
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`GET ${path} failed (HTTP ${res.status}): ${detail}`);
  }
  if (!isRecord(res.data)) throw new Error("Unexpected coach-athlete-team calendar response.");
  return res.data;
}

/**
 * Resolve the calendar program id for `workout_build` / `coach workout build`: either an
 * explicit team/group `programId`, or a roster `athleteId` (+ date) via
 * `fetchCoachAthleteCalendar`. Exactly one of programId / athleteId is required.
 */
export async function resolveBuildProgramId(
  client: TrainHeroicClient,
  args: { programId?: number; athleteId?: number; date?: string },
): Promise<number> {
  if (args.programId !== undefined && args.athleteId !== undefined) {
    throw new Error("Pass programId or athleteId, not both.");
  }
  if (args.programId !== undefined) return args.programId;
  if (args.athleteId === undefined) {
    throw new Error("Provide programId (team calendar) or athleteId (athlete calendar).");
  }
  if (args.date === undefined) {
    throw new Error("athleteId requires date (YYYY-M-D) to resolve the athlete calendar.");
  }
  const [y, m] = parseWorkoutDate(args.date);
  return (await fetchCoachAthleteCalendar(client, args.athleteId, y, m)).programId;
}
