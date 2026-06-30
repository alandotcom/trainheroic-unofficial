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
