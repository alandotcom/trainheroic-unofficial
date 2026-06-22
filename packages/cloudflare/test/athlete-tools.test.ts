import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAthleteTrainingTools } from "@trainheroic-unofficial/core";
import { makeD1Warehouse } from "@trainheroic-unofficial/db/d1";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { registerAthleteSyncTools } from "../src/tools/athlete-sync";

/** Capture registered tool names without standing up a transport. */
function recordingServer(): { server: McpServer; names: string[] } {
  const names: string[] = [];
  const server = {
    registerTool: (name: string) => {
      names.push(name);
      return {};
    },
  } as unknown as McpServer;
  return { server, names };
}

const client = (): TrainHeroicClient => new TrainHeroicClient("a@b.com", "pw");

describe("athlete tool registration (role-aware surface)", () => {
  it("registerAthleteTrainingTools exposes the live athlete tools, not coach tools", () => {
    const { server, names } = recordingServer();
    registerAthleteTrainingTools(server, { client: client() });
    expect(names).toEqual(
      expect.arrayContaining([
        "athlete_whoami",
        "athlete_profile",
        "athlete_workouts",
        "athlete_exercise_history",
        "athlete_working_maxes",
        "athlete_log_set",
      ]),
    );
    // No coaching tools leak into the athlete surface.
    expect(names).not.toContain("list_athletes");
    expect(names).not.toContain("workout_publish");
  });

  it("registerAthleteSyncTools exposes the warehouse sync/stored pairs", () => {
    const { server, names } = recordingServer();
    registerAthleteSyncTools(server, makeD1Warehouse(env.TH_DB), client(), 42);
    expect(names).toEqual(
      expect.arrayContaining([
        "athlete_workouts_sync",
        "athlete_workouts_stored",
        "athlete_training_sync",
        "athlete_training_stored",
      ]),
    );
  });
});
