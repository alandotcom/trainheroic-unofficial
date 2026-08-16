import type { McpServer } from "@modelcontextprotocol/server";
import { createProgram, deleteProgram, PROGRAM_KINDS } from "@trainheroic-unofficial/js";
import { z } from "zod";
import { confirmGate } from "../confirm";
import { attempt, DESTRUCTIVE, idParam, jsonResult, toId } from "../context";
import type { ToolContext } from "../context";

const ADDITIVE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

/** Standalone program writes. Program reads live in reads.ts. */
export function registerProgramTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "program_create",
    {
      title: "Create a standalone program",
      description:
        "Create either an ongoing calendar or a fixed-length standalone program " +
        "(POST /1.0/coach/programs/create). Returns both containerId (the id shown by " +
        "list_programs and used by calendar edit/sync reads) and programId (the id used by " +
        "get_program and workout writes). TrainHeroic may generate a different title; inspect " +
        "title and nameApplied. This write is not idempotent, so do not retry an uncertain result.",
      inputSchema: {
        kind: z.enum(PROGRAM_KINDS),
        name: z.string().trim().min(1),
      },
      annotations: ADDITIVE,
    },
    ({ kind, name }) =>
      attempt(async () => jsonResult(await createProgram(ctx.client, { kind, name }))),
  );

  server.registerTool(
    "program_delete",
    {
      title: "Delete a standalone program",
      description:
        "Delete a standalone calendar or fixed program (DELETE /v5/programs/{programId}). " +
        "Accepts either list_programs id (container) or group_program (the underlying program " +
        "id); container ids 401 if sent raw and are resolved automatically. Removes the " +
        "calendar from the live account. Requires confirmation (elicitation, or confirm:true).",
      inputSchema: { programId: idParam, confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ programId, confirm }, extra) =>
      attempt(async () => {
        const id = toId(programId);
        const blocked = confirmGate(
          extra,
          `Delete standalone program ${id}? This removes the calendar from the live account.`,
          confirm,
        );
        if (blocked) return blocked;
        return jsonResult(await deleteProgram(ctx.client, id));
      }),
  );
}
