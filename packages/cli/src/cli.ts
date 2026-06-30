#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parseArgs, type ParseArgsConfig } from "node:util";
import type { ZodType } from "zod";
import {
  coachLogSessionArgsSchema,
  athleteSessionRemoveArgsSchema,
  coachLogSetArgsSchema,
  coachPrescribeSetArgsSchema,
  exerciseCreateSchema,
  logSessionArgsSchema,
  logSetArgsSchema,
  swapAthleteExerciseArgsSchema,
  workoutSpecSchema,
} from "@trainheroic-unofficial/dto";
import {
  ANALYTICS_METRIC_KEYS,
  analyticsMetricCatalog,
  type AnalyticsMetric,
  type ApiBase,
  buildSession,
  type BuildOptions,
  buildCommentPayload,
  collectAdvisories,
  copySession,
  definedProps,
  deleteComment,
  ExerciseLibrary,
  fetchAthleteMainLiftPRs,
  fetchRosterMainLiftPRs,
  fetchAthletePrefs,
  fetchAthleteProfileSummary,
  fetchAthleteUser,
  fetchAthleteWorkouts,
  fetchCoachAthleteCalendarSummary,
  fetchCoachAthleteWorkouts,
  fetchExerciseHistoryDetail,
  fetchExerciseHistoryList,
  fetchExerciseStats,
  fetchLeaderboard,
  fetchPersonalRecords,
  fetchRosterActivity,
  fetchStreams,
  fetchTeamAthleteIds,
  fetchWorkingMaxes,
  inviteAthletes,
  logAdHocSession,
  logAthleteSet,
  logForAthlete,
  logSessionForAthlete,
  prescribeForAthlete,
  toSetResults,
  type SessionExercise,
  teamVolume,
  mapPool,
  queryAnalytics,
  presentAthleteWorkouts,
  presentCoachAthleteTraining,
  presentLogTargets,
  presentExerciseHistory,
  publishSession,
  selectWorkouts,
  selectWorkoutsByProgram,
  summarizeAthleteWorkouts,
  swapAthleteExercise,
  readLive,
  readSession,
  removePersonalWorkout,
  removeSession,
  resolveAthleteUserId,
  searchExerciseHistory,
  sendComment,
  TrainHeroicClient,
} from "@trainheroic-unofficial/js";
import { JsonFileLibraryCache } from "@trainheroic-unofficial/js/node";
import { looksLikeJson, parseDate } from "./parse";
import { loadSession, saveSession } from "./session-cache";

