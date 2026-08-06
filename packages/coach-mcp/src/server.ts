import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import process from "node:process";
import type { ToolContext } from "@trainheroic-unofficial/core";
import { registerCoachTools, SERVER_INSTRUCTIONS } from "@trainheroic-unofficial/core";
import { ExerciseLibrary, TrainHeroicClient } from "@trainheroic-unofficial/js";
import { JsonFileLibraryCache } from "@trainheroic-unofficial/js/node";
import pkg from "../package.json" with { type: "json" };

// Single-user local MCP server over stdio. No OAuth and no database: credentials come
// from the environment and the exercise library is cached on disk (JSON). Launch it from
// an MCP client (command + args + env). The hosted Cloudflare path lives in cloudflare/.
function main(): void {
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

  serveStdio(() => {
    const server = new McpServer(
      { name: "trainheroic-local", version: pkg.version },
      { instructions: SERVER_INSTRUCTIONS },
    );
    registerCoachTools(server, ctx);
    return server;
  });
}

main();
