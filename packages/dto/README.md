# @trainheroic-unofficial/dto

Domain DTOs and zod schemas for the TrainHeroic API. This package is the single source of
truth for request and response shapes. The SDK, the MCP tool layer, and the CLI all import
their types from here.

Part of the [trainheroic-unofficial](../../README.md) workspace.

## Contents

- [Install](#install)
- [What's inside](#whats-inside)
- [Develop](#develop)

## Install

Published to npm as a single ESM entry with type declarations; other packages in this
workspace depend on it via `workspace:*`. You can install it on its own:

```bash
npm install @trainheroic-unofficial/dto
```

It depends on [zod](https://zod.dev) (v4), pulled in automatically as a dependency. Each schema
travels with its inferred type, so you validate and type from one import. `.parse()` throws a `ZodError` on bad data; use
`.safeParse()` if you want a result object instead.

```ts
import { workoutSpecSchema, type WorkoutSpec } from "@trainheroic-unofficial/dto";

// `input` is untrusted data (e.g. a parsed JSON file or request body).
const spec: WorkoutSpec = workoutSpecSchema.parse(input);
```

It imports no `node:*` and touches no filesystem, so it runs in Node, browsers, and
Cloudflare workerd.

## What's inside

Schemas come in two flavors. Input schemas are strict enough to validate user-supplied
data such as workout specs, exercise-create bodies, and message drafts. Response schemas
are deliberately tolerant: they use loose objects and accept a number or a numeric string
for ids, so upstream API drift adds fields without breaking parsing.

`src/` is organized by domain (`common`, `exercise`, `workout`, `messaging`, `responses`),
re-exported through `index.ts`. The central pieces:

- `idSchema` normalizes the API's number-or-string ids.
- `workoutSpecSchema` / `WorkoutSpec` is the input you hand to the SDK's workout encoder (the
  code in `js` that turns a spec into TrainHeroic's payload): an optional top-level
  instruction plus an array of blocks, where each block carries an exercises array and each
  exercise references an exercise-library id. `blockSpecSchema` and `exerciseSpecSchema` are
  its parts; `leaderboardSpecSchema` covers Red Zone leaderboards (TrainHeroic's competitive
  block type, where athletes are ranked on a score).
- The read-back types (`ReadResult`, `ReadBlock`, `ReadExercise`) describe a session decoded
  back out of the API into a readable shape, and `Advisory` carries the unit notes and
  warnings the encoder emits (for example, a prescription whose unit does not match the
  exercise's parameter type).
- The `responses` module holds the tolerant schemas the SDK uses to sanity-check an API
  response before trusting it; these schemas accept unknown fields.

## Develop

Run `pnpm install` once at the repo root (Node >= 24, pnpm 11), then from this package:

```bash
pnpm build       # tsdown -> dist (ESM + .d.mts)
pnpm typecheck
pnpm test                                  # vitest
pnpm exec vitest run test/workout.test.ts  # one file
```
