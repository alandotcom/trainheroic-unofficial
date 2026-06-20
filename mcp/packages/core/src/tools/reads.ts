import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiCall, idParam, READ } from "../context";
import type { ToolContext } from "../context";

function enc(value: string | number): string {
  return encodeURIComponent(String(value));
}

/** No-argument GET endpoints, registered from a table to keep the wiring compact. */
const SIMPLE_GETS: ReadonlyArray<{
  name: string;
  title: string;
  description: string;
  path: string;
}> = [
  {
    name: "whoami",
    title: "Who am I",
    description:
      "The authenticated TrainHeroic coach profile (id, org_id, name, roles, trial days).",
    path: "/user/simple",
  },
  {
    name: "head_coach",
    title: "Head coach / org",
    description: "Org, license, and trial status for the head coach account.",
    path: "/v5/headCoach",
  },
  {
    name: "list_athletes",
    title: "List athletes",
    description: "All athletes visible to this coach.",
    path: "/v5/athletes",
  },
  {
    name: "list_programs",
    title: "List programs",
    description: "Coach programs (standalone). Team group-programs come from list_teams.",
    path: "/1.0/coach/programs",
  },
  {
    name: "notifications",
    title: "Notification counts",
    description: "Unread counts including countMessagingNotViewed (cheap 'anything new?' poll).",
    path: "/v5/notifications/counts",
  },
  {
    name: "analytics_categories",
    title: "Analytics categories",
    description:
      "Lists available analytics types. Pull the data via th_request POST /v5/analytics/*.",
    path: "/v5/analytics",
  },
];

/** Read-only coach/athlete queries. Exercise lookups live in the exercise store tools. */
export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  for (const t of SIMPLE_GETS) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: {}, annotations: READ },
      () => apiCall(ctx, "GET", t.path),
    );
  }

  server.registerTool(
    "list_teams",
    {
      title: "List teams",
      description: "Coach teams. Optional pagination and search.",
      inputSchema: {
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().optional(),
        q: z.string().optional(),
      },
      annotations: READ,
    },
    ({ page, pageSize, q }) => {
      const qs = new URLSearchParams();
      if (page !== undefined) qs.set("page", String(page));
      if (pageSize !== undefined) qs.set("pageSize", String(pageSize));
      if (q !== undefined) qs.set("q", q);
      const query = qs.toString();
      return apiCall(ctx, "GET", `/1.0/coach/teams${query ? `?${query}` : ""}`);
    },
  );

  server.registerTool(
    "get_team",
    {
      title: "Get team",
      description: "Full team object by team id.",
      inputSchema: { teamId: idParam },
      annotations: READ,
    },
    ({ teamId }) => apiCall(ctx, "GET", `/v5/teams/${enc(teamId)}`),
  );

  server.registerTool(
    "list_team_codes",
    {
      title: "List team access codes",
      description: "Join/access codes for a team.",
      inputSchema: { teamId: idParam },
      annotations: READ,
    },
    ({ teamId }) => apiCall(ctx, "GET", `/v5/teams/${enc(teamId)}/teamCodes`),
  );

  server.registerTool(
    "get_program",
    {
      title: "Get program detail",
      description:
        "Full nested program structure (blocks + sessions) live from the API, by program id.",
      inputSchema: { programId: idParam },
      annotations: READ,
    },
    ({ programId }) => apiCall(ctx, "GET", `/3.0/coach/program/${enc(programId)}`),
  );
}