const HELP = `trainheroic — command-line tool for the TrainHeroic API

Credentials come from TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD. Output is JSON.
Coaching commands live under 'coach'; your own training lives under 'athlete'.

Start here (for AI agents):
  trainheroic skill          full workflow guide + copy-paste examples (esp. workout specs)
  trainheroic skill --full   also print the API + workout-creation reference docs
  trainheroic skill list     list the available guides (coach, athlete)

Setup:
  install-skill   copy the Claude Code skills to ~/.claude/skills/

Shared:
  whoami                                                          the logged-in account
  request <METHOD> <path> [json] [--base coach|apis] [--file f]   raw API call (--base defaults to coach)

Coach — manage a roster (needs a coach account):
  coach head-coach | athletes | programs | teams | notifications | analytics
  coach program <id> | team <id> | team-codes <id>

  roster athlete reads (three lenses — pick by the question):
  coach roster-activity --athletes <id,id,...> [--metric]                  rank roster by recency; --metric adds session count + training volume. All-time snapshot, NO date range — for a windowed total use 'coach team-volume'. Get the full id list from 'coach athletes'.
  coach team-volume (--team <id> | --athletes <id,id,...>) --start Y-M-D --end Y-M-D   team training volume scoped to a date window: per-athlete rows (only those who logged in range) + rolled-up totals (volume in lb). --team resolves the roster; --athletes passes ids directly.
  coach athlete-workouts --athlete <id> --start Y-M-D --end Y-M-D [--program <title>|--program-id <id>|--team <id>] [--logged-only] [--summary] [--raw|--log-ids]   prescribed + logged work over a date range; --program (title substring) / --program-id / --team targets one program when the athlete is on several; --logged-only/--summary narrow it to what was actually logged; --log-ids prints just the savedWorkoutSetId + savedWorkoutSetExerciseId per set that log-set needs
  coach athlete-training --athlete <id> --year <YYYY> --month <1-12>        sessions the athlete LOGGED in one month (empty = nothing logged that month, not an error)
  coach athlete-lift-history --athlete <id> --exercise <id> [--since Y-M-D] [--until Y-M-D] [--raw]   one exercise's logged history + PRs
  coach main-lift-prs [--athlete <id>] [--athletes <id,id,...>] [--months <n>]   best PRs for the main lifts (squat/bench/deadlift/overhead press/clean & jerk/snatch); auto-discovers the logged variant. With --athlete, one athlete; otherwise the whole roster (or --athletes subset)

  log for an athlete (record their reps/weights; real invited athletes only — demo/seeded ones 401):
  coach log-set --athlete <id> --date Y-M-D --set <savedWorkoutSetId> <resultsJson>|--file f --yes
      --date is the workout's SCHEDULED date (not necessarily today); get --set (savedWorkoutSetId)
      and each result's savedWorkoutSetExerciseId from 'coach athlete-workouts ... --log-ids'
      resultsJson: [{"savedWorkoutSetExerciseId":N,"sets":[{"param1":reps,"param2":weight}, ...]}, ...]
      each set fills the next position; add "slot":K to place it at the K-th prescribed set. A
      partial log records only the positions you send (plus any logged earlier); a superset block
      completes only once all its exercises are logged.
  coach log-session --athlete <id> --date Y-M-D <exercisesJson>|--file f --yes
      log by exercise instead of by set id: each exercise (exerciseId + sets) is matched to a set
      already on the athlete's calendar that day. The API can't put an off-plan session on an
      athlete's calendar, so an unprescribed exercise fails (it names what IS prescribed).
      JSON is the exercises array: [{"exerciseId":N,"sets":[{"param1":reps,"param2":weight}, ...]}, ...]
  coach swap-exercise --set-exercise <savedWorkoutSetExerciseId> --exercise <exerciseId> --yes
      swap one exercise in the athlete's scheduled workout for a different one, that athlete only
      (the team prescription stays put). Get --set-exercise from 'coach athlete-workouts ... --log-ids'
      and --exercise from 'coach exercise resolve/search'.

  prescribe weights/reps for an athlete (set their targets WITHOUT marking the set done; that athlete only):
  coach prescribe-set --athlete <id> --date Y-M-D --set <savedWorkoutSetId> <resultsJson>|--file f --yes
      set the prescribed values on a scheduled set; the set stays open for the athlete to log against,
      and the team prescription is untouched. param1 is reps, param2 is weight; one sets[] entry per
      prescribed set, and the write REPLACES the slot's prescription (an omitted param clears it).
      resultsJson: [{"savedWorkoutSetExerciseId":N,"sets":[{"param1":reps,"param2":weight}, ...]}, ...]
      Same ids as log-set, from 'coach athlete-workouts ... --log-ids'. Use log-set to record a set as PERFORMED.

  roster management:
  coach athlete-invite --team <id> --emails a@x,b@y [--message "..."] --yes
  coach athlete-archive --athletes <id,id,...> --yes
  coach athlete-restore --athletes <id,id,...>

  teams & join codes:
  coach team-create --title "..."
  coach team-update --team <id> --title "..."
  coach team-delete --team <id> --yes
  coach team-code-create --team <id> [--type N]
  coach team-code-delete --code <id> --yes        (--code is the id from team-code-create, not the join-code number)

  session lifecycle:
  coach session-copy --to-program <id> --pw <id> --to-date Y-M-D
  coach session-unpublish --pw <id> --yes
  coach session-save-template --workout <id>

  analytics (curated metrics; for team training volume/recency use roster-activity --metric instead):
  coach analytics-query [--metric <key>] [--team <id>] [--users id,id] [--exercise <id>] [--date|--start|--end Y-M-D] [--use-metric]
      run with no --metric to list the valid keys + each one's scope and required params
      (these keys are curated and differ from the raw 'coach analytics' categories)

  exercise library (cached at ~/.trainheroic/library.json):
  coach exercise resolve <name>
  coach exercise search <query> [--limit N]
  coach exercise get <id>
  coach exercise sync [--force]
  coach exercise create <json>|--file f
  coach exercise forget <id> --yes
  coach exercise stats

  workouts (spec: {"blocks":[{"title","exercises":[{"id","sets"?,"reps"?,"weight"?,"rpe"?}]}],"instruction"?};
            reps/weight may be a scalar or per-set array; omit --publish to leave a draft):
  coach workout build --program <id> (--date Y-M-D | --timeline-day <n>) [--publish --yes] <spec.json>|--file f
  coach workout read --program <id> --date Y-M-D --pw <id>
  coach workout publish --pw <id> --yes
  coach workout remove --program <id> --pw <id> --yes

  messaging:
  coach message list
  coach message read <streamId> [--limit N]
  coach message draft <streamId> <text> [--reply-to <id>]
  coach message send <streamId> <text> [--reply-to <id>] --yes
  coach message delete <streamId> <commentId> --yes

Athlete — the logged-in user's own training (a coach account works too):
  athlete whoami | profile [--metric] | prefs | working-maxes
  athlete workouts --start Y-M-D --end Y-M-D [--raw] [--logged-only] [--limit N] [--summary]   (reads what you did; for the log ids use 'athlete log-targets')
  athlete log-targets --start Y-M-D --end Y-M-D [--program <title>|--program-id <id>|--team <id>] [--raw]   (the savedWorkoutSetId + savedWorkoutSetExerciseId log-set needs; --program narrows when several workouts share a date)
  athlete exercises [--q <text>] [--limit N]
  athlete history <exerciseId> [--raw]
  athlete prs <exerciseId>
  athlete stats <exerciseId> --date Y-M-D
  athlete leaderboard <workoutId> [--page N] [--page-size N] [--gender N]
  athlete export [--out dir] [--start Y-M-D] [--end Y-M-D] [--full]
  athlete log-set --date Y-M-D --set <savedWorkoutSetId> <resultsJson>|--file f --yes   (logs to a PRESCRIBED workout on that date; ids from 'athlete log-targets'; each set fills the next position, add "slot":K to target the K-th; a partial log records only what you send)
  athlete log-session --date Y-M-D <exercisesJson>|--file f --yes   (log OFF-PLAN work with no prescription — creates/reuses a personal session for the date, then logs it; exerciseIds from 'athlete exercises')
  athlete session-remove --id <programWorkoutId> --date Y-M-D --yes   (delete a stray PERSONAL session; the id is the session 'id' from 'athlete workouts')
      JSON is the exercises array: [{"exerciseId":N,"sets":[{"param1":reps,"param2":weight}, ...]}, ...]
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
function validate<T>(schema: ZodType<T>, value: unknown, label: string, hint?: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    fail(`invalid ${label} — ${issues}${hint ? `\n${hint}` : ""}`);
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

/** A thin write request (POST/PUT/DELETE) that fails on a non-2xx and returns the body. */
async function mutate(
  client: TrainHeroicClient,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await client.request(method, path, body !== undefined ? { body } : {});
  if (!res.ok) fail(`${method} ${path} failed (HTTP ${res.status}).`);
  return res.data;
}

/** Parse a comma-separated id list ("1,2,3") into numbers. */
function idList(value: string, label: string): number[] {
  return value.split(",").map((s) => toInt(s.trim(), label));
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
        await lib.resolve(need(a.join(" ").trim() || undefined, "coach exercise resolve <name>")),
      );
    case "search": {
      const { values, positionals } = parse(a, { limit: { type: "string" } });
      const query = need(
        positionals.join(" ").trim() || undefined,
        "coach exercise search <query>",
      );
      const limit = values.limit !== undefined ? toInt(values.limit as string, "--limit") : 20;
      return out(await lib.search(query, limit));
    }
    case "get":
      return out(await lib.get(toInt(need(a[0], "coach exercise get <id>"), "id")));
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
      const id = toInt(need(positionals[0], "coach exercise forget <id> --yes"), "id");
      if (values.yes !== true) fail(`add --yes to forget exercise ${id} from the local cache.`);
      await lib.recordDelete(id);
      return out({ forgotten: id });
    }
    case "stats":
      return out(await lib.stats());
    default:
      return fail(
        "usage: trainheroic coach exercise <resolve|search|get|sync|create|forget|stats>",
      );
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
        need(values.program as string | undefined, "coach workout build --program <id> ..."),
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
        "run 'trainheroic skill' for the workout spec format and copy-paste examples.",
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
          "coach workout read --program <id> --date Y-M-D --pw <id>",
        ),
        "--program",
      );
      const date = parseDate(
        need(
          values.date as string | undefined,
          "coach workout read --program <id> --date Y-M-D --pw <id>",
        ),
      );
      const pw = toInt(
        need(
          values.pw as string | undefined,
          "coach workout read --program <id> --date Y-M-D --pw <id>",
        ),
        "--pw",
      );
      return out(await readSession(client, programId, date, pw));
    }
    case "publish": {
      const { values } = parse(a, { pw: { type: "string" }, yes: { type: "boolean" } });
      const pw = toInt(
        need(values.pw as string | undefined, "coach workout publish --pw <id> --yes"),
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
        need(
          values.program as string | undefined,
          "coach workout remove --program <id> --pw <id> --yes",
        ),
        "--program",
      );
      const pw = toInt(
        need(
          values.pw as string | undefined,
          "coach workout remove --program <id> --pw <id> --yes",
        ),
        "--pw",
      );
      if (values.yes !== true) fail(`removing pw ${pw} deletes the session; add --yes.`);
      await removeSession(client, programId, pw);
      return out({ removed: pw });
    }
    default:
      return fail("usage: trainheroic coach workout <build|read|publish|remove>");
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
        need(positionals[0], "coach message read <streamId> [--limit N]"),
        "streamId",
      );
      const limit = values.limit !== undefined ? toInt(values.limit as string, "--limit") : 20;
      return out(await readLive(client, streamId, limit));
    }
    case "draft": {
      const { values, positionals } = parse(a, { "reply-to": { type: "string" } });
      const streamId = toInt(
        need(positionals[0], "coach message draft <streamId> <text>"),
        "streamId",
      );
      const text = need(
        positionals.slice(1).join(" ").trim() || undefined,
        "coach message draft <streamId> <text>",
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
        need(positionals[0], "coach message send <streamId> <text> --yes"),
        "streamId",
      );
      const text = need(
        positionals.slice(1).join(" ").trim() || undefined,
        "coach message send <streamId> <text> --yes",
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
        need(positionals[0], "coach message delete <streamId> <commentId> --yes"),
        "streamId",
      );
      const commentId = toInt(
        need(positionals[1], "coach message delete <streamId> <commentId> --yes"),
        "commentId",
      );
      if (values.yes !== true)
        fail(`deleting comment ${commentId} acts on the live account; add --yes.`);
      return out({ deleted: true, response: await deleteComment(client, streamId, commentId) });
    }
    default:
      return fail("usage: trainheroic coach message <list|read|draft|send|delete>");
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
  return out(
    await logAthleteSet(client, {
      date: args.date,
      savedWorkoutSetId,
      results: toSetResults(args.results),
    }),
  );
}

const LOG_SESSION_USAGE = "athlete log-session --date Y-M-D <exercisesJson>|--file f --yes";

/** Map validated logSession exercises to the SDK's SessionExercise[] (ids coerced, slots trimmed). */
function toSessionExercises(
  exercises: ReadonlyArray<{
    exerciseId: number | string;
    order?: number | undefined;
    sets: ReadonlyArray<{
      param1?: number | string | undefined;
      param2?: number | string | undefined;
    }>;
  }>,
): SessionExercise[] {
  return exercises.map((e) => {
    const sets = e.sets.map((s) => {
      const slot: { param1?: number | string; param2?: number | string } = {};
      if (s.param1 !== undefined) slot.param1 = s.param1;
      if (s.param2 !== undefined) slot.param2 = s.param2;
      return slot;
    });
    const mapped: SessionExercise = { exerciseId: toInt(String(e.exerciseId), "exerciseId"), sets };
    if (e.order !== undefined) mapped.order = e.order;
    return mapped;
  });
}

// Log an off-plan session for the logged-in athlete: create-or-reuse a personal session for the
// date, then add the exercises and log their sets. No coach-scheduled workout required.
async function cmdAthleteLogSession(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values, positionals } = parse(a, {
    date: { type: "string" },
    file: { type: "string" },
    yes: { type: "boolean" },
  });
  const date = isoDate(need(values.date as string | undefined, LOG_SESSION_USAGE), "--date");
  const exercises = await jsonInput(positionals[0], values.file as string | undefined);
  const args = validate(logSessionArgsSchema, { date, exercises }, "log-session args");
  if (values.yes !== true)
    fail(`logging a session on ${date} writes to your coach-visible log; add --yes.`);
  const result = await logAdHocSession(client, {
    date: args.date,
    exercises: toSessionExercises(args.exercises),
  });
  // Warn (don't redirect): a logged lift was already on a coach-scheduled workout today. Advisory to
  // stderr so stdout stays pure JSON; the scheduledAlternatives field carries the ids to log there.
  const scheduled = result.scheduledAlternatives ?? [];
  if (scheduled.length > 0) {
    const names = scheduled.map((s) => s.title).join(", ");
    process.stderr.write(
      `note: ${names} ${scheduled.length === 1 ? "was" : "were"} already on a coach-scheduled ` +
        `workout today; this logged a SEPARATE personal session. To log into the scheduled workout ` +
        `instead, use 'athlete log-set' with the savedWorkoutSetId/savedWorkoutSetExerciseId in ` +
        `scheduledAlternatives, or 'athlete session-remove' to delete this personal session.\n`,
    );
  }
  return out(result);
}

// The savedWorkoutSetId + savedWorkoutSetExerciseId that `athlete log-set` needs, read straight off
// the logged-in athlete's own scheduled/logged workouts — no --raw needed. --program/--program-id/
// --team narrows to one program when several workouts share a date.
async function cmdAthleteLogTargets(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage =
    "athlete log-targets --start Y-M-D --end Y-M-D [--program <title>|--program-id <id>|--team <id>] [--raw]";
  const { values } = parse(a, {
    start: { type: "string" },
    end: { type: "string" },
    program: { type: "string" },
    "program-id": { type: "string" },
    team: { type: "string" },
    raw: { type: "boolean" },
  });
  const start = isoDate(need(values.start as string | undefined, usage), "--start");
  const end = isoDate(need(values.end as string | undefined, usage), "--end");
  const all = await fetchAthleteWorkouts(client, start, end);
  const filter: { programTitle?: string; programId?: number; teamId?: number } = {};
  if (values.program !== undefined) filter.programTitle = values.program as string;
  if (values["program-id"] !== undefined)
    filter.programId = toInt(values["program-id"] as string, "--program-id");
  if (values.team !== undefined) filter.teamId = toInt(values.team as string, "--team");
  const workouts = selectWorkoutsByProgram(all, filter);
  return out(values.raw === true ? workouts : presentLogTargets(workouts));
}

const SESSION_REMOVE_USAGE = "athlete session-remove --id <programWorkoutId> --date Y-M-D --yes";

// Delete a personal (self-created) session — cleanup for a stray ad-hoc log. Verifies the target is
// a personal session (personal_cal) on that date and refuses a coach-scheduled workout.
async function cmdAthleteSessionRemove(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values } = parse(a, {
    id: { type: "string" },
    date: { type: "string" },
    yes: { type: "boolean" },
  });
  const args = validate(
    athleteSessionRemoveArgsSchema,
    {
      programWorkoutId: need(values.id as string | undefined, SESSION_REMOVE_USAGE),
      date: isoDate(need(values.date as string | undefined, SESSION_REMOVE_USAGE), "--date"),
    },
    "session-remove args",
  );
  const id = toInt(String(args.programWorkoutId), "--id");
  if (values.yes !== true)
    fail(`removing personal session ${id} deletes its logged work; add --yes.`);
  // removePersonalWorkout re-reads the day and throws if the target is missing or coach-scheduled
  // (the personal-only guard lives in the SDK); the top-level catch prints that message.
  await removePersonalWorkout(client, { programWorkoutId: id, date: args.date });
  return out({ removed: true, programWorkoutId: id, date: args.date });
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
        "log-ids": { type: "boolean" },
        "logged-only": { type: "boolean" },
        limit: { type: "string" },
        summary: { type: "boolean" },
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
      if (values["log-ids"] === true) return out(presentLogTargets(workouts));
      if (values.raw === true) return out(workouts);
      const opts: { loggedOnly?: boolean; limit?: number } = {};
      if (values["logged-only"] === true) opts.loggedOnly = true;
      if (values.limit !== undefined) opts.limit = toInt(values.limit as string, "--limit");
      const selected = selectWorkouts(presentAthleteWorkouts(workouts), opts);
      return out(values.summary === true ? summarizeAthleteWorkouts(selected) : selected);
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
    case "log-targets":
      return cmdAthleteLogTargets(client, a);
    case "log-set":
      return cmdAthleteLogSet(client, a);
    case "log-session":
      return cmdAthleteLogSession(client, a);
    case "session-remove":
      return cmdAthleteSessionRemove(client, a);
    default:
      return fail(
        "usage: trainheroic athlete <whoami|profile|prefs|workouts|log-targets|exercises|history|prs|stats|working-maxes|leaderboard|export|log-set|log-session|session-remove>",
      );
  }
}

// Print a shipped skill guide to stdout so an agent can read it in-context (the way
// `agent-browser skills get core` works). Defaults to the coach guide; `--full` appends the
// reference docs (API reference, workout-creation, data-warehouse).
async function cmdSkill(rest: string[]): Promise<void> {
  const skillRoot = join(import.meta.dirname, "../skill");
  const positional = rest.find((r) => !r.startsWith("-"));
  if (positional === "list") {
    const entries = await readdir(skillRoot, { withFileTypes: true });
    return out(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  }
  const name = positional ?? "trainheroic-unofficial";
  const dir = join(skillRoot, name);
  let text: string;
  try {
    text = await readFile(join(dir, "SKILL.md"), "utf8");
  } catch {
    return fail(`unknown skill "${name}". Run 'trainheroic skill list'.`);
  }
  process.stdout.write(text);
  if (rest.includes("--full")) {
    try {
      const refDir = join(dir, "references");
      const refs = (await readdir(refDir)).filter((f) => f.endsWith(".md")).sort();
      for (const f of refs) {
        process.stdout.write(`\n\n===== references/${f} =====\n\n`);
        process.stdout.write(await readFile(join(refDir, f), "utf8"));
      }
    } catch {
      /* no references dir: the SKILL.md alone is the guide */
    }
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

const COACH_USAGE =
  "usage: trainheroic coach <head-coach|athletes|programs|teams|notifications|analytics|program <id>|team <id>|team-codes <id>|roster-activity|team-volume|athlete-training|athlete-lift-history|main-lift-prs|athlete-workouts|log-set|log-session|prescribe-set|swap-exercise|athlete-invite|athlete-archive|athlete-restore|team-create|team-update|team-delete|team-code-create|team-code-delete|session-copy|session-unpublish|session-save-template|analytics-query|exercise|workout|message>";

const COACH_LOG_SET_USAGE =
  "coach log-set --athlete <id> --date Y-M-D --set <savedWorkoutSetId> <resultsJson> --yes";

// Coach "Log for Athlete": record a roster athlete's set results on their behalf. Mirrors
// `athlete log-set` but targets another athlete (real, not a demo/seeded athlete — those 401).
async function cmdCoachLogSet(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values, positionals } = parse(a, {
    athlete: { type: "string" },
    date: { type: "string" },
    set: { type: "string" },
    file: { type: "string" },
    yes: { type: "boolean" },
  });
  const athleteId = toInt(
    need(values.athlete as string | undefined, COACH_LOG_SET_USAGE),
    "--athlete",
  );
  const date = isoDate(need(values.date as string | undefined, COACH_LOG_SET_USAGE), "--date");
  const savedWorkoutSetId = toInt(
    need(values.set as string | undefined, COACH_LOG_SET_USAGE),
    "--set",
  );
  const results = await jsonInput(positionals[0], values.file as string | undefined);
  const args = validate(
    coachLogSetArgsSchema,
    { athleteId, date, savedWorkoutSetId, results },
    "coach log-set args",
  );
  if (values.yes !== true)
    fail(
      `logging to athlete ${athleteId}'s set ${savedWorkoutSetId} writes to their training log; add --yes.`,
    );
  return out(
    await logForAthlete(client, {
      athleteId,
      date: args.date,
      savedWorkoutSetId,
      results: toSetResults(args.results),
    }),
  );
}

