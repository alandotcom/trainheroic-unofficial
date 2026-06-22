import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { athleteWorkoutRangeArgsSchema, dateString } from "@trainheroic-unofficial/js";
import type { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { attempt, idParam, jsonResult, READ, SYNC, toId } from "@trainheroic-unofficial/core";
import {
  AthleteTrainingStore,
  AthleteWorkoutStore,
  type Warehouse,
} from "@trainheroic-unofficial/db";

/**
 * Athlete training warehouse: download the athlete's historicals into D1 so they can be
 * researched over time without re-hitting the API. One sync verb populates each zone, one
 * query tool reads it. D1-backed, so hosted only. The live core athlete tools remain the
 * default for current data; these are for accumulated history.
 */
function registerWorkoutsZone(server: McpServer, workouts: AthleteWorkoutStore): void {
  server.registerTool(
    "athlete_workouts_sync",
    {
      title: "Sync workout history",
      description:
        "Populate the workouts warehouse: pull workouts in a YYYY-MM-DD window into D1 (each " +
        "workout flattened to exercise rows with both prescribed and logged/performed sets). " +
        "Then read with athlete_workouts_stored.",
      inputSchema: athleteWorkoutRangeArgsSchema.shape,
      annotations: SYNC,
    },
    ({ startDate, endDate }) =>
      attempt(async () => jsonResult(await workouts.sync(startDate, endDate))),
  );

  server.registerTool(
    "athlete_workouts_stored",
    {
      title: "Query workout history",
      description:
        "Query the workouts warehouse (populate it with athlete_workouts_sync first). Give " +
        "workoutId for one workout's flattened exercises (each with prescribed + performed sets); " +
        "omit it to list workouts (optionally bounded by startDate/endDate), each carrying a " +
        "logged flag. For current data live from the API, use athlete_workouts.",
      inputSchema: {
        workoutId: idParam.optional(),
        startDate: dateString.optional(),
        endDate: dateString.optional(),
      },
      annotations: READ,
    },
    ({ workoutId, startDate, endDate }) =>
      attempt(async () => {
        if (workoutId !== undefined) {
          return jsonResult(await workouts.workoutExercises(toId(workoutId)));
        }
        return jsonResult(await workouts.list(startDate, endDate), {
          hint: "Bound with startDate/endDate, or pass workoutId for one workout's exercises.",
        });
      }),
  );
}

function registerTrainingZone(server: McpServer, training: AthleteTrainingStore): void {
  server.registerTool(
    "athlete_training_sync",
    {
      title: "Sync exercise history + PRs",
      description:
        "Populate the training warehouse: the exercise catalog, working maxes, and per-exercise " +
        "session history + PRs. Give exerciseId to sync just one exercise. Omit it to sync the " +
        "catalog + working maxes and drain a batch of un-synced exercises (repeat until remaining " +
        "is 0 — bounded per call to respect subrequest limits). full=true re-pulls every exercise.",
      inputSchema: {
        exerciseId: idParam.optional(),
        batchSize: z.number().int().positive().max(100).optional(),
        full: z.boolean().optional(),
      },
      annotations: SYNC,
    },
    ({ exerciseId, batchSize, full }) =>
      attempt(async () => {
        if (exerciseId !== undefined) {
          return jsonResult(await training.syncExercise(toId(exerciseId)));
        }
        if (full === true) await training.resetSessionsWatermark();
        const catalog = await training.syncCatalog();
        const workingMaxes = await training.syncWorkingMaxes();
        const results = await training.syncNextBatch(batchSize ?? 25);
        const remaining = await training.unsyncedCount();
        return jsonResult({
          catalog,
          workingMaxes,
          exercisesSynced: results.length,
          remaining,
          results,
        });
      }),
  );

  server.registerTool(
    "athlete_training_stored",
    {
      title: "Query exercise history + PRs",
      description:
        "Query the training warehouse (populate it with athlete_training_sync first). " +
        "workingMaxes:true lists working maxes; exerciseId+prs:true gives that exercise's PRs; " +
        "exerciseId alone gives its dated session history; otherwise q searches the exercise catalog.",
      inputSchema: {
        q: z.string().optional(),
        exerciseId: idParam.optional(),
        prs: z.boolean().optional(),
        workingMaxes: z.boolean().optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
      annotations: READ,
    },
    ({ q, exerciseId, prs, workingMaxes, limit }) =>
      attempt(async () => {
        if (workingMaxes === true) return jsonResult(await training.workingMaxes());
        if (exerciseId !== undefined && prs === true) {
          return jsonResult(await training.prs(toId(exerciseId)));
        }
        if (exerciseId !== undefined) {
          return jsonResult(await training.sessions(toId(exerciseId), limit ?? 100));
        }
        return jsonResult(await training.searchCatalog(q, limit ?? 50), {
          hint: "Pass q to search the catalog, exerciseId for its sessions, or workingMaxes:true.",
        });
      }),
  );
}

/** Athlete warehouse sync + query tools (D1-backed, hosted only). */
export function registerAthleteSyncTools(
  server: McpServer,
  warehouse: Warehouse,
  client: TrainHeroicClient,
  userId: number | null = null,
): void {
  registerWorkoutsZone(server, new AthleteWorkoutStore(warehouse, client, userId));
  registerTrainingZone(server, new AthleteTrainingStore(warehouse, client, userId));
}
