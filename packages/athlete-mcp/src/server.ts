import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";
import { registerAthleteTrainingTools } from "@trainheroic-unofficial/core";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";

// Single-user local MCP server over stdio for a TrainHeroic ATHLETE account. No OAuth, no
// database, no exercise-library index: the athlete tools read the logged-in user's own
// training (history, workouts, PRs, working maxes) and so need only the client. Credentials
// come from the environment. The hosted Cloudflare path lives in cloudflare/; the coach
// counterpart is coach-mcp/.
async function main(): Promise<void> {
  const email = process.env.TRAINHEROIC_EMAIL;
  const password = process.env.TRAINHEROIC_PASSWORD;
  if (!email || !password) {
    process.stderr.write("Set TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD in the environment.\n");
    process.exit(1);
  }

  const client = new TrainHeroicClient(email, password);

  const server = new McpServer({ name: "trainheroic-athlete", version: "0.1.0" });
  registerAthleteTrainingTools(server, { client });

  await server.connect(new StdioServerTransport());
}

await main();