const COACH_PRESCRIBE_SET_USAGE =
  "coach prescribe-set --athlete <id> --date Y-M-D --set <savedWorkoutSetId> <resultsJson>|--file f --yes";

// Coach prescription override: set an athlete's prescribed reps/weight for one saved set WITHOUT
// marking it done (the set stays open to log against). Mirrors `coach log-set` but writes targets,
// not results; param1 is reps, param2 is weight, and the write replaces the slot's prescription.
async function cmdCoachPrescribeSet(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values, positionals } = parse(a, {
    athlete: { type: "string" },
    date: { type: "string" },
    set: { type: "string" },
    file: { type: "string" },
    yes: { type: "boolean" },
  });
  const athleteId = toInt(
    need(values.athlete as string | undefined, COACH_PRESCRIBE_SET_USAGE),
    "--athlete",
  );
  const date = isoDate(
    need(values.date as string | undefined, COACH_PRESCRIBE_SET_USAGE),
    "--date",
  );
  const savedWorkoutSetId = toInt(
    need(values.set as string | undefined, COACH_PRESCRIBE_SET_USAGE),
    "--set",
  );
  const results = await jsonInput(positionals[0], values.file as string | undefined);
  const args = validate(
    coachPrescribeSetArgsSchema,
    { athleteId, date, savedWorkoutSetId, results },
    "coach prescribe-set args",
  );
  if (values.yes !== true)
    fail(
      `prescribing to athlete ${athleteId}'s set ${savedWorkoutSetId} changes their plan; add --yes.`,
    );
  return out(
    await prescribeForAthlete(client, {
      athleteId,
      date: args.date,
      savedWorkoutSetId,
      results: toSetResults(args.results),
    }),
  );
}

