import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchAthleteMainLiftPRs, fetchRosterMainLiftPRs } from "@trainheroic-unofficial/js";
import { type ToolContext, READ, attempt, idParam, jsonResult, toId } from "../context";

const monthsParam = z.number().int().positive().max(36).optional();

const ATHLETE_DESC =
  "A roster athlete's personal records for the main barbell lifts (squat, bench press, deadlift, " +
  "overhead press, clean & jerk, snatch). Pass athleteId from list_athletes — nothing else. It " +
  "auto-discovers which exercise VARIANT the athlete actually logs for each lift (e.g. 'Back " +
  "Squat', not the empty 'Squat' library entry) by scanning their recent training, so you do NOT " +
  "resolve exercise ids yourself. Returns one row per lift family in a fixed order; a lift the " +
  "athlete has not logged comes back with null fields (no PR yet). `months` (default 12) is how " +
  "far back to look for the logged variants.";

const ROSTER_DESC =
  "Every roster athlete's main-lift PRs in one call — the squad board for squat/bench/deadlift/" +
  "overhead press/clean & jerk/snatch. Same per-athlete discovery as athlete_main_lift_prs, fanned " +
  "out across the roster (bounded), so it makes many upstream calls; expect a few seconds on a big " +
  "roster. Optional athleteIds restricts it to a subset (else the whole roster from /v5/athletes); " +
  "`months` (default 12) sets the look-back for logged variants.";

/** Coach main-lift PR reads: one athlete, or the whole roster at once. */
export function registerMainLiftTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "athlete_main_lift_prs",
    {
      title: "Athlete main-lift PRs (roster)",
      description: ATHLETE_DESC,
      inputSchema: { athleteId: idParam, months: monthsParam },
      annotations: READ,
    },
    ({ athleteId, months }) =>
      attempt(async () =>
        jsonResult(
          await fetchAthleteMainLiftPRs(
            ctx.client,
            toId(athleteId),
            months !== undefined ? { months } : {},
          ),
        ),
      ),
  );

  server.registerTool(
    "roster_main_lift_prs",
    {
      title: "Roster main-lift PRs",
      description: ROSTER_DESC,
      inputSchema: { months: monthsParam, athleteIds: z.array(idParam).optional() },
      annotations: READ,
    },
    ({ months, athleteIds }) =>
      attempt(async () => {
        const board = await fetchRosterMainLiftPRs(ctx.client, {
          ...(athleteIds ? { athleteIds: athleteIds.map(toId) } : {}),
          ...(months !== undefined ? { months } : {}),
        });
        return jsonResult(board, {
          hint: "Pass athleteIds to scope to a few athletes, or lower months, to shrink this.",
        });
      }),
  );
}
