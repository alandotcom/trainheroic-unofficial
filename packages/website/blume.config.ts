import { defineConfig } from "blume";

const base = process.env.ASTRO_BASE;
const site = process.env.ASTRO_SITE ?? "https://trainheroic-unofficial.com";

export default defineConfig({
  title: "trainheroic unofficial",
  description: "One unofficial toolkit for using TrainHeroic with AI, code, and your own data.",
  content: {
    root: "src/content/docs",
    pages: "src/pages",
  },
  deployment: {
    output: "static",
    site,
    ...(base ? { base } : {}),
  },
  github: {
    owner: "alandotcom",
    repo: "trainheroic-unofficial",
    dir: "packages/website",
  },
  navigation: { repo: false },
});
