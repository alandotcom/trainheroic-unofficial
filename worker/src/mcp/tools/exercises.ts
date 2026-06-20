import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ExerciseStore } from "../../store/exercises";
import { attempt, errorResult, idParam, jsonResult, READ, SYNC, toId } from "../context";
import type { ToolContext } from "../context";

/** Exercise library tools backed by the D1 reference-zone mirror. */
export function registerExerciseTools(server: McpServer, ctx: ToolContext): void {
  const store = new ExerciseStore(ctx.db, ctx.client);

  server.registerTool(
    "exercise_resolve",
    {
      title: "Resolve exercise name",
      description:
        "Map a name to an exercise id via the local mirror. Returns the match plus ranked " +
        "candidates; when ambiguous, match is null and you should pick from candidates. " +
        "Units (param_1_unit/param_2_unit) are fixed per exercise — check them before prescribing.",
      inputSchema: { name: z.string().min(1) },
      annotations: READ,
    },
    ({ name }) => attempt(async () => jsonResult(await store.resolve(name))),
  );

  server.registerTool(
    "exercise_search",
    {
      title: "Search exercises",
      description: "Ranked fuzzy search over exercise titles. Returns candidates with units.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional(),
      },
      annotations: READ,
    },
    ({ query, limit }) => attempt(async () => jsonResult(await store.search(query, limit ?? 20))),
  );

  server.registerTool(
    "exercise_get",
    {
      title: "Get exercise",
      description: "Full exercise object (with units) by id.",
      inputSchema: { id: idParam },
      annotations: READ,
    },
    ({ id }) =>
      attempt(async () => {
        const ex = await store.get(toId(id));
        return ex ? jsonResult(ex) : errorResult(`No exercise with id ${toId(id)}.`);
      }),
  );

  server.registerTool(
    "exercise_sync",
    {
      title: "Sync exercise library",
      description: "Refresh the local exercise mirror from TrainHeroic (prune-to-match).",
      inputSchema: { force: z.boolean().optional() },
      annotations: SYNC,
    },
    ({ force }) =>
      attempt(async () => {
        if (force ?? false) return jsonResult(await store.refresh());
        await store.ensureFresh();
        return jsonResult(await store.stats());
      }),
  );

  server.registerTool(
    "exercise_create",
    {
      title: "Create custom exercise",
      description:
        "Create a custom exercise (POST /2.0/coach/exercise/create) and write it through to the " +
        'mirror. Body example: {"title":"Sandbag Clean","param_1_type":3,"param_2_type":1}.',
      inputSchema: { exercise: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ exercise }) => attempt(async () => jsonResult(await store.create(exercise))),
  );

  server.registerTool(
    "exercise_forget",
    {
      title: "Forget exercise (cache only)",
      description:
        "Remove an exercise from the local mirror only. Run after deleting it via the API.",
      inputSchema: { id: idParam },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id }) =>
      attempt(async () => {
        await store.recordDelete(toId(id));
        return jsonResult({ forgotten: toId(id) });
      }),
  );

  server.registerTool(
    "store_stats",
    {
      title: "Local store stats",
      description: "Row counts and sync watermarks for the local D1 store.",
      inputSchema: {},
      annotations: READ,
    },
    () => attempt(async () => jsonResult(await store.stats())),
  );
}
