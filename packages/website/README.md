# @trainheroic-unofficial/website

Static marketing and documentation site for the TrainHeroic unofficial MCP server and TypeScript SDK.

## Pages

- `/` — Claude.ai connector setup
- `/developers` — skill, SDK, and MCP reference
- `/skill`, `/sdk`, `/mcp` — developer docs

## Develop

From the repo root:

```bash
pnpm website:dev     # http://localhost:4321
pnpm website:build   # output in dist/
```

Or from this package:

```bash
pnpm dev
pnpm build
pnpm preview
```

## Design

Design notes live in `PRODUCT.md` and `DESIGN.md`.

## MCP tool catalog

The `/mcp` tool list is generated from `packages/eval/src/tools.ts` and
`src/data/mcp-tool-catalog.ts`. After adding a core tool, update eval and the catalog, then:

```bash
pnpm gen:mcp-tools
```

`prebuild` and `predev` run this automatically.

## Deploy

CI builds and publishes to GitHub Pages on pushes to `main`
(`.github/workflows/website.yml`). The build uses a relative asset base and
path-relative links so one artifact works on both `trainheroic-unofficial.com`
(custom domain via `public/CNAME`) and
`https://alandotcom.github.io/trainheroic-unofficial/`.

Configure DNS for the custom domain in repository **Settings → Pages**, then
re-run the deploy workflow.
