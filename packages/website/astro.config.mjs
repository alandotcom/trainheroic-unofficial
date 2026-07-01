// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";

const base = process.env.ASTRO_BASE ?? "/";
const site = process.env.ASTRO_SITE ?? "https://trainheroic-unofficial.com";

const ogImage = new URL(`${base.endsWith("/") ? base : `${base}/`}og-image.png`, site).href;

// https://astro.build/config
export default defineConfig({
  site,
  base,
  output: "static",
  integrations: [
    sitemap(),
    starlight({
      title: "trainheroic unofficial",
      description:
        "Claude Code skill, TypeScript SDK, and MCP reference for TrainHeroic integrations.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/alandotcom/trainheroic-unofficial",
        },
      ],
      sidebar: [
        { label: "Connect to Claude", link: "/" },
        { label: "Developers", slug: "developers" },
        { label: "Claude Code skill", slug: "skill" },
        { label: "TypeScript SDK", slug: "sdk" },
        { label: "MCP reference", slug: "mcp" },
        {
          label: "Export workout history",
          link: "/export",
          attrs: { class: "sidebar-site-link" },
        },
      ],
      customCss: ["./src/styles/starlight.css"],
      pagination: false,
      // Light-only per DESIGN.md; the overrides pin the theme and drop the
      // toggle, and the brand/footer match the bespoke pages.
      components: {
        ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
        SiteTitle: "./src/components/starlight/SiteTitle.astro",
        Footer: "./src/components/starlight/Footer.astro",
      },
      expressiveCode: {
        // Match the bespoke Snippet blocks: GitHub-light, plain bordered
        // block (no terminal frame, no shadow), same metrics as global.css.
        themes: ["github-light"],
        useDarkModeMediaQuery: false,
        defaultProps: { frame: "none" },
        styleOverrides: {
          borderColor: "#e5e5e5",
          borderRadius: "8px",
          borderWidth: "1px",
          codeBackground: "#f6f8fa",
          codeFontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
          codeFontSize: "0.8125rem",
          codeLineHeight: "1.6",
          uiFontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          frames: { shadowColor: "transparent" },
        },
      },
      head: [
        { tag: "meta", attrs: { property: "og:image", content: ogImage } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        {
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary_large_image" },
        },
        { tag: "meta", attrs: { name: "twitter:image", content: ogImage } },
      ],
      favicon: "/favicon.svg",
    }),
  ],
  build: {
    // GitHub Pages project URL needs inlined CSS when ASTRO_BASE is a subpath.
    inlineStylesheets: base !== "/" ? "always" : "auto",
  },
});
