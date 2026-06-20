import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RequestOptions } from "@trainheroic-unofficial/js";
import { confirmGate, NOT_CONFIRMED } from "../confirm";
import { apiCall, DESTRUCTIVE, errorResult } from "../context";
import type { ToolContext } from "../context";

/**
 * Escape hatch covering every endpoint without a dedicated tool (e.g. the analytics
 * POSTs). GET is ungated; mutating methods go through the same confirmation gate as
 * the dedicated destructive tools so this cannot be used to bypass it.
 */
export function registerRawTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "th_request",
    {
      title: "Raw TrainHeroic request",
      description:
        "Call any TrainHeroic endpoint directly. `path` is everything after the host. " +
        "`base` selects the host: 'coach' = api.trainheroic.com (default), 'apis' = apis.trainheroic.com. " +
        "Prefer dedicated tools where they exist. POST/PUT/DELETE act on the live account and require confirmation.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "DELETE"]),
        path: z.string().min(1),
        body: z.unknown().optional(),
        base: z.enum(["coach", "apis"]).optional(),
        confirm: z.boolean().optional(),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ method, path, body, base, confirm }, extra) => {
      if (method !== "GET") {
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Run ${method} ${path} against the live TrainHeroic account?`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
      }
      const options: RequestOptions = {};
      if (body !== undefined) options.body = body;
      if (base !== undefined) options.base = base;
      return apiCall(ctx, method, path, options);
    },
  );
}
