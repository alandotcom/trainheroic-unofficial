import { defineConfig } from "tsdown";

// Bundle the workspace SDK into the published CLI so installing it pulls no other
// @trainheroic-unofficial packages and never the Cloudflare deps.
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  dts: false,
  clean: true,
  deps: { alwaysBundle: [/^@trainheroic-unofficial\//] },
});
