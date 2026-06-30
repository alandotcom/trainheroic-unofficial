# @trainheroic-unofficial/website

Static marketing and documentation site for the TrainHeroic unofficial MCP server and TypeScript SDK.

## Pages

- `/` — overview and quick links
- `/mcp` — hosted and local MCP setup, full tool catalog
- `/sdk` — SDK install, quickstart, and API surface

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

This site uses [Impeccable](https://impeccable.style/) for design context and anti-pattern checks.

```bash
pnpm detect          # from this package
npx impeccable init  # in Cursor, after install — refreshes PRODUCT.md / DESIGN.md
```

Design context lives in `PRODUCT.md` and `DESIGN.md`. Impeccable skills install to `.cursor/`, `.claude/`, and `.github/` at the repo root via `npx impeccable install`.

## Deploy

CI builds and publishes to GitHub Pages on pushes to `main` (`.github/workflows/website.yml`). Set the custom domain to `trainheroic-unofficial.com` in repository Pages settings when ready.
