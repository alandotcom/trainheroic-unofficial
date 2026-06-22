// A fake TrainHeroic HTTP backend. It runs in the harness process and answers the exact routes the
// SDK calls, from an in-memory Dataset. The spawned MCP server reaches it over real TCP via the
// client's base-URL overrides (a vi.stubGlobal can't cross a process boundary). Coach and apis
// hosts collapse onto one server. Any unmatched route returns 501 and is recorded, so a missing or
// misrouted call fails loudly instead of silently degrading into empty data.

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Dataset } from "./datasets";

export type BackendHandle = {
  url: string;
  port: number;
  /** Every "METHOD path" the backend received, in order. */
  requests: string[];
  /** Routes that hit the 501 catch-all — a non-empty list means a real routing gap. */
  unmatched: string[];
  close: () => Promise<void>;
};

const SESSION_ID = "s".repeat(48);

type Resolved = { status: number; body: unknown };

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function route(
  dataset: Dataset,
  method: string,
  pathname: string,
  search: URLSearchParams,
  body: unknown,
): Resolved | null {
  if (method === "POST" && pathname === "/auth") {
    return {
      status: 200,
      body: { id: 700000, session_id: SESSION_ID, scope: "coach", role: "coach" },
    };
  }
  if (method === "GET") {
    const seg = pathname.split("/").filter((s) => s.length > 0);
    return routeGet(dataset, pathname, search, seg);
  }
  if (method === "POST") return routePost(dataset, pathname, body);
  return null;
}

function routeGet(
  dataset: Dataset,
  pathname: string,
  search: URLSearchParams,
  seg: string[],
): Resolved | null {
  if (pathname === "/user/simple") return { status: 200, body: dataset.userSimple };
  if (pathname === "/v5/headCoach") {
    return { status: 200, body: { id: 700000, org_id: 4242, license: "active", trial: false } };
  }
  if (pathname === "/1.0/coach/programs") return { status: 200, body: dataset.programs };
  if (pathname === "/v5/notifications/counts") {
    return { status: 200, body: { countMessagingNotViewed: 0, countNotificationsNotViewed: 0 } };
  }
  if (pathname === "/v5/analytics") return { status: 200, body: [] };
  if (pathname === "/v5/athletes") return { status: 200, body: dataset.athletes };

  if (pathname === "/1.0/coach/teams") {
    const q = search.get("q");
    const page = num(search.get("page"));
    const pageSize = num(search.get("pageSize"));
    let teams = dataset.teams;
    if (q && q.length > 0) {
      const needle = q.toLowerCase();
      teams = teams.filter((t) => JSON.stringify(t).toLowerCase().includes(needle));
    }
    if (page !== null && pageSize !== null && pageSize > 0) {
      const start = (page - 1) * pageSize;
      teams = teams.slice(start, start + pageSize);
    }
    return { status: 200, body: teams };
  }

  // /v5/teams/:id and /v5/teams/:id/teamCodes
  if (seg[0] === "v5" && seg[1] === "teams" && seg[2] !== undefined) {
    const teamId = num(seg[2]);
    if (teamId === null) return { status: 400, body: { error: "bad team id" } };
    if (seg[3] === "teamCodes") return { status: 200, body: [] };
    if (seg[3] === undefined) return { status: 200, body: dataset.getTeam(teamId) ?? {} };
  }

  // /3.0/coach/program/:id
  if (seg[0] === "3.0" && seg[1] === "coach" && seg[2] === "program" && seg[3] !== undefined) {
    const programId = num(seg[3]);
    if (programId === null) return { status: 400, body: { error: "bad program id" } };
    const program = dataset.getProgram(programId);
    return program === null
      ? { status: 404, body: { error: `no program ${programId}` } }
      : { status: 200, body: program };
  }

  // /v5/exercises/:id/history (coach athlete_lift_history)
  if (seg[0] === "v5" && seg[1] === "exercises" && seg[3] === "history") {
    return { status: 200, body: { liftPRs: [], history: [] } };
  }

  // /2.0/coach/athlete/calendar/summary/:athleteId/:year/:month/:n
  if (
    seg[0] === "2.0" &&
    seg[1] === "coach" &&
    seg[2] === "athlete" &&
    seg[3] === "calendar" &&
    seg[4] === "summary"
  ) {
    const athleteId = num(seg[5] ?? null);
    const year = num(seg[6] ?? null);
    const month = num(seg[7] ?? null);
    if (athleteId === null || year === null || month === null) {
      return { status: 400, body: { error: "bad calendar args" } };
    }
    return { status: 200, body: dataset.getCalendarSummary(athleteId, year, month) };
  }

  // /v5/athleteProfile/summary?user_id=
  if (pathname === "/v5/athleteProfile/summary") {
    const userId = num(search.get("user_id"));
    if (userId === null) return { status: 400, body: { error: "missing user_id" } };
    const summary = dataset.getProfileSummary(userId);
    return summary === null
      ? { status: 404, body: { error: `no athlete ${userId}` } }
      : { status: 200, body: summary };
  }

  // /v5/users/:id
  if (seg[0] === "v5" && seg[1] === "users" && seg[2] !== undefined) {
    const userId = num(seg[2]);
    return { status: 200, body: { id: userId } };
  }

  // /3.0/coach/athlete/programworkout/range/:athleteId
  if (
    seg[0] === "3.0" &&
    seg[1] === "coach" &&
    seg[2] === "athlete" &&
    seg[3] === "programworkout" &&
    seg[4] === "range" &&
    seg[5] !== undefined
  ) {
    const athleteId = num(seg[5]);
    if (athleteId === null) return { status: 400, body: { error: "bad athlete id" } };
    return {
      status: 200,
      body: dataset.getCoachAthleteRange(
        athleteId,
        search.get("startDate") ?? "",
        search.get("endDate") ?? "",
      ),
    };
  }
  return null;
}