const COACH_LOG_SESSION_USAGE =
  "coach log-session --athlete <id> --date Y-M-D <exercisesJson>|--file f --yes";

// Log a roster athlete's session by exercise. The API can only log against a session the athlete
// already has on that date, so each exercise must be prescribed; ad-hoc-for-athlete is not possible.
async function cmdCoachLogSession(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values, positionals } = parse(a, {
    athlete: { type: "string" },
    date: { type: "string" },
    file: { type: "string" },
    yes: { type: "boolean" },
  });
  const athleteId = toInt(
    need(values.athlete as string | undefined, COACH_LOG_SESSION_USAGE),
    "--athlete",
  );
  const date = isoDate(need(values.date as string | undefined, COACH_LOG_SESSION_USAGE), "--date");
  const exercises = await jsonInput(positionals[0], values.file as string | undefined);
  const args = validate(
    coachLogSessionArgsSchema,
    { athleteId, date, exercises },
    "coach log-session args",
  );
  if (values.yes !== true)
    fail(`logging a session for athlete ${athleteId} writes to their training log; add --yes.`);
  return out(
    await logSessionForAthlete(client, {
      athleteId,
      date: args.date,
      exercises: toSessionExercises(args.exercises),
    }),
  );
}

const COACH_SWAP_EXERCISE_USAGE =
  "coach swap-exercise --set-exercise <savedWorkoutSetExerciseId> --exercise <exerciseId> --yes";

