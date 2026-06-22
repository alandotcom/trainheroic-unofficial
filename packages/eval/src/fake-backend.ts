// A fake TrainHeroic HTTP backend, as a Hono app. It runs in the harness process and answers the
// exact routes the SDK calls, from an in-memory Dataset; the spawned MCP server / CLI reaches it
// over real TCP via the client's base-URL overrides (a vi.stubGlobal can't cross a process
// boundary). Coach and apis hosts collapse onto one server. Middleware records every request, and
// the notFound handler returns 501 + records the path, so a missing/misrouted call fails loudly
// instead of silently degrading. Response shapes come from src/shapes.ts (datasets supply the data).

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Dataset } from "./datasets";
import type { WriteRecord } from "./types";
import { authResponse, headCoach, notificationCounts } from "./shapes";

export type BackendHandle = {
  url: string;
  port: number;
  /** Every "METHOD path" the backend received, in order. */
  requests: string[];
  /** Routes that hit the 501 catch-all — a non-empty list means a real routing gap. */
  unmatched: string[];
  /** Every mutating request, in order — what a write-mode grader asserts against. */
  writes: WriteRecord[];
  close: () => Promise<void>;
};

function intParam(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** One in-flight ad-hoc personal session (athlete_log_session): created, then exercises added, then
 * read back by the range so the log write can find it. The single bit of read-after-write state the
 * backend keeps — enough for the create→add→log flow without a full stateful store. */
type PersonalSession = { date: string; exercises: Array<{ exerciseId: number }> };

function personalRangeWorkout(p: PersonalSession): Record<string, unknown> {
  const SET_ID = 5560000;
  return {
    id: 5550000,
    date: p.date,
    workout_title: "Personal Session",
    personal_cal: true,
    program_title: null,
    summarizedSavedWorkout: {
      saved_workout: {
        id: 5550003,
        workoutSets: [
          {
            id: SET_ID,
            saved_workout_id: 5550003,
            workout_set_id: 5590000,
            order: 0,
            unit: "lb",
            workoutSetExercises: p.exercises.map((e, i) => ({
              id: 5570000 + i,
              workout_set_exercise_id: 5580000 + i,
              exercise_id: e.exerciseId,
            })),
          },
        ],
      },
    },
  };
}

function buildApp(
  dataset: Dataset,
  requests: string[],
  unmatched: string[],
  writes: WriteRecord[],
): Hono {
  const app = new Hono();
  // Holds the one ad-hoc personal session between its create/add writes and the range read.
  const personal: { current: PersonalSession | null } = { current: null };

  app.use("*", async (c, next) => {
    requests.push(`${c.req.method} ${new URL(c.req.url).pathname}`);
    await next();
  });

  // --- auth + coach roster reads ---
  app.post("/auth", (c) => c.json(authResponse()));
  app.get("/user/simple", (c) => c.json(dataset.userSimple));
  app.get("/v5/headCoach", (c) => c.json(headCoach()));
  app.get("/1.0/coach/programs", (c) => c.json(dataset.programs));
  app.get("/v5/notifications/counts", (c) => c.json(notificationCounts()));
  app.get("/v5/analytics", (c) => c.json([]));
  app.get("/v5/exerciseLibrary/all", (c) => c.json(dataset.exerciseLibrary));
  app.get("/v5/athletes", (c) => c.json(dataset.athletes));

  app.get("/1.0/coach/teams", (c) => {
    const q = c.req.query("q");
    const page = intParam(c.req.query("page"));
    const pageSize = intParam(c.req.query("pageSize"));
    let teams = dataset.teams;
    if (q && q.length > 0) {
      const needle = q.toLowerCase();
      teams = teams.filter((t) => JSON.stringify(t).toLowerCase().includes(needle));
    }
    if (page !== null && pageSize !== null && pageSize > 0) {
      teams = teams.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    }
    return c.json(teams);
  });

  // --- coach entity reads ---
  app.get("/v5/teams/:id", (c) => c.json(dataset.getTeam(Number(c.req.param("id"))) ?? {}));
  app.get("/v5/teams/:id/teamCodes", (c) => c.json([]));
  app.get("/3.0/coach/program/:id", (c) => {
    const program = dataset.getProgram(Number(c.req.param("id")));
    return program === null ? c.json({ error: "no program" }, 404) : c.json(program);
  });
  app.get("/v5/exercises/:id/history", (c) => {
    const exerciseId = Number(c.req.param("id"));
    const athleteId = intParam(c.req.query("userId")) ?? 0;
    return c.json(dataset.getExerciseHistory(exerciseId, athleteId));
  });
  app.get("/2.0/coach/athlete/calendar/summary/:athleteId/:year/:month/:n", (c) => {
    const athleteId = Number(c.req.param("athleteId"));
    const year = Number(c.req.param("year"));
    const month = Number(c.req.param("month"));
    return c.json(dataset.getCalendarSummary(athleteId, year, month));
  });
  app.get("/v5/athleteProfile/summary", (c) => {
    const userId = intParam(c.req.query("user_id"));
    if (userId === null) return c.json({ error: "missing user_id" }, 400);
    const summary = dataset.getProfileSummary(userId);
    return summary === null ? c.json({ error: `no athlete ${userId}` }, 404) : c.json(summary);
  });
  app.get("/3.0/coach/athlete/programworkout/range/:athleteId", (c) => {
    const athleteId = Number(c.req.param("athleteId"));
    return c.json(
      dataset.getCoachAthleteRange(
        athleteId,
        c.req.query("startDate") ?? "",
        c.req.query("endDate") ?? "",
      ),
    );
  });

  registerAthleteReads(app, dataset, personal);

  // --- messaging ---
  app.get("/v5/messaging/streams", (c) => c.json(dataset.messagingStreams));
  app.get("/v5/messaging/streams/:id/comments", (c) =>
    c.json(dataset.getMessages(Number(c.req.param("id")))),
  );

  app.get("/v5/users/:id", (c) => c.json(dataset.getUser(Number(c.req.param("id")))));

  registerWrites(app, writes, personal);

  // --- analytics (POST reports) ---
  app.post("/v5/analytics/training-summary/users", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const userIds = Array.isArray(body.user_ids) ? body.user_ids.map((u) => Number(u)) : [];
    const dateStart = typeof body.dateStart === "string" ? body.dateStart : "";
    const dateEnd = typeof body.dateEnd === "string" ? body.dateEnd : "";
    return c.json(dataset.getTrainingSummary(userIds, dateStart, dateEnd));
  });
  // Other analytics metrics return an empty report rather than 501.
  app.post("/v5/analytics/*", (c) => c.json({ rows: [] }));

  app.notFound((c) => {
    const path = new URL(c.req.url).pathname;
    unmatched.push(`${c.req.method} ${path}`);
    process.stderr.write(`[fake-backend] unmatched ${c.req.method} ${path}\n`);
    return c.json({ error: `unmatched route: ${c.req.method} ${path}` }, 501);
  });

  return app;
}

