# @trainheroic-unofficial/js

An unofficial TypeScript SDK for the TrainHeroic coaching API. It handles auth and session
renewal, talks to both TrainHeroic hosts, keeps a searchable exercise library, encodes
workouts into the API's payload format, and wraps messaging. It runs in any modern
JavaScript runtime, including Cloudflare workerd.

Part of the [trainheroic-unofficial](../../../README.md) workspace.

## Two entry points

```ts
// Runtime-agnostic. Safe in browsers and on workerd.
import { TrainHeroicClient, ExerciseLibrary, buildSession } from "@trainheroic-unofficial/js";

// Node-only filesystem helpers, kept out of the main entry.
import { JsonFileLibraryCache, defaultCachePath } from "@trainheroic-unofficial/js/node";
```

The `.` entry imports no `node:*` modules. Anything that touches the filesystem lives behind
`./node`, so the SDK stays portable.

## What it covers

- **Client and auth.** `TrainHeroicClient` holds the coach credentials, acquires a session
  token lazily, and renews it transparently. TrainHeroic issues no refresh token, so on a
  401/403 the client logs in again with the stored credentials and retries once. A cold
  client hit by concurrent requests performs a single shared login. `RequestOptions.base`
  selects the host (`coach` for `api.trainheroic.com`, `apis` for `apis.trainheroic.com`).
- **Exercises.** `ExerciseIndex` is the interface the rest of the system codes against;
  `ExerciseLibrary` is the in-memory implementation that resolves names to ids, ranks
  fuzzy search, and persists through a `LibraryCache` (in-memory by default, JSON file via
  `./node`). The hosted server supplies a D1-backed implementation of the same interface.
- **Workouts.** A session builder (create, save blocks and exercises, optionally publish),
  read-back, instruction editing, and removal, plus the encoder that turns a
  `WorkoutSpec` into the API's payload.
- **Messaging.** Listing conversation streams, reading a stream, and building, sending, or
  deleting a comment.

## The workout encoder

The encoder is the package's hardest-won piece. TrainHeroic's exercise payload expects every
parameter slot present, so the encoder fills all of them (empty slots included) to avoid an
HTTP 500. A scalar prescription is broadcast across the set count, RPE is routed into the
instruction text rather than a numeric slot (the API would otherwise coerce it to load), and
unit mismatches between a spec and the exercise's fixed parameter types are surfaced as
advisories instead of silently dropped.

## Develop

```bash
pnpm build       # tsdown -> dist (separate "." and "./node" outputs)
pnpm typecheck
pnpm test
pnpm exec vitest run test/workout-encode.test.ts          # one file
pnpm exec vitest run -t "broadcasts a scalar over sets"   # one test
```