// Per-athlete exercise swap: replace one exercise in a roster athlete's scheduled workout with
// a different one, for that athlete only (the team prescription is untouched). The slot id comes
// from `coach athlete-workouts --log-ids`; demo/seeded athletes are read-only and 401.
async function cmdCoachSwapExercise(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values } = parse(a, {
    "set-exercise": { type: "string" },
    exercise: { type: "string" },
    yes: { type: "boolean" },
  });
  const savedWorkoutSetExerciseId = toInt(
    need(values["set-exercise"] as string | undefined, COACH_SWAP_EXERCISE_USAGE),
    "--set-exercise",
  );
  const exerciseId = toInt(
    need(values.exercise as string | undefined, COACH_SWAP_EXERCISE_USAGE),
    "--exercise",
  );
  validate(
    swapAthleteExerciseArgsSchema,
    { savedWorkoutSetExerciseId, exerciseId },
    "coach swap-exercise args",
  );
  if (values.yes !== true)
    fail(
      `swapping slot ${savedWorkoutSetExerciseId} changes what the athlete is prescribed; add --yes.`,
    );
  return out(await swapAthleteExercise(client, { savedWorkoutSetExerciseId, exerciseId }));
}

// Team-wide training volume scoped to a date window: pass --team (roster resolved) or --athletes.
async function cmdCoachTeamVolume(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage =
    "coach team-volume (--team <id> | --athletes <id,id,...>) --start Y-M-D --end Y-M-D";
  const { values } = parse(a, {
    team: { type: "string" },
    athletes: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
  });
  const dateStart = isoDate(need(values.start as string | undefined, usage), "--start");
  const dateEnd = isoDate(need(values.end as string | undefined, usage), "--end");
  const athleteIds =
    values.athletes !== undefined
      ? idList(values.athletes as string, "--athletes")
      : await fetchTeamAthleteIds(
          client,
          toInt(need(values.team as string | undefined, usage), "--team"),
        );
  if (athleteIds.length === 0)
    fail(
      "no athletes resolved — pass --athletes <id,id,...> or a --team whose roster has athletes.",
    );
  return out(await teamVolume(client, { athleteIds, dateStart, dateEnd }));
}

