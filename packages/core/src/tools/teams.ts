import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { confirmGate, NOT_CONFIRMED } from "../confirm";
import { apiCall, attempt, DESTRUCTIVE, errorResult, idParam, toId } from "../context";
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
        "athlete_invite.",
      inputSchema: { title: z.string().min(1) },
      annotations: ADDITIVE,
    },
    ({ title }) =>
      apiCall(ctx, "POST", "/1.0/coach/team/createWithTitleAndCode", { body: { title } }),
  );

  server.registerTool(
    "team_update",
    {
      title: "Rename a team",
      description: "Update a team's settings, e.g. its title (PUT /v5/teams/{teamId}).",
      inputSchema: { teamId: idParam, title: z.string().min(1) },
      annotations: ADDITIVE,
    },
    ({ teamId, title }) => apiCall(ctx, "PUT", `/v5/teams/${toId(teamId)}`, { body: { title } }),
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
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Delete team ${id}? This removes the team and its calendar from the live account.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
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
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Delete team join code ${id}? Athletes can no longer use it to join.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        return apiCall(ctx, "DELETE", `/v5/teamCodes/${id}`);
      }),
  );
}
