// @ts-check
import { defineConfig } from "astro/config";

const base = process.env.ASTRO_BASE ?? "/";
const site = process.env.ASTRO_SITE ?? "https://trainheroic-unofficial.com";

// https://astro.build/config
export default defineConfig({
  site,
  base,
  output: "static",
});