// A roster athlete's saved workouts in a date window. raw exposes the savedWorkoutSetId +
// savedWorkoutSetExerciseId that `coach log-set` needs.
async function cmdCoachAthleteWorkouts(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage =
    "coach athlete-workouts --athlete <id> --start Y-M-D --end Y-M-D [--program <title>|--program-id <id>|--team <id>] [--raw|--log-ids] [--logged-only] [--limit N] [--summary]";
  const { values } = parse(a, {
    athlete: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    program: { type: "string" },
    "program-id": { type: "string" },
    team: { type: "string" },
    raw: { type: "boolean" },
    "log-ids": { type: "boolean" },
    "logged-only": { type: "boolean" },
    limit: { type: "string" },
    summary: { type: "boolean" },
  });
  const athleteId = toInt(need(values.athlete as string | undefined, usage), "--athlete");
  const start = isoDate(need(values.start as string | undefined, usage), "--start");
  const end = isoDate(need(values.end as string | undefined, usage), "--end");
  const all = await fetchCoachAthleteWorkouts(client, athleteId, start, end);
  // An athlete on many programs returns one workout per program; narrow to one with --program (a
  // title substring, no id lookup) or --program-id/--team, keeping high-enrollment athletes small.
  const filter: { programTitle?: string; programId?: number; teamId?: number } = {};
  if (values.program !== undefined) filter.programTitle = values.program as string;
  if (values["program-id"] !== undefined)
    filter.programId = toInt(values["program-id"] as string, "--program-id");
  if (values.team !== undefined) filter.teamId = toInt(values.team as string, "--team");
  const workouts = selectWorkoutsByProgram(all, filter);
  if (values["log-ids"] === true) return out(presentLogTargets(workouts));
  if (values.raw === true) return out(workouts);
  // Same logged-only/limit/summary post-filters as `athlete workouts`, so a coach can narrow a
  // roster athlete's range to just what they logged instead of scanning every prescribed session.
  const opts: { loggedOnly?: boolean; limit?: number } = {};
  if (values["logged-only"] === true) opts.loggedOnly = true;
  if (values.limit !== undefined) opts.limit = toInt(values.limit as string, "--limit");
  const selected = selectWorkouts(presentAthleteWorkouts(workouts), opts);
  return out(values.summary === true ? summarizeAthleteWorkouts(selected) : selected);
}

// Rank roster athletes by training recency (most-recently-active first).
async function cmdCoachRosterActivity(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach roster-activity --athletes <id,id,...> [--metric]";
  const { values } = parse(a, { athletes: { type: "string" }, metric: { type: "boolean" } });
  const ids = idList(need(values.athletes as string | undefined, usage), "--athletes");
  return out(await fetchRosterActivity(client, ids, values.metric === true));
}

// Invite athletes to a team (the two-step validate + invite "create athlete" flow).
async function cmdCoachAthleteInvite(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = 'coach athlete-invite --team <id> --emails a@x,b@y [--message "..."] --yes';
  const { values } = parse(a, {
    team: { type: "string" },
    emails: { type: "string" },
    message: { type: "string" },
    yes: { type: "boolean" },
  });
  const teamId = toInt(need(values.team as string | undefined, usage), "--team");
  const emails = need(values.emails as string | undefined, usage)
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (values.yes !== true)
    fail(`inviting ${emails.join(", ")} emails them a real invitation; add --yes.`);
  return out(
    await inviteAthletes(
      client,
      definedProps({ teamId, emails, message: values.message as string | undefined }),
    ),
  );
}

// Archive (remove from active roster; restorable) one or more athletes.
async function cmdCoachAthleteArchive(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach athlete-archive --athletes <id,id,...> --yes";
  const { values } = parse(a, { athletes: { type: "string" }, yes: { type: "boolean" } });
  const athleteIds = idList(need(values.athletes as string | undefined, usage), "--athletes");
  if (values.yes !== true)
    fail(
      `archiving athlete(s) ${athleteIds.join(", ")} removes them from the active roster; add --yes.`,
    );
  return out(await mutate(client, "PUT", "/v5/athletes/archive", { athleteIds }));
}

async function cmdCoachAthleteRestore(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach athlete-restore --athletes <id,id,...>";
  const { values } = parse(a, { athletes: { type: "string" } });
  const athleteIds = idList(need(values.athletes as string | undefined, usage), "--athletes");
  return out(await mutate(client, "PUT", "/v5/athletes/restore", { athleteIds }));
}

async function cmdCoachTeamCreate(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values } = parse(a, { title: { type: "string" } });
  const title = need(values.title as string | undefined, 'coach team-create --title "..."');
  return out(await mutate(client, "POST", "/1.0/coach/team/createWithTitleAndCode", { title }));
}

