import { defineConfig } from "tsdown";

// Fully self-contained bundle for the MCPB desktop extension. Unlike tsdown.config.ts
// (which leaves the MCP SDK + zod external for npm consumers), this bundles every runtime
// dependency so the packed bundle needs no node_modules. Claude Desktop supplies the Node
// runtime for a `type: node` MCPB, so we ship JS only. Output: mcpb/server/index.mjs.
export default defineConfig({
  entry: { index: "src/server.ts" },
  format: ["esm"],
  platform: "node",
  dts: false,
  clean: true,
  outDir: "mcpb/server",
  deps: { alwaysBundle: [/.*/] },
});
