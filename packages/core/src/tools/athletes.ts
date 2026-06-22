import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  coachLogSessionArgsSchema,
  coachLogSetArgsSchema,
  dateString,
  swapAthleteExerciseArgsSchema,
} from "@trainheroic-unofficial/dto";
import {
  definedProps,
  fetchCoachAthleteWorkouts,
  inviteAthletes,
  logForAthlete,
  logSessionForAthlete,
  presentAthleteWorkouts,
  swapAthleteExercise,
} from "@trainheroic-unofficial/js";
import { mapSessionExercises } from "./athlete-training";
import { confirmGate, NOT_CONFIRMED } from "../confirm";
import {
  apiCall,
  attempt,
  DESTRUCTIVE,
  errorResult,
  idParam,
  jsonResult,
  READ,
  toId,
} from "../context";
import type { ToolContext } from "../context";

/** Normalize one-or-many emails into a deduped, trimmed list. */
function asEmailList(emails: string | string[]): string[] {
  const arr = Array.isArray(emails) ? emails : [emails];
  return [...new Set(arr.map((e) => e.trim()).filter((e) => e.length > 0))];
}

/**
 * Athlete management. TrainHeroic has no "create athlete" primitive: a coach invites a
 * person by email to a team, and the athlete record only exists once they accept and set
 * their own name. So the create path is the two-step invite from the API reference:
 * validate the address (POST /v5/emails/validate), then inviteToTeam
 * (POST /v5/athletes/inviteToTeam). Both act on the live account, so the invite is gated.
 */
export function registerAthleteTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "athlete_invite",
    {
      title: "Invite an athlete",
      description:
        "Add athletes by emailing them a TrainHeroic team invitation — this is how you " +
        "'create' an athlete; there is no other create path, and no name is collected here " +
        "(the athlete sets their own on accept). Targets a team by id, so list_teams first if " +
        "you need one. Validates each address, then sends the invite. ATHLETE-FACING and " +
        "immediate; requires confirmation (elicitation, or confirm:true).",
      inputSchema: {
        teamId: idParam,
        emails: z.union([z.string(), z.array(z.string()).min(1)]),
        message: z.string().optional(),
        confirm: z.boolean().optional(),
      },
      annotations: DESTRUCTIVE,
    },
    ({ teamId, emails, message, confirm }, extra) =>
      attempt(async () => {
        const list = asEmailList(emails);
        if (list.length === 0) return errorResult("Provide at least one email address to invite.");
        const id = toId(teamId);

        const ok = await confirmGate(
          server,
          extra.requestId,
          `Invite ${list.join(", ")} to team ${id}? This emails them a real TrainHeroic invitation.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);

        const res = await inviteAthletes(
          ctx.client,
          definedProps({ teamId: id, emails: list, message }),
        );
        return jsonResult({ invited: true, teamId: id, result: res.result });
      }),
  );

  server.registerTool(
    "athlete_archive",
    {
      title: "Archive athletes",
      description:
        "Remove one or more athletes from the active roster (PUT /v5/athletes/archive). Their " +
        "data is preserved and they can be restored. Acts on the live account; requires " +
        "confirmation (elicitation, or confirm:true).",
      inputSchema: { athleteIds: z.array(idParam).min(1), confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ athleteIds, confirm }, extra) =>
      attempt(async () => {
        const ids = athleteIds.map(toId);
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Archive athlete(s) ${ids.join(", ")}? They leave the active roster (data is kept and restorable).`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        return apiCall(ctx, "PUT", "/v5/athletes/archive", { body: { athleteIds: ids } });
      }),
  );

  server.registerTool(
    "athlete_restore",
    {
      title: "Restore athletes",
      description:
        "Restore previously archived athletes to the active roster (PUT /v5/athletes/restore).",
      inputSchema: { athleteIds: z.array(idParam).min(1) },
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    ({ athleteIds }) =>
      apiCall(ctx, "PUT", "/v5/athletes/restore", { body: { athleteIds: athleteIds.map(toId) } }),
  );

  registerAthleteLogTools(server, ctx);
  registerAthleteSwapTool(server, ctx);
}

/**
 * Coach "Log for Athlete": read a roster athlete's saved workouts (to get the log ids), then
 * record set results on their behalf. The write is the API equivalent of the app's mobile
 * "Log for Athlete" flow. Kept in its own function so registerAthleteTools stays under the
 * oxlint max-lines-per-function cap.
 */
function registerAthleteLogTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "athlete_saved_workouts",
    {
      title: "Roster athlete's saved workouts (with log ids)",
      description:
        "A roster athlete's scheduled/logged workouts in an inclusive YYYY-MM-DD window — the " +
        "coach-side view that carries the savedWorkoutSetId and savedWorkoutSetExerciseId that " +
        "log_athlete_set needs. Get athleteId from list_athletes. Defaults to a presented view; " +
        "set raw:true for the untouched API objects that expose those ids (each set's id is the " +
        "savedWorkoutSetId; each savedWorkoutSetExercises[].id is the savedWorkoutSetExerciseId). " +
        "athlete_training gives a whole-month overview but not these ids.",
      inputSchema: {
        athleteId: idParam,
        startDate: dateString,
        endDate: dateString,
        raw: z.boolean().optional(),
      },
      annotations: READ,
    },
    ({ athleteId, startDate, endDate, raw }) =>
      attempt(async () => {
        const workouts = await fetchCoachAthleteWorkouts(
          ctx.client,
          toId(athleteId),
          startDate,
          endDate,
        );
        if (raw === true) {
          return jsonResult(workouts, {
            hint: "Each set's id is the savedWorkoutSetId; each savedWorkoutSetExercises[].id is the savedWorkoutSetExerciseId. Pass both to log_athlete_set. Narrow the dates to shrink this.",
          });
        }
        return jsonResult(presentAthleteWorkouts(workouts), {
          hint: "Set raw:true to get savedWorkoutSetId + savedWorkoutSetExerciseId for log_athlete_set.",
        });
      }),
  );

  server.registerTool(
    "log_athlete_set",
    {
      title: "Log set results for a roster athlete",
      description:
        "Coach-facing write: record entered results (reps/weight per set) for one of a roster " +
        "athlete's saved workout sets on a given day, marking the set completed — the API " +
        "equivalent of the app's \"Log for Athlete\". Writes to that athlete's training log and " +
        "shows in their history. Get athleteId from list_athletes; get savedWorkoutSetId + " +
        "savedWorkoutSetExerciseId from athlete_saved_workouts (raw:true) for that athlete/day. " +
        "Seeded demo athletes are read-only and will fail; use a real (invited) athlete. " +
        "Requires confirmation (elicitation or confirm:true).",
      inputSchema: { ...coachLogSetArgsSchema.shape, confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ athleteId, date, savedWorkoutSetId, results, confirm }, extra) =>
      attempt(async () => {
        const aId = toId(athleteId);
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Log results to athlete ${aId}'s saved workout set ${toId(savedWorkoutSetId)} on ${date}? This writes to their coach-visible training log.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        const mapped = results.map((r) => ({
          savedWorkoutSetExerciseId: toId(r.savedWorkoutSetExerciseId),
          sets: r.sets.map((s) => {
            const slot: { param1?: number | string; param2?: number | string } = {};
            if (s.param1 !== undefined) slot.param1 = s.param1;
            if (s.param2 !== undefined) slot.param2 = s.param2;
            return slot;
          }),
        }));
        return jsonResult(
          await logForAthlete(ctx.client, {
            athleteId: aId,
            date,
            savedWorkoutSetId: toId(savedWorkoutSetId),
            results: mapped,
          }),
        );
      }),
  );

  server.registerTool(
    "coach_log_session",
    {
      title: "Log a roster athlete's session by exercise",
      description:
        "Coach-facing write: log results for a roster athlete by exercise on a given day, without " +
        "hunting for saved-set ids. Give athleteId, a YYYY-MM-DD date, and a list of exercises " +
        "(each with its entered sets), and each is matched to a set already on that athlete's " +
        "calendar for the date. The API has no way to put an off-plan session on an athlete's " +
        "calendar, so this only logs against an EXISTING session — if an exercise is not " +
        "prescribed that day the call fails and names what is. Get athleteId from list_athletes " +
        "and exerciseIds from athlete_saved_workouts. Seeded demo athletes are read-only. " +
        "Requires confirmation (elicitation or confirm:true).",
      inputSchema: { ...coachLogSessionArgsSchema.shape, confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ athleteId, date, exercises, confirm }, extra) =>
      attempt(async () => {
        const aId = toId(athleteId);
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Log a session of ${exercises.length} exercise(s) for athlete ${aId} on ${date}? This writes to their coach-visible training log.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        return jsonResult(
          await logSessionForAthlete(ctx.client, {
            athleteId: aId,
            date,
            exercises: mapSessionExercises(exercises),
          }),
        );
      }),
  );
}

/**
 * Coach per-athlete exercise swap, kept in its own function so registerAthleteLogTools stays
 * under the oxlint max-lines-per-function cap.
 */
function registerAthleteSwapTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "swap_athlete_exercise",
    {
      title: "Swap one exercise in a roster athlete's prescribed workout",
      description:
        "Coach-facing write: replace one exercise in a roster athlete's scheduled workout with a " +
        "different one, for that athlete only — the API equivalent of the app's per-athlete " +
        '"swap exercise". The team/program prescription is left untouched, so other athletes on ' +
        "the same program keep the original exercise. Give savedWorkoutSetExerciseId (the " +
        "athlete's own slot, from athlete_saved_workouts with raw:true) and exerciseId (the " +
        "replacement, from exercise_resolve / exercise_search). Seeded demo athletes are " +
        "read-only and will fail; use a real (invited) athlete. Requires confirmation " +
        "(elicitation or confirm:true).",
      inputSchema: { ...swapAthleteExerciseArgsSchema.shape, confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ savedWorkoutSetExerciseId, exerciseId, confirm }, extra) =>
      attempt(async () => {
        const sweId = toId(savedWorkoutSetExerciseId);
        const exId = toId(exerciseId);
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Swap the exercise in saved workout slot ${sweId} to exercise ${exId}? This changes what this athlete is prescribed (their copy only).`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        return jsonResult(
          await swapAthleteExercise(ctx.client, {
            savedWorkoutSetExerciseId: sweId,
            exerciseId: exId,
          }),
        );
      }),
  );
}
