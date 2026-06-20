import { defineConfig } from "tsdown";

// Bundle the workspace packages (core, js) into the published server so installing it
// pulls only the MCP SDK + zod at runtime, never the Cloudflare deps.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  dts: false,
  clean: true,
  deps: { alwaysBundle: [/^@trainheroic-unofficial\//] },
});
