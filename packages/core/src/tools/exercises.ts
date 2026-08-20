import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  exerciseCreateSchema,
  exerciseCreatedOutputSchema,
  exerciseDeletedOutputSchema,
  exerciseForgottenOutputSchema,
  exerciseGetOutputSchema,
  exerciseResolveOutputSchema,
  exerciseViewSchema,
  opaqueOutputSchema,
  toolOutputSchema,
} from "@trainheroic-unofficial/dto";
import { confirmGate } from "../confirm";
import {
  ADDITIVE,
  attempt,
  DESTRUCTIVE,
  errorResult,
  idParam,
  jsonResult,
  READ,
  SYNC,
  toId,
} from "../context";
import type { ToolContext } from "../context";

function registerExerciseUpdate(server: McpServer, index: ToolContext["index"]): void {
  server.registerTool(
    "exercise_update",
    {
      title: "Update custom exercise",
      description:
        "Update a custom exercise (POST /2.0/coach/exercise/update/{id}) and write it through " +
        "to the mirror. Same body as exercise_create. Only works for exercises with can_edit:1.",
      inputSchema: { id: idParam, exercise: exerciseCreateSchema },
      outputSchema: toolOutputSchema(exerciseCreatedOutputSchema),
      annotations: ADDITIVE,
    },
    ({ id, exercise }) =>
      attempt(async () =>
        jsonResult(await index.update(toId(id), exercise as Record<string, unknown>)),
      ),
  );
}

function registerExerciseDelete(server: McpServer, index: ToolContext["index"]): void {
  server.registerTool(
    "exercise_delete",
    {
      title: "Delete custom exercise",
      description:
        "Delete a custom exercise on TrainHeroic (DELETE /v5/exercises/{id}) and drop it from " +
        "the local mirror. Only works for exercises with can_edit:1. Built-in library exercises " +
        "cannot be deleted. Requires confirmation (elicitation, or confirm:true). " +
        "exercise_forget only clears the cache — use this to delete the live exercise.",
      inputSchema: { id: idParam, confirm: z.boolean().optional() },
      outputSchema: toolOutputSchema(exerciseDeletedOutputSchema),
      annotations: DESTRUCTIVE,
    },
    ({ id, confirm }, extra) =>
      attempt(async () => {
        const exerciseId = toId(id);
        const blocked = confirmGate(
          extra,
          `Delete custom exercise ${exerciseId} from the live TrainHeroic library?`,
          confirm,
        );
        if (blocked) return blocked;
        await index.remove(exerciseId);
        return jsonResult({ deleted: exerciseId });
      }),
  );
}

function registerExerciseReads(server: McpServer, index: ToolContext["index"]): void {
  server.registerTool(
    "exercise_resolve",
    {
      title: "Resolve exercise name",
      description:
        "Map a name to an exercise id via the local mirror. Prefer this over exercise_search when " +
        "you want a single authoritative id for a known name. Returns the match plus ranked " +
        "candidates; when ambiguous, match is null and you should pick from candidates. " +
        "Each result's `units` array lists the fixed measurement units by entry slot; they " +
        "are fixed per exercise — check them before prescribing. `can_edit` is 1 only for the " +
        "coach's own custom exercises and 0 for built-in library exercises.",
      inputSchema: { name: z.string().min(1) },
      outputSchema: toolOutputSchema(exerciseResolveOutputSchema),
      annotations: READ,
    },
    ({ name }) => attempt(async () => jsonResult(await index.resolve(name))),
  );

  server.registerTool(
    "exercise_search",
    {
      title: "Search exercises",
      description:
        "Ranked fuzzy search over exercise titles. Returns candidates with units. Each result's " +
        "`can_edit` flag marks ownership: 1 = the coach's own custom exercise, 0 = a built-in " +
        "library exercise — filter on it to answer 'do I have a custom exercise for X'. When you " +
        "want one definitive id for a known name, use exercise_resolve instead.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional(),
      },
      outputSchema: toolOutputSchema(z.array(exerciseViewSchema)),
      annotations: READ,
    },
    ({ query, limit }) => attempt(async () => jsonResult(await index.search(query, limit ?? 20))),
  );

  server.registerTool(
    "exercise_get",
    {
      title: "Get exercise",
      description: "Full exercise object (with units) by id.",
      inputSchema: { id: idParam },
      outputSchema: toolOutputSchema(exerciseGetOutputSchema),
      annotations: READ,
    },
    ({ id }) =>
      attempt(async () => {
        const ex = await index.get(toId(id));
        return ex ? jsonResult(ex) : errorResult(`No exercise with id ${toId(id)}.`);
      }),
  );

  server.registerTool(
    "exercise_sync",
    {
      title: "Sync exercise library",
      description: "Refresh the cached exercise index from TrainHeroic.",
      inputSchema: { force: z.boolean().optional() },
      outputSchema: opaqueOutputSchema,
      annotations: SYNC,
    },
    ({ force }) =>
      attempt(async () => {
        if (force ?? false) return jsonResult(await index.refresh());
        await index.ensureFresh();
        return jsonResult(await index.stats());
      }),
  );
}

/**
 * Exercise library tools over the ExerciseIndex — a D1 mirror on the hosted server, an
 * on-disk/in-memory cache locally. The descriptions stay at the interface level so they
 * read correctly on both backends.
 */
export function registerExerciseTools(server: McpServer, ctx: ToolContext): void {
  const index = ctx.index;
  registerExerciseReads(server, index);

  server.registerTool(
    "exercise_create",
    {
      title: "Create custom exercise",
      description:
        "Create a custom exercise (POST /2.0/coach/exercise/create) and write it through to the " +
        'mirror. Body example: {"title":"Sandbag Clean","param_1_type":3,"param_2_type":1}.',
      inputSchema: { exercise: exerciseCreateSchema },
      outputSchema: toolOutputSchema(exerciseCreatedOutputSchema),
      annotations: ADDITIVE,
    },
    ({ exercise }) =>
      attempt(async () => jsonResult(await index.create(exercise as Record<string, unknown>))),
  );

  registerExerciseUpdate(server, index);
  registerExerciseDelete(server, index);

  server.registerTool(
    "exercise_forget",
    {
      title: "Forget exercise (cache only)",
      description:
        "Remove an exercise from the local mirror only. Does not call TrainHeroic — use " +
        "exercise_delete to delete the live custom exercise.",
      inputSchema: { id: idParam },
      outputSchema: toolOutputSchema(exerciseForgottenOutputSchema),
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    ({ id }) =>
      attempt(async () => {
        await index.recordDelete(toId(id));
        return jsonResult({ forgotten: toId(id) });
      }),
  );

  server.registerTool(
    "store_stats",
    {
      title: "Exercise index stats",
      description: "Row counts and sync state for the cached exercise index.",
      inputSchema: {},
      outputSchema: opaqueOutputSchema,
      annotations: READ,
    },
    () => attempt(async () => jsonResult(await index.stats())),
  );
}
