# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This package is `@trainheroic-unofficial/cli`. For the workspace dependency graph and shared
conventions, read [../../../CLAUDE.md](../../../CLAUDE.md) first.

## Role

A shell-facing front end over the `js` SDK. It parses argv with `node:util` `parseArgs`,
dispatches to a command handler, calls the SDK, and prints JSON. There is no MCP layer here;
this is the scripting path. It depends on `js` for behavior and `dto` for the input schemas
it validates against.

`src/cli.ts` holds the help text, the dispatch, and the handlers. `src/parse.ts` has small
input helpers (date parsing, the inline-JSON-versus-path heuristic). `src/session-cache.ts`
persists the TrainHeroic session under `~/.trainheroic/` so repeated invocations reuse a
login.

## Conventions to keep

- Machine-readable output. Stdout is JSON only; send errors and diagnostics to stderr and
  exit non-zero on failure. Do not interleave human prose into stdout.
- Confirm destructive work with `--yes`. Anything athlete-facing or deleting (publish,
  remove, forget, send, delete, and `build --publish`) must require the flag rather than
  acting on intent alone.
- Validate input with the `dto` schemas before sending it, and surface the validation path
  and message on failure.
- Reuse the shared caches. The exercise library cache matches the local server's shape (both
  under `~/.trainheroic/`); keep them compatible. Session caching belongs in
  `session-cache.ts`.
- Keep domain logic in `js`. The CLI should stay a thin adapter; if a command needs new API
  behavior, add it to the SDK and call it here.

## Commands

```bash
pnpm start <args>   # tsx src/cli.ts
pnpm build          # tsdown -> dist/cli.mjs (the trainheroic bin)
pnpm typecheck
pnpm test
pnpm exec vitest run test/parse.test.ts
```
