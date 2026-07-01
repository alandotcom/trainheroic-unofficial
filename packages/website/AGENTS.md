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

- **Docs** (`/`, `/developers`, `/skill`, `/sdk`, `/mcp`): [Starlight](https://starlight.astro.build)
  content in `src/content/docs/` (`.md`/`.mdx`). Starlight owns the shell (sidebar, search);
  the site is light-only and themed to DESIGN.md via `src/styles/starlight.css` plus the
  component overrides in `src/components/starlight/` (pinned light theme, brand site title,
  disclaimer footer). Multi-line code snippets live in `src/data/snippets.ts` (MDX strips the
  JSX indentation from inline template literals) and shared names/URLs in `src/data/tools.ts`,
  rendered with Starlight's `Code` component so they stay single-sourced.
- **Bespoke** (`/export`): an interactive `.astro` app in `src/pages/` using `Layout.astro`,
  `Header`/`Footer`, and `src/styles/global.css`. It stays out of Starlight.

Internal links inside docs content are relative (`../sdk/`) so they work on both hosts (root
domain and the GitHub Pages subpath).

## MCP tool catalog

The tool list on `/mcp` is generated from `packages/eval/src/tools.ts` and
`src/data/mcp-tool-catalog.ts`. After adding a core tool, update eval and the catalog, then run:

```bash
pnpm gen:mcp-tools
```

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
