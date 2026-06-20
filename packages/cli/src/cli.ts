#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parseArgs, type ParseArgsConfig } from "node:util";
import type { ZodType } from "zod";
import {
  exerciseCreateSchema,
  logSetArgsSchema,
  workoutSpecSchema,
} from "@trainheroic-unofficial/dto";
import {
  type ApiBase,
  buildSession,
  type BuildOptions,
  buildCommentPayload,
  collectAdvisories,
  deleteComment,
  ExerciseLibrary,
  fetchAthletePrefs,
  fetchAthleteProfileSummary,
  fetchAthleteUser,
  fetchAthleteWorkouts,
  fetchExerciseHistoryDetail,
  fetchExerciseHistoryList,
  fetchExerciseStats,
  fetchLeaderboard,
  fetchPersonalRecords,
  fetchStreams,
  fetchWorkingMaxes,
  logAthleteSet,
  mapPool,
  presentAthleteWorkouts,
  presentExerciseHistory,
  publishSession,
  readLive,
  readSession,
  removeSession,
  resolveAthleteUserId,
  searchExerciseHistory,
  sendComment,
  TrainHeroicClient,
} from "@trainheroic-unofficial/js";
import { JsonFileLibraryCache } from "@trainheroic-unofficial/js/node";
import { looksLikeJson, parseDate } from "./parse";
import { loadSession, saveSession } from "./session-cache";

const HELP = `trainheroic — command-line tool for the TrainHeroic coaching API

Credentials come from TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD. Output is JSON.

Setup:
  install-skill   copy the Claude Code skills to ~/.claude/skills/

Reads:
  whoami | head-coach | athletes | programs | teams | notifications | analytics
  program <id> | team <id> | team-codes <id>
  request <METHOD> <path> [json] [--base coach|apis] [--file f]   raw API call

Exercises (cached at ~/.trainheroic/library.json):
  exercise resolve <name>
  exercise search <query> [--limit N]
  exercise get <id>
  exercise sync [--force]
  exercise create <json>|--file f
  exercise forget <id> --yes
  exercise stats

Workouts:
  workout build --program <id> (--date Y-M-D | --timeline-day <n>) [--publish --yes] <spec.json>|--file f
  workout read --program <id> --date Y-M-D --pw <id>
  workout publish --pw <id> --yes
  workout remove --program <id> --pw <id> --yes

Messaging:
  message list
  message read <streamId> [--limit N]
  message draft <streamId> <text> [--reply-to <id>]
  message send <streamId> <text> [--reply-to <id>] --yes
  message delete <streamId> <commentId> --yes

Athlete (the logged-in user's own training; a coach account works too):
  athlete whoami | profile [--metric] | prefs | working-maxes
  athlete workouts --start Y-M-D --end Y-M-D [--raw]
  athlete exercises [--q <text>] [--limit N]
  athlete history <exerciseId> [--raw]
  athlete prs <exerciseId>
  athlete stats <exerciseId> --date Y-M-D
  athlete leaderboard <workoutId> [--page N] [--page-size N] [--gender N]
  athlete export [--out dir] [--start Y-M-D] [--end Y-M-D] [--full]
  athlete log-set --date Y-M-D --set <id> <resultsJson>|--file f --yes   (writes to your live log)
`;

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function need(value: string | undefined, usage: string): string {
  if (value === undefined || value === "") fail(`usage: trainheroic ${usage}`);
  return value;
}

