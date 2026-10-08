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
    site,
    ...(base ? { base } : {}),
  },
  // The docs shell carries the DESIGN.md tokens: Lane Cobalt as the only accent, Warm Paper
  // (with a warm near-black in dark mode) as the background, and square corners on cards,
  // callouts, tabs, and code blocks. `theme.css` sets the remaining surface, text, and rule
  // tokens. Archivo is self-hosted through Fontsource so docs match the custom pages and the
  // build does not fetch Blume's default font from Google Fonts.
  theme: {
    accent: { light: "#2457d6", dark: "#8aa8ff" },
    background: { light: "#f3f1e9", dark: "#141412" },
    radius: "none",
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
  // The "Was this page helpful?" rating reports through analytics adapters, and this site
  // configures none, so a reader's answer would be recorded nowhere.
  feedback: false,
});
