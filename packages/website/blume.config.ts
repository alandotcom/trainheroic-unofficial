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
  // Self-host Archivo via Fontsource so docs match the marketing surface and the build
  // does not fetch Blume's default Inter Tight from Google Fonts (404 under Astro 7.2.2).
  theme: {
    fonts: {
      display: { name: "Archivo", provider: "fontsource", weights: ["100..900"] },
      body: { name: "Archivo", provider: "fontsource", weights: ["100..900"] },
      mono: "ibm-plex-mono",
    },
  },
  github: {
    owner: "alandotcom",
    repo: "trainheroic-unofficial",
    dir: "packages/website",
  },
  navigation: { repo: false },
});
