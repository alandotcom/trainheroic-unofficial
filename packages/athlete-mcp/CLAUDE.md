# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This package is `@trainheroic-unofficial/athlete-mcp`, the local stdio server for an athlete
account. For the workspace dependency graph and shared conventions, read
[../../CLAUDE.md](../../CLAUDE.md) first.

## Role

The thin local host for the athlete tools. It wires a client from environment credentials and
registers `registerAthleteTrainingTools` from `core`, then connects a stdio transport. Unlike
`coach-mcp` it builds no `ExerciseLibrary`/`ExerciseIndex`: the athlete tools read the
logged-in user's own training and need only the client, so the context is just `{ client }`.

Most behavior comes from `core` and `js`. Keep this package small. New athlete tools belong in
`core` (`registerAthleteTrainingTools`, so the hosted worker gets them too), not here.

## Gotchas

- stdio is the MCP channel. Standard output carries the protocol, so never write logs or
  debug output to stdout. Use stderr.
- Credentials come only from `TRAINHEROIC_EMAIL` and `TRAINHEROIC_PASSWORD` (the athlete's own
  account). The session is held in memory for the life of the process.
- No database and no exercise cache: the athlete warehouse (downloading historicals) is a
  hosted-only D1 feature in the `cloudflare` package. For a local dump, the CLI's
  `trainheroic athlete export` writes historicals to JSON.
- `registerAthleteTools` (in `core`, the coach roster's `list_athletes`) is a different
  function from `registerAthleteTrainingTools` (this server's tools). Do not confuse them.

## Commands

```bash
pnpm start       # tsx src/server.ts (needs the two env vars)
pnpm inspect     # MCP Inspector over stdio (forwards the two env vars via -e)
pnpm build       # tsdown -> dist/server.mjs (the trainheroic-athlete-mcp bin)
pnpm typecheck
pnpm test
```
