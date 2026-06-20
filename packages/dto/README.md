# @trainheroic-unofficial/dto

Domain DTOs and zod schemas for the TrainHeroic API. This package is the single source of
truth for request and response shapes; the SDK, the MCP tool layer, and the CLI all import
their types from here instead of redefining them.

Part of the [trainheroic-unofficial](../../README.md) workspace.

## Install

Internal to the workspace (consumed as `workspace:*`). Published builds expose a single ESM
entry with type declarations.

```ts
import { workoutSpecSchema, type WorkoutSpec, idSchema } from "@trainheroic-unofficial/dto";

const spec: WorkoutSpec = workoutSpecSchema.parse(input);
```

## What's inside

Schemas come in two flavors. Input schemas are strict enough to validate user-supplied
data such as workout specs, exercise-create bodies, and message drafts. Response schemas
are deliberately tolerant: they use loose objects and accept a number or a numeric string
for ids, so upstream API drift adds fields without breaking parsing.

`src/` is organized by domain (`common`, `exercise`, `workout`, `messaging`, `responses`),
re-exported through `index.ts`. The central pieces:

- `idSchema` normalizes the API's number-or-string ids.
- `workoutSpecSchema` / `WorkoutSpec` is the protocol used to build a session: an optional
  top-level instruction plus an array of blocks, where each block carries an exercises
  array and each exercise references a library id. `blockSpecSchema` and
  `exerciseSpecSchema` are its parts; `leaderboardSpecSchema` covers red-zone leaderboards.
- The read-back types (`ReadResult` and friends) describe a decoded session, and `Advisory`
  carries the unit notes and warnings the encoder produces.
- The `responses` module holds the tolerant schemas used to validate API payloads at
  checkpoints without rejecting unknown fields.

## Develop

```bash
pnpm build       # tsdown -> dist (ESM + .d.mts)
pnpm typecheck
pnpm test                                  # vitest
pnpm exec vitest run test/workout.test.ts  # one file
```