async function cmdCoachTeamUpdate(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = 'coach team-update --team <id> --title "..."';
  const { values } = parse(a, { team: { type: "string" }, title: { type: "string" } });
  const teamId = toInt(need(values.team as string | undefined, usage), "--team");
  const title = need(values.title as string | undefined, usage);
  return out(await mutate(client, "PUT", `/v5/teams/${teamId}`, { title }));
}

async function cmdCoachTeamDelete(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach team-delete --team <id> --yes";
  const { values } = parse(a, { team: { type: "string" }, yes: { type: "boolean" } });
  const teamId = toInt(need(values.team as string | undefined, usage), "--team");
  if (values.yes !== true) fail(`deleting team ${teamId} removes it and its calendar; add --yes.`);
  return out(await mutate(client, "DELETE", `/v5/teams/${teamId}`));
}

async function cmdCoachTeamCodeCreate(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach team-code-create --team <id> [--type N]";
  const { values } = parse(a, { team: { type: "string" }, type: { type: "string" } });
  const teamId = toInt(need(values.team as string | undefined, usage), "--team");
  const type = values.type !== undefined ? toInt(values.type as string, "--type") : 2;
  return out(await mutate(client, "POST", `/v5/teams/${teamId}/teamCodes`, { type }));
}

async function cmdCoachTeamCodeDelete(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach team-code-delete --code <id> --yes";
  const { values } = parse(a, { code: { type: "string" }, yes: { type: "boolean" } });
  const codeId = toInt(need(values.code as string | undefined, usage), "--code");
  if (values.yes !== true)
    fail(`deleting team code ${codeId} stops athletes joining with it; add --yes.`);
  return out(await mutate(client, "DELETE", `/v5/teamCodes/${codeId}`));
}

async function cmdCoachSessionCopy(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach session-copy --to-program <id> --pw <id> --to-date Y-M-D";
  const { values } = parse(a, {
    "to-program": { type: "string" },
    pw: { type: "string" },
    "to-date": { type: "string" },
  });
  const toProgramId = toInt(
    need(values["to-program"] as string | undefined, usage),
    "--to-program",
  );
  const pwId = toInt(need(values.pw as string | undefined, usage), "--pw");
  const toDate = need(values["to-date"] as string | undefined, usage);
  return out(await copySession(client, { toProgramId, pwId, toDate }));
}

async function cmdCoachSessionUnpublish(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach session-unpublish --pw <id> --yes";
  const { values } = parse(a, { pw: { type: "string" }, yes: { type: "boolean" } });
  const pwId = toInt(need(values.pw as string | undefined, usage), "--pw");
  if (values.yes !== true)
    fail(`unpublishing session ${pwId} hides it from the athlete; add --yes.`);
  return out(await mutate(client, "POST", `/2.0/coach/calendar/programWorkout/unPublish/${pwId}`));
}

async function cmdCoachSessionSaveTemplate(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach session-save-template --workout <id>";
  const { values } = parse(a, { workout: { type: "string" } });
  const workoutId = toInt(need(values.workout as string | undefined, usage), "--workout");
  return out(
    await mutate(
      client,
      "POST",
      `/2.0/coach/calendar/programWorkout/saveWorkoutAsTemplate/${workoutId}`,
    ),
  );
}

async function cmdCoachAnalyticsQuery(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values } = parse(a, {
    metric: { type: "string" },
    team: { type: "string" },
    users: { type: "string" },
    exercise: { type: "string" },
    date: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    "use-metric": { type: "boolean" },
  });
  // No --metric: print the metric catalog (scope + required/optional params) so the caller can
  // pick a valid one without guessing. These keys are NOT the raw `coach analytics` categories.
  if (values.metric === undefined) {
    return out({
      note: "Pick a --metric from this catalog (these keys differ from the raw 'coach analytics' categories). 'requires'/'optional' are the flags each metric takes.",
      metrics: analyticsMetricCatalog(),
    });
  }
  const metric = values.metric as string;
  if (!(ANALYTICS_METRIC_KEYS as readonly string[]).includes(metric))
    fail(
      `--metric "${metric}" is not valid. Choose one of: ${ANALYTICS_METRIC_KEYS.join(", ")}. ` +
        `Run 'coach analytics-query' with no --metric for each one's scope and required params.`,
    );
  return out(
    await queryAnalytics(
      client,
      definedProps({
        metric: metric as AnalyticsMetric,
        teamId: values.team !== undefined ? toInt(values.team as string, "--team") : undefined,
        userIds: values.users !== undefined ? idList(values.users as string, "--users") : undefined,
        exerciseId:
          values.exercise !== undefined
            ? toInt(values.exercise as string, "--exercise")
            : undefined,
        date: values.date !== undefined ? isoDate(values.date as string, "--date") : undefined,
        dateStart:
          values.start !== undefined ? isoDate(values.start as string, "--start") : undefined,
        dateEnd: values.end !== undefined ? isoDate(values.end as string, "--end") : undefined,
        useMetric: values["use-metric"] === true ? true : undefined,
      }),
    ),
  );
}

// A roster athlete's logged sessions for a calendar month (one row per session).
async function cmdCoachAthleteTraining(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage = "coach athlete-training --athlete <id> --year <YYYY> --month <1-12>";
  const { values } = parse(a, {
    athlete: { type: "string" },
    year: { type: "string" },
    month: { type: "string" },
  });
  const athleteId = toInt(need(values.athlete as string | undefined, usage), "--athlete");
  const year = toInt(need(values.year as string | undefined, usage), "--year");
  const month = toInt(need(values.month as string | undefined, usage), "--month");
  const raw = await fetchCoachAthleteCalendarSummary(client, athleteId, year, month);
  const view = presentCoachAthleteTraining(raw, athleteId, year, month);
  if (view.sessions.length === 0) {
    return out({
      ...view,
      note: `No logged sessions for athlete ${athleteId} in ${year}-${String(month).padStart(2, "0")}. This is a per-month view of sessions the athlete actually logged (not prescribed work) — an empty list means nothing was logged that month, not an error. Try another month, or use 'coach athlete-workouts --athlete <id> --start <date> --end <date>' to see prescribed + logged work over a date range.`,
    });
  }
  return out(view);
}