function routePost(dataset: Dataset, pathname: string, body: unknown): Resolved | null {
  if (pathname === "/v5/analytics/training-summary/users") {
    const rec = (body ?? {}) as Record<string, unknown>;
    const userIds = Array.isArray(rec.user_ids) ? rec.user_ids.map((u) => Number(u)) : [];
    const dateStart = typeof rec.dateStart === "string" ? rec.dateStart : "";
    const dateEnd = typeof rec.dateEnd === "string" ? rec.dateEnd : "";
    return { status: 200, body: dataset.getTrainingSummary(userIds, dateStart, dateEnd) };
  }
  // Other analytics metrics (readiness, compliance, ...) return an empty report rather than 501,
  // so an exploratory analytics_query doesn't error out the run.
  if (pathname.startsWith("/v5/analytics/")) return { status: 200, body: { rows: [] } };
  return null;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? null);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

function createServerFor(dataset: Dataset, requests: string[], unmatched: string[]): Server {
  return createServer((req, res) => {
    void (async () => {
      const method = (req.method ?? "GET").toUpperCase();
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      requests.push(`${method} ${url.pathname}`);
      const body = method === "POST" || method === "PUT" ? await readBody(req) : undefined;
      const resolved = route(dataset, method, url.pathname, url.searchParams, body);
      if (resolved === null) {
        unmatched.push(`${method} ${url.pathname}`);
        process.stderr.write(`[fake-backend] unmatched ${method} ${url.pathname}\n`);
        return send(res, 501, { error: `unmatched route: ${method} ${url.pathname}` });
      }
      send(res, resolved.status, resolved.body);
    })();
  });
}

/** Boot the fake backend on an ephemeral port and return a handle the harness drives runs against. */
export function startBackend(dataset: Dataset): Promise<BackendHandle> {
  const requests: string[] = [];
  const unmatched: string[] = [];
  const server = createServerFor(dataset, requests, unmatched);
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      // Bound successfully — drop the error listener so it can't settle the promise again.
      server.removeListener("error", onError);
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("fake backend failed to bind a port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
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
  });
}
