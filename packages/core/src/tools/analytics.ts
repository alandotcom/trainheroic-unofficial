import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { opaqueOutputSchema } from "@trainheroic-unofficial/dto";
import {
  ANALYTICS_METRIC_KEYS,
  analyticsMetricUsesExercise,
  definedProps,
  queryAnalytics,
  supportsLiftAnalytics,
} from "@trainheroic-unofficial/js";
import type { AnalyticsMetric, ExerciseIndex } from "@trainheroic-unofficial/js";
import { attempt, errorResult, idParam, jsonResult, READ, toId } from "../context";
import type { ToolContext } from "../context";

// The analytics metric catalog (keys → endpoint/scope/required inputs) and request-body
// building live in the SDK (`queryAnalytics`), so the MCP tool and the CLI share one source.
// These are read-only data pulls despite the POST verb, so the tool is ungated.

const ANALYTICS_QUERY_DESC =
  "Read a TrainHeroic analytics report. The `metric` enum below IS the catalog — pick from " +
  "it directly (analytics_categories lists the API's raw category names, which do NOT match " +
  "these keys; you rarely need it). Team metrics (readiness-team, compliance-team, " +
  "lift-progress-team) need teamId; athlete metrics (readiness-athlete, " +
  "training-summary-athlete, lift-1rm-history, working-max-history) need userIds — get " +
  "those from list_athletes. userIds takes MANY athletes in ONE call (pass the whole " +
  "roster's ids at once); the report comes back with a row per athlete, so do not loop one " +
  "id per call. For team-wide training volume there is no team summary metric: pass every " +
  "athlete's userId to training-summary-athlete in a single call and the rows cover the " +
  "team. An athlete with no logged sessions in range simply returns no rows (not an error). " +
  "Use that for triage: training-summary-athlete with a single athleteId is the fastest " +
  "'has this athlete trained at all, and when' check — no rows means no logged training in " +
  "range, so don't then fan out blind per-lift athlete_lift_history calls. Despite 'athlete' " +
  "in the name this metric accepts 1–N userIds. " +
  "readiness-team takes a single `date`; every other metric takes dateStart/dateEnd. " +
  "lift-1rm-history, lift-progress-team, and working-max-history also need exerciseId: a " +
  "library exercise recorded as a load lifted for reps, such as Back Squat (id 1). In " +
  "exercise_search results that means units [reps, lb], [reps, %max], or lb in the first " +
  "slot. Bodyweight, timed, distance, and loaded-carry exercises (units such as [ft, lb] or " +
  "[sec, lb]) are rejected, so skip them instead of calling. All dates are YYYY-MM-DD.";

/**
 * Explain why an exercise metric cannot chart `exerciseId`, or return null to let the request
 * proceed. The check reads the exercise's default param types from the library mirror, so a
 * mirrored exercise that TrainHeroic would reject with "Invalid exercise id" is answered here
 * without an upstream call. An id missing from the mirror (a custom exercise created since the
 * last sync, or a wrong id) still goes to TrainHeroic, whose rejection carries its own hint.
 */
async function exerciseMetricProblem(
  index: ExerciseIndex,
  metric: AnalyticsMetric,
  exerciseId: number,
): Promise<string | null> {
  if (!analyticsMetricUsesExercise(metric)) return null;
  const defaults = (await index.defaultsMany([exerciseId])).get(exerciseId);
  if (defaults === undefined || supportsLiftAnalytics(defaults)) return null;
  const exercise = await index.get(exerciseId);
  const title = typeof exercise?.title === "string" ? exercise.title : `Exercise ${exerciseId}`;
  const units = JSON.stringify(exercise?.units ?? []);
  return (
    `${metric} cannot chart "${title}" (id ${exerciseId}, units ${units}). TrainHeroic's ` +
    "exercise analytics only accept a load lifted for reps: units [reps, lb], [reps, %max], " +
    "or lb in the first slot, such as Back Squat (id 1). Skip this exercise or pick a lift."
  );
}

/** Analytics report pulls. Read-only despite the POST verb, so ungated. */
export function registerAnalyticsTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "analytics_query",
    {
      title: "Pull an analytics report",
      description: ANALYTICS_QUERY_DESC,
      inputSchema: {
        metric: z.enum(ANALYTICS_METRIC_KEYS),
        teamId: idParam.optional(),
        userIds: z.array(idParam).optional(),
        exerciseId: idParam.optional(),
        date: z.string().optional(),
        dateStart: z.string().optional(),
        dateEnd: z.string().optional(),
        useMetric: z.boolean().optional(),
      },
      outputSchema: opaqueOutputSchema,
      annotations: READ,
    },
    ({ metric, teamId, userIds, exerciseId, date, dateStart, dateEnd, useMetric }) =>
      attempt(async () => {
        const exercise = exerciseId !== undefined ? toId(exerciseId) : undefined;
        if (exercise !== undefined) {
          const problem = await exerciseMetricProblem(ctx.index, metric, exercise);
          if (problem !== null) return errorResult(problem);
        }
        return jsonResult(
          await queryAnalytics(
            ctx.client,
            definedProps({
              metric,
              teamId: teamId !== undefined ? toId(teamId) : undefined,
              userIds: userIds?.map(toId),
              exerciseId: exercise,
              date,
              dateStart,
              dateEnd,
              useMetric,
            }),
          ),
          { hint: "Narrow with a tighter date range or fewer athletes." },
        );
      }),
  );
}
