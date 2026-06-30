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

## Deploy

CI builds and publishes to GitHub Pages on pushes to `main` (`.github/workflows/website.yml`). Set the custom domain to `trainheroic-unofficial.com` in repository Pages settings when ready.
