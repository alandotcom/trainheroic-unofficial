// @ts-check
import { defineConfig } from "astro/config";

// Relative base so asset URLs resolve on both trainheroic-unofficial.com and
// alandotcom.github.io/trainheroic-unofficial/ from one build.
export default defineConfig({
  site: "https://trainheroic-unofficial.com",
  base: "./",
  output: "static",
  build: {
    // Avoid root-absolute /_astro/*.css URLs that break on the github.io subpath.
    inlineStylesheets: "always",
  },
});
