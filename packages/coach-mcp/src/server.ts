import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";
import type { ToolContext } from "@trainheroic-unofficial/core";
import { registerAnalyticsTools } from "@trainheroic-unofficial/core";
import { registerAthleteTools } from "@trainheroic-unofficial/core";
import { registerExerciseTools } from "@trainheroic-unofficial/core";
import { registerMainLiftTools } from "@trainheroic-unofficial/core";
import { registerMessagingTools } from "@trainheroic-unofficial/core";
import { registerReadTools } from "@trainheroic-unofficial/core";
import { registerTeamTools } from "@trainheroic-unofficial/core";
import { SERVER_INSTRUCTIONS } from "@trainheroic-unofficial/core";
import { registerWorkoutTools } from "@trainheroic-unofficial/core";
import { ExerciseLibrary, TrainHeroicClient } from "@trainheroic-unofficial/js";
import { JsonFileLibraryCache } from "@trainheroic-unofficial/js/node";
import pkg from "../package.json" with { type: "json" };

// Single-user local MCP server over stdio. No OAuth and no database: credentials come
// from the environment and the exercise library is cached on disk (JSON). Launch it from
// an MCP client (command + args + env). The hosted Cloudflare path lives in cloudflare/.
async function main(): Promise<void> {
  const email = process.env.TRAINHEROIC_EMAIL;
  const password = process.env.TRAINHEROIC_PASSWORD;
  if (!email || !password) {
    process.stderr.write("Set TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD in the environment.\n");
    process.exit(1);
  }

  const client = new TrainHeroicClient(email, password);
  const ctx: ToolContext = {
    client,
    index: new ExerciseLibrary(client, new JsonFileLibraryCache()),
  };

  const server = new McpServer(
    { name: "trainheroic-local", version: pkg.version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerReadTools(server, ctx);
  registerMainLiftTools(server, ctx);
  registerAthleteTools(server, ctx);
  registerTeamTools(server, ctx);
  registerAnalyticsTools(server, ctx);
  registerExerciseTools(server, ctx);
  registerWorkoutTools(server, ctx);
  registerMessagingTools(server, ctx);

  await server.connect(new StdioServerTransport());
}

await main();