/** Read a write's JSON body and record (method, path, body). Returns the parsed body for the route. */
async function record(c: Context, writes: WriteRecord[]): Promise<unknown> {
  const body = await c.req.json().catch(() => null);
  writes.push({ method: c.req.method, path: new URL(c.req.url).pathname, body });
  return body;
}

/**
 * Mutating routes. Each records the write (so a grader can assert what fired and with what values)
 * and returns a plausible success — enough for the SDK's two-step set-write, per-athlete swap, and
 * roster/session writes to complete. State is intentionally not mutated back into the reads: a
 * write-mode scenario asserts on the recorded writes, not read-after-write consistency.
 */
/** Athlete-surface reads (the logged-in athlete's own training), incl. the read-after-write of the
 * in-flight ad-hoc personal session. Split out to keep buildApp under the line cap. */
function registerAthleteReads(
  app: Hono,
  dataset: Dataset,
  personal: { current: PersonalSession | null },
): void {
  app.get("/v5/users/exercises/history", (c) => c.json(dataset.athlete.exercisesList));
  app.get("/3.0/athlete/programworkout/range", (c) => {
    const start = c.req.query("startDate") ?? "";
    const end = c.req.query("endDate") ?? "";
    const scheduled = dataset.athlete.range(start, end);
    const p = personal.current;
    const inWindow = p !== null && (!start || p.date >= start) && (!end || p.date <= end);
    return c.json(inWindow && p !== null ? [...scheduled, personalRangeWorkout(p)] : scheduled);
  });
  app.get("/2.0/athlete/workingMax", (c) => c.json(dataset.athlete.workingMaxes));
  app.get("/1.0/athlete/prefs", (c) => c.json(dataset.athlete.prefs));
  app.get("/v5/exercises/:id/personalRecords", (c) =>
    c.json(dataset.athlete.getPersonalRecords(Number(c.req.param("id")))),
  );
  app.get("/v5/exercises/:id/stats", (c) =>
    c.json(dataset.athlete.getExerciseStats(Number(c.req.param("id")))),
  );
  app.get("/3.0/athlete/leaderboard/:id", (c) => c.json({ entries: [] }));
}

