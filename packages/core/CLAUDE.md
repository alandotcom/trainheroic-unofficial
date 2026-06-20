# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This package is `@trainheroic-unofficial/core`, the shared MCP tool layer. For the workspace
dependency graph and shared conventions, read [../../CLAUDE.md](../../CLAUDE.md) first.

## Role

One definition of every MCP tool, consumed by both servers. The local server and the
Cloudflare worker each build a `ToolContext` and call the `registerXxxTools` functions, so a
tool added here appears in both transports at once. This package depends on `js` for the
client and the `ExerciseIndex` interface, and on `dto` for shapes. It must not depend on any
storage backend or transport.

## How tools are written

`src/context.ts` holds the shared machinery, and the tool modules under `src/tools/` each
export a `registerXxxTools(server, ctx)` function.

- `ToolContext` is `{ client, index }`. Handlers read everything they need from it.
- Return results through the helpers, not by throwing: `jsonResult` for success,
  `errorResult` for an in-band failure the model can self-correct on, `apiCall` for a
  straight TrainHeroic request, and `attempt` to wrap a handler body so a thrown error
  becomes an error result.
- `jsonResult` and `apiCall` are size-bounded (`boundedSerialize` + `resultBudget`): an
  oversized result is trimmed and labeled with a `__truncated` marker so it cannot exceed the
  host's tool-result cap. Pass a `hint` (the optional last arg to `apiCall`, or `{ hint }` to
  `jsonResult`) telling the model how to narrow a large result. `DEFAULT_RESULT_BUDGET` is
  overridable via `TH_MCP_RESULT_BUDGET`.
- Annotate honestly with the `READ` / `SYNC` / `DESTRUCTIVE` presets. These are advisory
  hints to the client and are not the enforcement mechanism.
- Gate every destructive or athlete-facing action with `confirmGate` from `src/confirm.ts`.
  It prefers MCP elicitation, accepts an explicit `confirm: true` argument when the client
  cannot elicit, and fails closed. The `destructiveHint` annotation does not enforce
  anything on its own.

When you add a tool, register it in the matching module (or a new module wired into
`index.ts`), and both servers pick it up the next time they call its register function.

## Invariants

- Storage-agnostic. Code against the `ExerciseIndex` interface, never against D1 or a file
  cache. A tool that genuinely needs a specific backend does not belong here (the hosted
  warehouse sync tools live in the `cloudflare` package for this reason).
- Transport-agnostic. No stdio assumptions, no Worker/Durable Object assumptions.
- Shapes come from `dto`.

## Commands

```bash
pnpm build       # tsdown
pnpm typecheck
pnpm test
pnpm exec vitest run test/confirm.test.ts
pnpm exec vitest run -t "<name>"
```
