## Development

From the repo root:

```bash
pnpm website:dev     # http://localhost:4321
```

Or from this package:

```bash
pnpm dev
pnpm build
pnpm preview
```

## Structure

Two kinds of pages:

- **Docs** (`/`, `/capabilities`, `/privacy`, `/developers/**`): [Blume](https://useblume.dev)
  content in `src/content/docs/` (`.mdx`). `blume.config.ts` owns the shell, navigation, search,
  SEO, AI-readable output, and custom-page mount. Navigation follows the filesystem: root pages
  serve connector users, while `developers/` contains the skill, CLI, SDK, and MCP sections.
  Use Blume's built-in Markdown and MDX components directly; prefer plain content over local
  component wrappers.
- **Bespoke** (`/export`): an interactive `.astro` app in `src/pages/` using `Layout.astro`,
  `Header`/`Footer`, and `src/styles/global.css`. Blume mounts it as a custom page.

Blume rewrites internal links for both hosts (root domain and the GitHub Pages subpath).

## MCP tool catalog

The tool list on `/developers/mcp/tools` is generated from `packages/eval/src/tools.ts` and
`src/data/mcp-tool-catalog.ts`. After adding a core tool, update eval and the catalog, then run:

```bash
pnpm gen:mcp-tools
```

This writes `src/content/docs/developers/mcp/02-tools.mdx`; do not edit that page by hand.

## Documentation

Blume documentation: https://useblume.dev/docs

Astro documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