function toInt(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number, got "${value}".`);
  return n;
}

/** Validate input against a dto schema, failing with a readable message on mismatch. */
function validate<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    fail(`invalid ${label} — ${issues}`);
  }
  return result.data;
}

function parse(args: string[], options: ParseArgsConfig["options"]): ReturnType<typeof parseArgs> {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length > 0 ? text : null;
}

/** JSON body from an inline arg, a --file path, or piped stdin. */
async function jsonInput(inline: string | undefined, file: string | undefined): Promise<unknown> {
  let text: string | null = null;
  if (file !== undefined) text = await readFile(file, "utf8");
  else if (inline !== undefined) {
    text = looksLikeJson(inline) ? inline : await readFile(inline, "utf8");
  } else text = await readStdin();
  if (text === null) fail("expected JSON via an argument, --file, or stdin.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail("input is not valid JSON.");
  }
}

async function get(client: TrainHeroicClient, path: string, base?: ApiBase): Promise<unknown> {
  const res = await client.request("GET", path, base ? { base } : {});
  if (!res.ok) fail(`GET ${path} failed (HTTP ${res.status}).`);
  return res.data;
}

function library(client: TrainHeroicClient): ExerciseLibrary {
  return new ExerciseLibrary(client, new JsonFileLibraryCache());
}

async function cmdRequest(client: TrainHeroicClient, rest: string[]): Promise<void> {
  const { values, positionals } = parse(rest, {
    base: { type: "string" },
    file: { type: "string" },
  });
  const method = need(positionals[0], "request <METHOD> <path> [json]").toUpperCase();
  const path = need(positionals[1], "request <METHOD> <path> [json]");
  const base = values.base as ApiBase | undefined;
  if (base !== undefined && base !== "coach" && base !== "apis")
    fail("--base must be coach or apis.");
  const opts: { base?: ApiBase; body?: unknown } = {};
  if (base !== undefined) opts.base = base;
  if (method !== "GET" && method !== "DELETE") {
    if (positionals[2] !== undefined || values.file !== undefined || !process.stdin.isTTY) {
      opts.body = await jsonInput(positionals[2], values.file as string | undefined);
    }
  }
  const res = await client.request(method, path, opts);
  out({ status: res.status, ok: res.ok, data: res.data });
}

async function cmdExercise(client: TrainHeroicClient, rest: string[]): Promise<void> {
  const [sub, ...a] = rest;
  const lib = library(client);
  switch (sub) {
    case "resolve":
      return out(
        await lib.resolve(need(a.join(" ").trim() || undefined, "exercise resolve <name>")),
      );
    case "search": {
      const { values, positionals } = parse(a, { limit: { type: "string" } });
      const query = need(positionals.join(" ").trim() || undefined, "exercise search <query>");
      const limit = values.limit !== undefined ? toInt(values.limit as string, "--limit") : 20;
      return out(await lib.search(query, limit));
    }
    case "get":
      return out(await lib.get(toInt(need(a[0], "exercise get <id>"), "id")));
    case "sync": {
      const { values } = parse(a, { force: { type: "boolean" } });
      if (values.force === true) return out(await lib.refresh());
      await lib.ensureFresh();
      return out(await lib.stats());
    }
    case "create": {
      const { values, positionals } = parse(a, { file: { type: "string" } });
      const body = await jsonInput(positionals[0], values.file as string | undefined);
      const exercise = validate(exerciseCreateSchema, body, "exercise");
      return out(await lib.create(exercise as Record<string, unknown>));
    }
    case "forget": {
      const { values, positionals } = parse(a, { yes: { type: "boolean" } });
      const id = toInt(need(positionals[0], "exercise forget <id> --yes"), "id");
      if (values.yes !== true) fail(`add --yes to forget exercise ${id} from the local cache.`);
      await lib.recordDelete(id);
      return out({ forgotten: id });
    }
    case "stats":
      return out(await lib.stats());
    default:
      return fail("usage: trainheroic exercise <resolve|search|get|sync|create|forget|stats>");
  }
}

async function cmdWorkout(client: TrainHeroicClient, rest: string[]): Promise<void> {
  const [sub, ...a] = rest;
  switch (sub) {
    case "build": {
      const { values, positionals } = parse(a, {
        program: { type: "string" },
        date: { type: "string" },
        "timeline-day": { type: "string" },
        publish: { type: "boolean" },
        yes: { type: "boolean" },
        file: { type: "string" },
      });
      const programId = toInt(
        need(values.program as string | undefined, "workout build --program <id> ..."),
        "--program",
      );
      if (values.date === undefined && values["timeline-day"] === undefined) {
        fail("provide --date YYYY-M-D or --timeline-day <n>.");
      }
      const parsed = await jsonInput(positionals[0], values.file as string | undefined);
      // Accept a bare blocks array or a {blocks, instruction} object; validate strictly.
      const spec = validate(
        workoutSpecSchema,
        Array.isArray(parsed) ? { blocks: parsed } : parsed,
        "workout spec",
      );
      const publish = values.publish === true;
      if (publish && values.yes !== true)
        fail("publishing is athlete-facing; add --yes to build and publish.");
      const opts: BuildOptions = { programId, blocks: spec.blocks, publish };
      if (values.date !== undefined) opts.date = parseDate(values.date as string);
      if (values["timeline-day"] !== undefined) {
        opts.timelineDay = toInt(values["timeline-day"] as string, "--timeline-day");
      }
      if (spec.instruction !== undefined) opts.instruction = spec.instruction;
      const advice = await collectAdvisories(spec.blocks, library(client));
      const built = await buildSession(client, opts);
      const readback = opts.date
        ? await readSession(client, programId, opts.date, built.pwId)
        : null;
      return out({ ...built, published: publish, advisories: advice, readback });
    }
    case "read": {
      const { values } = parse(a, {
        program: { type: "string" },
        date: { type: "string" },
        pw: { type: "string" },
      });
      const programId = toInt(
        need(
          values.program as string | undefined,
          "workout read --program <id> --date Y-M-D --pw <id>",
        ),
        "--program",
      );
      const date = parseDate(
        need(
          values.date as string | undefined,
          "workout read --program <id> --date Y-M-D --pw <id>",
        ),
      );
      const pw = toInt(
        need(values.pw as string | undefined, "workout read --program <id> --date Y-M-D --pw <id>"),
        "--pw",
      );
      return out(await readSession(client, programId, date, pw));
    }
    case "publish": {
      const { values } = parse(a, { pw: { type: "string" }, yes: { type: "boolean" } });
      const pw = toInt(
        need(values.pw as string | undefined, "workout publish --pw <id> --yes"),
        "--pw",
      );
      if (values.yes !== true) fail(`publishing makes pw ${pw} athlete-visible; add --yes.`);
      await publishSession(client, pw);
      return out({ published: pw });
    }
    case "remove": {
      const { values } = parse(a, {
        program: { type: "string" },
        pw: { type: "string" },
        yes: { type: "boolean" },
      });
      const programId = toInt(
        need(values.program as string | undefined, "workout remove --program <id> --pw <id> --yes"),
        "--program",
      );
      const pw = toInt(
        need(values.pw as string | undefined, "workout remove --program <id> --pw <id> --yes"),
        "--pw",
      );
      if (values.yes !== true) fail(`removing pw ${pw} deletes the session; add --yes.`);
      await removeSession(client, programId, pw);
      return out({ removed: pw });
    }
    default:
      return fail("usage: trainheroic workout <build|read|publish|remove>");
  }
}

async function cmdMessage(client: TrainHeroicClient, rest: string[]): Promise<void> {
  const [sub, ...a] = rest;
  switch (sub) {
    case "list": {
      const streams = await fetchStreams(client);
      return out(
        streams.map(({ stream, kind }) => ({
          id: stream.id,
          kind,
          title: stream.title ?? "",
          teamId: stream.teamId,
          userId: stream.userId,
        })),
      );
    }
    case "read": {
      const { values, positionals } = parse(a, { limit: { type: "string" } });
      const streamId = toInt(
        need(positionals[0], "message read <streamId> [--limit N]"),
        "streamId",
      );
      const limit = values.limit !== undefined ? toInt(values.limit as string, "--limit") : 20;
      return out(await readLive(client, streamId, limit));
    }
    case "draft": {
      const { values, positionals } = parse(a, { "reply-to": { type: "string" } });
      const streamId = toInt(need(positionals[0], "message draft <streamId> <text>"), "streamId");
      const text = need(
        positionals.slice(1).join(" ").trim() || undefined,
        "message draft <streamId> <text>",
      );
      const replyTo =
        values["reply-to"] !== undefined ? toInt(values["reply-to"] as string, "--reply-to") : null;
      return out({
        draft: true,
        note: "NOT sent. Run 'message send' with --yes to deliver.",
        payload: buildCommentPayload(streamId, text, replyTo),
      });
    }
    case "send": {
      const { values, positionals } = parse(a, {
        "reply-to": { type: "string" },
        yes: { type: "boolean" },
      });
      const streamId = toInt(
        need(positionals[0], "message send <streamId> <text> --yes"),
        "streamId",
      );
      const text = need(
        positionals.slice(1).join(" ").trim() || undefined,
        "message send <streamId> <text> --yes",
      );
      const replyTo =
        values["reply-to"] !== undefined ? toInt(values["reply-to"] as string, "--reply-to") : null;
      if (values.yes !== true)
        fail(`sending to stream ${streamId} is athlete-facing and immediate; add --yes.`);
      return out({ sent: true, comment: await sendComment(client, streamId, text, replyTo) });
    }
    case "delete": {
      const { values, positionals } = parse(a, { yes: { type: "boolean" } });
      const streamId = toInt(
        need(positionals[0], "message delete <streamId> <commentId> --yes"),
        "streamId",
      );
      const commentId = toInt(
        need(positionals[1], "message delete <streamId> <commentId> --yes"),
        "commentId",
      );
      if (values.yes !== true)
        fail(`deleting comment ${commentId} acts on the live account; add --yes.`);
      return out({ deleted: true, response: await deleteComment(client, streamId, commentId) });
    }
    default:
      return fail("usage: trainheroic message <list|read|draft|send|delete>");
  }
}

function isoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail(`${label} must be YYYY-MM-DD, got "${value}".`);
  return value;
}

function logErr(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

async function cmdAthleteExport(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values } = parse(a, {
    out: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    full: { type: "boolean" },
  });
  const dir =
    (values.out as string | undefined) ?? join(homedir(), ".trainheroic", "athlete-export");
  const today = new Date();
  const past = new Date();
  past.setFullYear(past.getFullYear() - 2);
  const start =
    values.start !== undefined
      ? isoDate(values.start as string, "--start")
      : past.toISOString().slice(0, 10);
  const end =
    values.end !== undefined
      ? isoDate(values.end as string, "--end")
      : today.toISOString().slice(0, 10);

  await mkdir(dir, { recursive: true });
  const userId = await resolveAthleteUserId(client);

  logErr(`exporting to ${dir} (user ${userId})`);
  const [summary, user, prefs, workouts, exercises, workingMaxes] = await Promise.all([
    fetchAthleteProfileSummary(client, userId),
    fetchAthleteUser(client, userId),
    fetchAthletePrefs(client),
    fetchAthleteWorkouts(client, start, end),
    fetchExerciseHistoryList(client),
    fetchWorkingMaxes(client),
  ]);
  await writeFile(join(dir, "profile.json"), JSON.stringify({ summary, user, prefs }, null, 2));
  await writeFile(
    join(dir, "workouts.json"),
    JSON.stringify(presentAthleteWorkouts(workouts), null, 2),
  );
  await writeFile(join(dir, "exercises.json"), JSON.stringify(exercises, null, 2));
  await writeFile(join(dir, "working-maxes.json"), JSON.stringify(workingMaxes, null, 2));

  let histories = 0;
  if (values.full === true) {
    await mkdir(join(dir, "history"), { recursive: true });
    logErr(`fetching per-exercise history for ${exercises.length} exercises (--full)...`);
    await mapPool(exercises, 5, async (ex) => {
      const id = Number(ex.id);
      const detail = await fetchExerciseHistoryDetail(client, id, userId).catch(() => null);
      if (detail) {
        await writeFile(
          join(dir, "history", `${id}.json`),
          JSON.stringify(presentExerciseHistory(detail), null, 2),
        );
        histories += 1;
      }
    });
  }

  out({
    exported: dir,
    range: { start, end },
    workouts: workouts.length,
    exercises: exercises.length,
    workingMaxes: workingMaxes.length,
    histories: values.full === true ? histories : "skipped (use --full)",
  });
}

const LOG_SET_USAGE = "athlete log-set --date Y-M-D --set <id> <resultsJson> --yes";

async function cmdAthleteLogSet(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values, positionals } = parse(a, {
    date: { type: "string" },
    set: { type: "string" },
    file: { type: "string" },
    yes: { type: "boolean" },
  });
  const date = isoDate(need(values.date as string | undefined, LOG_SET_USAGE), "--date");
  const savedWorkoutSetId = toInt(need(values.set as string | undefined, LOG_SET_USAGE), "--set");
  const results = await jsonInput(positionals[0], values.file as string | undefined);
  const args = validate(logSetArgsSchema, { date, savedWorkoutSetId, results }, "log-set args");
  if (values.yes !== true)
    fail(`logging to set ${savedWorkoutSetId} writes to your coach-visible log; add --yes.`);
  const mapped = args.results.map((r) => ({
    savedWorkoutSetExerciseId: toInt(
      String(r.savedWorkoutSetExerciseId),
      "savedWorkoutSetExerciseId",
    ),
    sets: r.sets.map((s) => {
      const slot: { param1?: number | string; param2?: number | string } = {};
      if (s.param1 !== undefined) slot.param1 = s.param1;
      if (s.param2 !== undefined) slot.param2 = s.param2;
      return slot;
    }),
  }));
  return out(await logAthleteSet(client, { date: args.date, savedWorkoutSetId, results: mapped }));
}

async function cmdAthlete(client: TrainHeroicClient, rest: string[]): Promise<void> {
  const [sub, ...a] = rest;
  switch (sub) {
    case "whoami":
      return out(await get(client, "/user/simple"));
    case "profile": {
      const { values } = parse(a, { metric: { type: "boolean" } });
      const userId = await resolveAthleteUserId(client);
      const [summary, user] = await Promise.all([
        fetchAthleteProfileSummary(client, userId, values.metric === true),
        fetchAthleteUser(client, userId),
      ]);
      return out({ summary, user });
    }
    case "prefs":
      return out(await fetchAthletePrefs(client));
    case "workouts": {
      const { values } = parse(a, {
        start: { type: "string" },
        end: { type: "string" },
        raw: { type: "boolean" },
      });
      const start = isoDate(
        need(values.start as string | undefined, "athlete workouts --start Y-M-D --end Y-M-D"),
        "--start",
      );
      const end = isoDate(
        need(values.end as string | undefined, "athlete workouts --start Y-M-D --end Y-M-D"),
        "--end",
      );
      const workouts = await fetchAthleteWorkouts(client, start, end);
      return out(values.raw === true ? workouts : presentAthleteWorkouts(workouts));
    }
    case "exercises": {
      const { values } = parse(a, { q: { type: "string" }, limit: { type: "string" } });
      const limit = values.limit !== undefined ? toInt(values.limit as string, "--limit") : 20;
      const q = values.q as string | undefined;
      return out(
        q !== undefined
          ? await searchExerciseHistory(client, q, limit)
          : await fetchExerciseHistoryList(client),
      );
    }
    case "history": {
      const { values, positionals } = parse(a, { raw: { type: "boolean" } });
      const id = toInt(need(positionals[0], "athlete history <exerciseId>"), "exerciseId");
      const userId = await resolveAthleteUserId(client);
      const detail = await fetchExerciseHistoryDetail(client, id, userId);
      return out(values.raw === true ? detail : presentExerciseHistory(detail));
    }
    case "prs":
      return out(
        await fetchPersonalRecords(
          client,
          toInt(need(a[0], "athlete prs <exerciseId>"), "exerciseId"),
        ),
      );
    case "stats": {
      const { values, positionals } = parse(a, { date: { type: "string" } });
      const id = toInt(
        need(positionals[0], "athlete stats <exerciseId> --date Y-M-D"),
        "exerciseId",
      );
      const date = isoDate(
        need(values.date as string | undefined, "athlete stats <exerciseId> --date Y-M-D"),
        "--date",
      );
      const userId = await resolveAthleteUserId(client);
      return out(await fetchExerciseStats(client, id, userId, date));
    }
    case "working-maxes":
      return out(await fetchWorkingMaxes(client));
    case "leaderboard": {
      const { values, positionals } = parse(a, {
        page: { type: "string" },
        "page-size": { type: "string" },
        gender: { type: "string" },
      });
      const workoutId = toInt(need(positionals[0], "athlete leaderboard <workoutId>"), "workoutId");
      const opts: { page?: number; pageSize?: number; gender?: number } = {};
      if (values.page !== undefined) opts.page = toInt(values.page as string, "--page");
      if (values["page-size"] !== undefined)
        opts.pageSize = toInt(values["page-size"] as string, "--page-size");
      if (values.gender !== undefined) opts.gender = toInt(values.gender as string, "--gender");
      return out(await fetchLeaderboard(client, workoutId, opts));
    }
    case "export":
      return cmdAthleteExport(client, a);
    case "log-set":
      return cmdAthleteLogSet(client, a);
    default:
      return fail(
        "usage: trainheroic athlete <whoami|profile|prefs|workouts|exercises|history|prs|stats|working-maxes|leaderboard|export|log-set>",
      );
  }
}

async function cmdInstallSkill(): Promise<void> {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) fail("cannot determine home directory.");
  const skillRoot = join(import.meta.dirname, "../skill");
  const skillsDir = join(home, ".claude/skills");
  await mkdir(skillsDir, { recursive: true });
  // Install every skill the package ships (coach + athlete).
  const entries = await readdir(skillRoot, { withFileTypes: true });
  const installed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dest = join(skillsDir, entry.name);
    await cp(join(skillRoot, entry.name), dest, { recursive: true, force: true });
    installed.push(dest);
  }
  out({ installed });
}

async function dispatch(client: TrainHeroicClient, group: string, rest: string[]): Promise<void> {
  switch (group) {
    case "whoami":
      return out(await get(client, "/user/simple"));
    case "head-coach":
      return out(await get(client, "/v5/headCoach"));
    case "athletes":
      return out(await get(client, "/v5/athletes"));
    case "programs":
      return out(await get(client, "/1.0/coach/programs"));
    case "teams":
      return out(await get(client, "/1.0/coach/teams"));
    case "notifications":
      return out(await get(client, "/v5/notifications/counts"));
    case "analytics":
      return out(await get(client, "/v5/analytics"));
    case "program":
      return out(
        await get(
          client,
          `/3.0/coach/program/${encodeURIComponent(need(rest[0], "program <id>"))}`,
        ),
      );
    case "team":
      return out(await get(client, `/v5/teams/${encodeURIComponent(need(rest[0], "team <id>"))}`));
    case "team-codes":
      return out(
        await get(
          client,
          `/v5/teams/${encodeURIComponent(need(rest[0], "team-codes <id>"))}/teamCodes`,
        ),
      );
    case "request":
      return cmdRequest(client, rest);
    case "exercise":
      return cmdExercise(client, rest);
    case "workout":
      return cmdWorkout(client, rest);
    case "message":
      return cmdMessage(client, rest);
    case "athlete":
      return cmdAthlete(client, rest);
    default:
      return fail(`unknown command "${group}". Run 'trainheroic help'.`);
  }
}

async function main(): Promise<void> {
  const [group, ...rest] = process.argv.slice(2);
  if (group === undefined || group === "help" || group === "--help" || group === "-h") {
    process.stdout.write(HELP);
    return;
  }

  if (group === "install-skill") {
    await cmdInstallSkill();
    return;
  }

  const email = process.env.TRAINHEROIC_EMAIL;
  const password = process.env.TRAINHEROIC_PASSWORD;
  if (!email || !password)
    fail("set TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD in the environment.");

  const client = new TrainHeroicClient(email, password, await loadSession());
  try {
    await dispatch(client, group, rest);
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  } finally {
    await saveSession(client.sessionId);
  }
}

await main();
