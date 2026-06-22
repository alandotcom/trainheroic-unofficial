import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { coachLogSetArgsSchema, dateString } from "@trainheroic-unofficial/dto";
import {
  fetchCoachAthleteWorkouts,
  logForAthlete,
  presentAthleteWorkouts,
} from "@trainheroic-unofficial/js";
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

const DEFAULT_INVITE_MESSAGE = "Follow these steps and you'll be set up and ready to go!";

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

        // 1) Validate. The endpoint echoes back the addresses it considers valid.
        const validation = await ctx.client.request("POST", "/v5/emails/validate", {
          body: { emails: list.join(",") },
        });
        if (!validation.ok) {
          const detail =
            typeof validation.data === "string" ? validation.data : JSON.stringify(validation.data);
          return errorResult(`Email validation failed (HTTP ${validation.status}): ${detail}`);
        }
        const valid = Array.isArray(validation.data) ? (validation.data as string[]) : list;
        if (valid.length === 0) {
          return errorResult(
            `No valid addresses among: ${list.join(", ")}. They may be malformed or already on the team.`,
          );
        }

        // 2) Invite the validated addresses to the team.
        const invite = await ctx.client.request("POST", "/v5/athletes/inviteToTeam", {
          body: {
            teamType: 0,
            teamId: id,
            orgId: null,
            emails: valid,
            message: message ?? DEFAULT_INVITE_MESSAGE,
          },
        });
        if (!invite.ok) {
          const detail =
            typeof invite.data === "string" ? invite.data : JSON.stringify(invite.data);
          return errorResult(`Invite failed (HTTP ${invite.status}): ${detail}`);
        }
        return jsonResult({ invited: true, teamId: id, result: invite.data });
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
}
