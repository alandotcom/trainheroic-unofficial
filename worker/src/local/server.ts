import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";
import type { ToolContext } from "../mcp/context";
import { registerExerciseTools } from "../mcp/tools/exercises";
import { registerMessagingTools } from "../mcp/tools/messaging";
import { registerRawTools } from "../mcp/tools/raw";
import { registerReadTools } from "../mcp/tools/reads";
import { registerWorkoutTools } from "../mcp/tools/workout";
import { TrainHeroicClient } from "../trainheroic/client";
import { InMemoryExerciseIndex } from "./exercise-index";

// Single-user local MCP server over stdio. No OAuth and no database: credentials come
// from the environment and the exercise library is cached in memory. Launch it from an
// MCP client (command + args + env). The hosted Cloudflare path lives in src/index.ts.
async function main(): Promise<void> {
  const email = process.env.TRAINHEROIC_EMAIL;
  const password = process.env.TRAINHEROIC_PASSWORD;
  if (!email || !password) {
    process.stderr.write("Set TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD in the environment.\n");
    process.exit(1);
  }

  const client = new TrainHeroicClient(email, password);
  const ctx: ToolContext = { client, index: new InMemoryExerciseIndex(client) };

  const server = new McpServer({ name: "trainheroic-local", version: "0.1.0" });
  registerReadTools(server, ctx);
  registerRawTools(server, ctx);
  registerExerciseTools(server, ctx);
  registerWorkoutTools(server, ctx);
  registerMessagingTools(server, ctx);

  await server.connect(new StdioServerTransport());
}

await main();