function registerWrites(
  app: Hono,
  writes: WriteRecord[],
  personal: { current: PersonalSession | null },
): void {
  // Set-write step 1 (the data write) + step 2 (mark complete), coach (…/{athleteId}) and athlete.
  app.put("/1.0/coach/savedworkoutsetexercise/:id/:athleteId", async (c) => {
    await record(c, writes);
    return c.json({ id: Number(c.req.param("id")), success: true });
  });
  app.put("/1.0/coach/savedworkoutset/:id/:athleteId", async (c) => {
    await record(c, writes);
    return c.json({ id: Number(c.req.param("id")), completed: "1" });
  });
  app.put("/1.0/athlete/savedworkoutsetexercise/:id", async (c) => {
    await record(c, writes);
    return c.json({ id: Number(c.req.param("id")), success: true });
  });
  app.put("/1.0/athlete/savedworkoutset/:id", async (c) => {
    await record(c, writes);
    return c.json({ id: Number(c.req.param("id")), completed: "1" });
  });

  // Per-athlete exercise swap — echoes the swapped row the SDK reads back.
  app.put("/v5/savedWorkoutSetExercises/:id", async (c) => {
    await record(c, writes);
    const exerciseId = Number(c.req.query("exerciseId"));
    return c.json({
      id: Number(c.req.param("id")),
      user_id: 100001,
      exercise_id: exerciseId,
      exercise: { id: exerciseId, title: "Swapped Exercise" },
      workout_set_exercise: { exercise_id: 900000 },
    });
  });

  // Roster writes.
  app.post("/v5/emails/validate", async (c) => {
    const body = (await record(c, writes)) as { emails?: string[] } | null;
    return c.json({ valid: body?.emails ?? [], invalid: [] });
  });
  app.post("/v5/athletes/inviteToTeam", async (c) => {
    await record(c, writes);
    return c.json({ result: "invited" });
  });
  app.put("/v5/athletes/archive", async (c) => {
    await record(c, writes);
    return c.json({ success: true });
  });
  app.put("/v5/athletes/restore", async (c) => {
    await record(c, writes);
    return c.json({ success: true });
  });

  // Athlete personal-session writes (create → add exercises → the range then surfaces it to log).
  app.post("/v5/programWorkouts/personal", async (c) => {
    const body = (await record(c, writes)) as { date?: string } | null;
    personal.current = { date: body?.date ?? "2026-03-27", exercises: [] };
    return c.json({
      programWorkout: { id: 5550001, workoutId: 5550002, date: personal.current.date },
      savedWorkout: { id: 5550003, group_id: 5550004 },
    });
  });
  app.put("/v5/personalCalendar/workouts/:id/addExercises", async (c) => {
    const body = (await record(c, writes)) as { exercises?: Array<{ exerciseId?: number }> } | null;
    const exercises = (body?.exercises ?? [])
      .map((e) => (typeof e.exerciseId === "number" ? { exerciseId: e.exerciseId } : null))
      .filter((e): e is { exerciseId: number } => e !== null);
    if (personal.current) personal.current.exercises = exercises;
    // The add-exercises response (one saved set holding every added exercise) — its ids match the
    // session personalRangeWorkout() builds, so the subsequent log finds the same set.
    return c.json([
      {
        id: 5560000,
        savedWorkoutSetExercises: exercises.map((e, i) => ({
          id: 5570000 + i,
          exerciseId: e.exerciseId,
        })),
      },
    ]);
  });
}

/** Boot the fake backend on an ephemeral port and return a handle the harness drives runs against. */
export function startBackend(dataset: Dataset): Promise<BackendHandle> {
  const requests: string[] = [];
  const unmatched: string[] = [];
  const writes: WriteRecord[] = [];
  const app = buildApp(dataset, requests, unmatched, writes);
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        port: info.port,
        requests,
        unmatched,
        writes,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => {
              if (err) rej(err);
              else res();
            });
          }),
      });
    });
    server.on?.("error", reject);
  });
}
