import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../context";
import { registerAnalyticsTools } from "./analytics";
import { registerAthleteTools } from "./athletes";
import { registerExerciseTools } from "./exercises";
import { registerMainLiftTools } from "./main-lifts";
import { registerMessagingTools } from "./messaging";
import { registerReadTools } from "./reads";
import { registerTeamTools } from "./teams";
import { registerWorkoutTools } from "./workout";

/** Register the full coach tool surface (roster, teams, programs, exercises, messaging). */
export function registerCoachTools(server: McpServer, ctx: ToolContext): void {
  registerReadTools(server, ctx);
  registerMainLiftTools(server, ctx);
  registerAthleteTools(server, ctx);
  registerTeamTools(server, ctx);
  registerAnalyticsTools(server, ctx);
  registerExerciseTools(server, ctx);
  registerWorkoutTools(server, ctx);
  registerMessagingTools(server, ctx);
}
