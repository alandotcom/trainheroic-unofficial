import type { McpServer } from "@modelcontextprotocol/server";
import { updateTeam, updateTeamPublishSettings } from "@trainheroic-unofficial/js";
import { z } from "zod";
import { confirmGate } from "../confirm";
import { apiCall, attempt, DESTRUCTIVE, idParam, jsonResult, toId } from "../context";
import type { ToolContext } from "../context";

// Additive writes (create, rename, add code) are not gated, matching exercise_create.
// Deletes act on live data and gate through confirmGate.
const ADDITIVE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

/**
 * Team write tools. The team reads (list_teams, get_team, list_team_codes) live in
 * reads.ts; this module covers create/rename/delete plus the join-code lifecycle.
 */
export function registerTeamTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "team_create",
    {
      title: "Create a team",
      description:
        "Create a team (POST /1.0/coach/team/createWithTitleAndCode). Also creates the team's " +
        "calendar/program. Returns the new team including its calendar id. Use the team id with " +
        "athlete_invite. To point a new team at an existing calendar instead of its auto-created " +
        "one, follow up with team_update groupProgram.",
      inputSchema: { title: z.string().min(1) },
      annotations: ADDITIVE,
    },
    ({ title }) =>
      apiCall(ctx, "POST", "/1.0/coach/team/createWithTitleAndCode", { body: { title } }),
  );

  server.registerTool(
    "team_update",
    {
      title: "Update a team",
      description:
        "Update a team's title and/or reassign its calendar (PUT /v5/teams/{teamId}). " +
        "Pass groupProgram (a program/calendar id — typically another team's group_program from " +
        "list_teams, or get_team) to point this team at an existing parent program. At least one " +
        "of title or groupProgram is required; when only groupProgram is set the current title " +
        "is preserved.",
      inputSchema: {
        teamId: idParam,
        title: z.string().min(1).optional(),
        groupProgram: idParam.optional(),
      },
      annotations: ADDITIVE,
    },
    ({ teamId, title, groupProgram }) =>
      attempt(async () => {
        const args: { teamId: number; title?: string; groupProgram?: number } = {
          teamId: toId(teamId),
        };
        if (title !== undefined) args.title = title;
        if (groupProgram !== undefined) args.groupProgram = toId(groupProgram);
        return jsonResult(await updateTeam(ctx.client, args));
      }),
  );

  server.registerTool(
    "team_delete",
    {
      title: "Delete a team",
      description:
        "Delete a team (DELETE /v5/teams/{teamId}). Removes the team and its calendar from the " +
        "live account; hard to undo. Requires confirmation (elicitation, or confirm:true).",
      inputSchema: { teamId: idParam, confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ teamId, confirm }, extra) =>
      attempt(async () => {
        const id = toId(teamId);
        const blocked = confirmGate(
          extra,
          `Delete team ${id}? This removes the team and its calendar from the live account.`,
          confirm,
        );
        if (blocked) return blocked;
        return apiCall(ctx, "DELETE", `/v5/teams/${id}`);
      }),
  );

  server.registerTool(
    "team_code_create",
    {
      title: "Create a team join code",
      description:
        "Create an access code athletes use to self-join a team " +
        "(POST /v5/teams/{teamId}/teamCodes). `type` defaults to 2, the standard join code.",
      inputSchema: { teamId: idParam, type: z.number().int().optional() },
      annotations: ADDITIVE,
    },
    ({ teamId, type }) =>
      apiCall(ctx, "POST", `/v5/teams/${toId(teamId)}/teamCodes`, { body: { type: type ?? 2 } }),
  );

  server.registerTool(
    "team_code_delete",
    {
      title: "Delete a team join code",
      description:
        "Delete a team access code by its id (DELETE /v5/teamCodes/{codeId}). Athletes can no " +
        "longer use it to join. Requires confirmation (elicitation, or confirm:true).",
      inputSchema: { codeId: idParam, confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ codeId, confirm }, extra) =>
      attempt(async () => {
        const id = toId(codeId);
        const blocked = confirmGate(
          extra,
          `Delete team join code ${id}? Athletes can no longer use it to join.`,
          confirm,
        );
        if (blocked) return blocked;
        return apiCall(ctx, "DELETE", `/v5/teamCodes/${id}`);
      }),
  );
  registerTeamPublishSettings(server, ctx);
}

function registerTeamPublishSettings(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "team_publish_settings",
    {
      title: "Update team auto-publish",
      description:
        "Update a team's auto-publish settings (POST /1.0/coach/team/updatePublishSettings). " +
        "Pass teamId or programId (the team's group_program). At least one of pub_enabled, " +
        "pub_days, pub_time, pub_timezone is required. Athlete-facing — requires confirmation.",
      inputSchema: {
        teamId: idParam.optional(),
        programId: idParam.optional(),
        pub_enabled: z.union([z.number(), z.boolean()]).optional(),
        pub_days: z.unknown().optional(),
        pub_time: z.unknown().optional(),
        pub_timezone: z.string().optional(),
        confirm: z.boolean().optional(),
      },
      annotations: DESTRUCTIVE,
    },
    ({ teamId, programId, pub_enabled, pub_days, pub_time, pub_timezone, confirm }, extra) =>
      attempt(async () => {
        const blocked = confirmGate(
          extra,
          "Change auto-publish settings? This controls when athletes see programmed sessions.",
          confirm,
        );
        if (blocked) return blocked;
        const patch: Record<string, unknown> = {};
        if (pub_enabled !== undefined) patch.pub_enabled = pub_enabled;
        if (pub_days !== undefined) patch.pub_days = pub_days;
        if (pub_time !== undefined) patch.pub_time = pub_time;
        if (pub_timezone !== undefined) patch.pub_timezone = pub_timezone;
        const args: { patch: Record<string, unknown>; programId?: number; teamId?: number } = {
          patch,
        };
        if (programId !== undefined) args.programId = toId(programId);
        if (teamId !== undefined) args.teamId = toId(teamId);
        return jsonResult(await updateTeamPublishSettings(ctx.client, args));
      }),
  );
}
