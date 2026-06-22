// A fake TrainHeroic HTTP backend, as a Hono app. It runs in the harness process and answers the
// exact routes the SDK calls, from an in-memory Dataset; the spawned MCP server / CLI reaches it
// over real TCP via the client's base-URL overrides (a vi.stubGlobal can't cross a process
// boundary). Coach and apis hosts collapse onto one server. Middleware records every request, and
// the notFound handler returns 501 + records the path, so a missing/misrouted call fails loudly
// instead of silently degrading. Response shapes come from src/shapes.ts (datasets supply the data).

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Dataset } from "./datasets";
import { authResponse, headCoach, notificationCounts } from "./shapes";

export type BackendHandle = {
  url: string;
  port: number;
  /** Every "METHOD path" the backend received, in order. */
  requests: string[];
  /** Routes that hit the 501 catch-all — a non-empty list means a real routing gap. */
  unmatched: string[];
  close: () => Promise<void>;
};

function intParam(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildApp(dataset: Dataset, requests: string[], unmatched: string[]): Hono {
  const app = new Hono();

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

  // --- athlete-surface reads (the logged-in athlete's own training) ---
  app.get("/v5/users/exercises/history", (c) => c.json(dataset.athlete.exercisesList));
  app.get("/3.0/athlete/programworkout/range", (c) =>
    c.json(dataset.athlete.range(c.req.query("startDate") ?? "", c.req.query("endDate") ?? "")),
  );
  app.get("/2.0/athlete/workingMax", (c) => c.json(dataset.athlete.workingMaxes));
  app.get("/1.0/athlete/prefs", (c) => c.json(dataset.athlete.prefs));
  app.get("/v5/exercises/:id/personalRecords", (c) =>
    c.json(dataset.athlete.getPersonalRecords(Number(c.req.param("id")))),
  );
  app.get("/v5/exercises/:id/stats", (c) =>
    c.json(dataset.athlete.getExerciseStats(Number(c.req.param("id")))),
  );
  app.get("/3.0/athlete/leaderboard/:id", (c) => c.json({ entries: [] }));
  app.get("/v5/users/:id", (c) => c.json({ id: Number(c.req.param("id")) }));

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

/** Boot the fake backend on an ephemeral port and return a handle the harness drives runs against. */
export function startBackend(dataset: Dataset): Promise<BackendHandle> {
  const requests: string[] = [];
  const unmatched: string[] = [];
  const app = buildApp(dataset, requests, unmatched);
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        port: info.port,
        requests,
        unmatched,
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
