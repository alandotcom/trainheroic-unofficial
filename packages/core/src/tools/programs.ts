import type { McpServer } from "@modelcontextprotocol/server";
import { createProgram, PROGRAM_KINDS } from "@trainheroic-unofficial/js";
import { z } from "zod";
import { attempt, jsonResult } from "../context";
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
}