// A roster athlete's lift history + PRs for one exercise; --since/--until (YYYY-M-D) filter sessions.
async function cmdCoachAthleteLiftHistory(client: TrainHeroicClient, a: string[]): Promise<void> {
  const usage =
    "coach athlete-lift-history --athlete <id> --exercise <id> [--since Y-M-D] [--until Y-M-D] [--raw]";
  const { values } = parse(a, {
    athlete: { type: "string" },
    exercise: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    raw: { type: "boolean" },
  });
  const athleteId = toInt(need(values.athlete as string | undefined, usage), "--athlete");
  const exerciseId = toInt(need(values.exercise as string | undefined, usage), "--exercise");
  const detail = await fetchExerciseHistoryDetail(client, exerciseId, athleteId);
  if (values.raw === true) return out(detail);
  const presented = presentExerciseHistory(detail);
  const since = values.since !== undefined ? isoDate(values.since as string, "--since") : undefined;
  const until = values.until !== undefined ? isoDate(values.until as string, "--until") : undefined;
  const sessions = presented.sessions.filter(
    (s) => (since === undefined || s.date >= since) && (until === undefined || s.date <= until),
  );
  if (sessions.length === 0 && presented.liftPRs.length === 0) {
    return out({
      ...presented,
      sessions,
      note: `No logged history for exercise ${exerciseId} for athlete ${athleteId}${since !== undefined || until !== undefined ? " in this date window" : ""}. This view only shows sessions where the athlete logged this exact exercise — an empty result means none were logged, not an error. Confirm the exercise id (via 'coach exercise resolve <name>') and widen --since/--until.`,
    });
  }
  return out({ ...presented, sessions });
}

// Main-lift PRs (squat/bench/deadlift/overhead press/clean & jerk/snatch). With --athlete, one
// athlete; without it, the whole roster (or a --athletes subset). The logged lift VARIANT is
// auto-discovered, so no exercise ids are needed. --months sets the discovery look-back.
async function cmdCoachMainLiftPrs(client: TrainHeroicClient, a: string[]): Promise<void> {
  const { values } = parse(a, {
    athlete: { type: "string" },
    athletes: { type: "string" },
    months: { type: "string" },
  });
  const opts =
    values.months !== undefined ? { months: toInt(values.months as string, "--months") } : {};

  if (values.athlete !== undefined) {
    const athleteId = toInt(values.athlete as string, "--athlete");
    return out(await fetchAthleteMainLiftPRs(client, athleteId, opts));
  }

  const subset =
    values.athletes !== undefined
      ? (values.athletes as string)
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => toInt(s, "--athletes"))
      : undefined;

  return out(
    await fetchRosterMainLiftPRs(client, { ...opts, ...(subset ? { athleteIds: subset } : {}) }),
  );
}

async function cmdCoach(client: TrainHeroicClient, rest: string[]): Promise<void> {
  const [sub, ...a] = rest;
  switch (sub) {
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
          `/3.0/coach/program/${encodeURIComponent(need(a[0], "coach program <id>"))}`,
        ),
      );
    case "team":
      return out(
        await get(client, `/v5/teams/${encodeURIComponent(need(a[0], "coach team <id>"))}`),
      );
    case "team-codes":
      return out(
        await get(
          client,
          `/v5/teams/${encodeURIComponent(need(a[0], "coach team-codes <id>"))}/teamCodes`,
        ),
      );
    case "roster-activity":
      return cmdCoachRosterActivity(client, a);
    case "team-volume":
      return cmdCoachTeamVolume(client, a);
    case "athlete-training":
      return cmdCoachAthleteTraining(client, a);
    case "athlete-lift-history":
      return cmdCoachAthleteLiftHistory(client, a);
    case "main-lift-prs":
      return cmdCoachMainLiftPrs(client, a);
    case "athlete-workouts":
      return cmdCoachAthleteWorkouts(client, a);
    case "log-set":
      return cmdCoachLogSet(client, a);
    case "log-session":
      return cmdCoachLogSession(client, a);
    case "prescribe-set":
      return cmdCoachPrescribeSet(client, a);
    case "swap-exercise":
      return cmdCoachSwapExercise(client, a);
    case "athlete-invite":
      return cmdCoachAthleteInvite(client, a);
    case "athlete-archive":
      return cmdCoachAthleteArchive(client, a);
    case "athlete-restore":
      return cmdCoachAthleteRestore(client, a);
    case "team-create":
      return cmdCoachTeamCreate(client, a);
    case "team-update":
      return cmdCoachTeamUpdate(client, a);
    case "team-delete":
      return cmdCoachTeamDelete(client, a);
    case "team-code-create":
      return cmdCoachTeamCodeCreate(client, a);
    case "team-code-delete":
      return cmdCoachTeamCodeDelete(client, a);
    case "session-copy":
      return cmdCoachSessionCopy(client, a);
    case "session-unpublish":
      return cmdCoachSessionUnpublish(client, a);
    case "session-save-template":
      return cmdCoachSessionSaveTemplate(client, a);
    case "analytics-query":
      return cmdCoachAnalyticsQuery(client, a);
    case "exercise":
      return cmdExercise(client, a);
    case "workout":
      return cmdWorkout(client, a);
    case "message":
      return cmdMessage(client, a);
    default:
      return fail(COACH_USAGE);
  }
}

async function dispatch(client: TrainHeroicClient, group: string, rest: string[]): Promise<void> {
  switch (group) {
    // Shared: role-agnostic.
    case "whoami":
      return out(await get(client, "/user/simple"));
    case "request":
      return cmdRequest(client, rest);
    // Coaching (roster) commands live under `coach`; the athlete's own training under `athlete`.
    case "coach":
      return cmdCoach(client, rest);
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

  if (group === "skill") {
    await cmdSkill(rest);
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
