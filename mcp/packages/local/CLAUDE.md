# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This package is `@trainheroic-unofficial/coach-mcp`, the local stdio server. For the
workspace dependency graph and shared conventions, read [../../../CLAUDE.md](../../../CLAUDE.md)
first.

## Role

The thin local host for the shared tools. It wires a `ToolContext` from environment
credentials plus a file-backed `ExerciseLibrary` (the `./node` cache from `js`), registers
the `core` tool groups, and connects a stdio transport. It carries no OAuth and no database,
which is the whole point: it is the simplest way to run the tools for one coach. The hosted
counterpart is the `cloudflare` package.

Most behavior comes from `core` and `js`. Keep this package small. New tools belong in
`core` (so the hosted server gets them too), not here; this package only assembles the
context and registers what `core` provides.

## Gotchas

- stdio is the MCP channel. Standard output carries the protocol, so never write logs or
  debug output to stdout. Use stderr.
- Credentials come only from `TRAINHEROIC_EMAIL` and `TRAINHEROIC_PASSWORD`. The session is
  held in memory for the life of the process.
- The exercise cache is a JSON file (`~/.trainheroic/library.json`, or `TRAINHEROIC_CACHE_FILE`).
- This server registers the shared core tools and deliberately omits the D1 warehouse sync
  tools, which depend on storage only the hosted worker has.
- MCPB packaging: `mcpb/manifest.json` + `mcpb/icon.png` are committed; `tsdown.mcpb.config.ts`
  builds a fully self-contained bundle (every dep inlined, no `node_modules`) into
  `mcpb/server/index.mjs` (gitignored), then `mcpb pack` zips it to `dist/*.mcpb`. The
  manifest maps `user_config` email/password onto the same two env vars `server.ts` reads;
  the password is `sensitive` (OS keychain). Do not expose `TRAINHEROIC_CACHE_FILE` as
  `user_config` (a user-set output path is a write primitive).

## Commands

```bash
pnpm start       # tsx src/server.ts (needs the two env vars)
pnpm inspect     # MCP Inspector over stdio (forwards the two env vars via -e)
pnpm build       # tsdown -> dist/server.mjs (the trainheroic-coach-mcp bin)
pnpm build:mcpb  # bundle + pack the Desktop extension -> dist/trainheroic-coach-mcp.mcpb
pnpm typecheck
pnpm test
```
