# @trainheroic-unofficial/js

An unofficial TypeScript SDK for the TrainHeroic coaching API. It handles auth and session
renewal, talks to both TrainHeroic hosts, keeps a searchable exercise library, encodes
workouts into the API's payload format, and wraps messaging. It runs in any modern
JavaScript runtime, including Cloudflare workerd.

Part of the [trainheroic-unofficial](../../README.md) workspace.

> Unaffiliated with TrainHeroic. It drives the same undocumented endpoints the web app uses,
> so a server-side change can break it without warning. Use it against your own account.

## Contents

- [Install](#install)
- [Quickstart](#quickstart)
- [Two entry points](#two-entry-points)
- [What it covers](#what-it-covers)
- [Working with exercises](#working-with-exercises)
- [Building a workout](#building-a-workout)
- [Reading athlete training](#reading-athlete-training)
- [The workout encoder](#the-workout-encoder)
- [Develop](#develop)

## Install

```bash
npm install @trainheroic-unofficial/js
# or: pnpm add @trainheroic-unofficial/js
```

Requires a runtime with global `fetch` and Web Crypto (Node >= 18, workerd, modern browsers).

## Quickstart

Construct a client with your TrainHeroic credentials and call `request`. The client logs in
lazily on the first call and renews the session for you.

```ts
import { TrainHeroicClient } from "@trainheroic-unofficial/js";

const client = new TrainHeroicClient(
  process.env.TRAINHEROIC_EMAIL!,
  process.env.TRAINHEROIC_PASSWORD!,
);

// request<T>(method, path, options) reaches any endpoint the web app uses.
// The type parameter T types res.data; omit it and data is `unknown`.
const res = await client.request<{ id: number }>("GET", "/user/simple");
if (res.ok) {
  console.log(res.data.id);
}
```

`request` returns `{ status: number; ok: boolean; data: T }`. It does not throw on an HTTP
error status, so check `res.ok`. It throws `TrainHeroicAuthError` only when a login attempt
fails (bad credentials).

The third argument, `options`, is `RequestOptions`:

```ts
type RequestOptions = {
  body?: unknown; // serialized as JSON for non-GET/DELETE requests
  base?: "coach" | "apis"; // which host; defaults to "coach" (api.trainheroic.com)
};
```

So a write is the same call with a body:

```ts
const created = await client.request("POST", "/2.0/coach/exercise/create", {
  body: { title: "Sled Push" },
});
```

There is no enumerated endpoint catalog; the paths are the ones the TrainHeroic web app calls.
Most are reachable through the typed helpers below, so you rarely call `request` directly. The
request and response shapes those helpers use live in
[`@trainheroic-unofficial/dto`](../dto) as zod schemas and types.

### Reusing a session across restarts

TrainHeroic has no refresh token and a session expires after roughly one or two hours. By
default the client logs in on its first request and keeps the session token in memory for the
life of the process, so a fresh process logs in again. To skip that login, read the token off
one client and hand it to the next via the third constructor argument.

After a request has run, `client.sessionId` holds the active token, typed `string | null` (it
is `null` only before the first login). Persist it with your own storage — `saveToken` and
`loadToken` below stand in for whatever you use (a file, a KV store, an env var):

```ts
await client.request("GET", "/user/simple");
const token = client.sessionId;
if (token) saveToken(token);
```

A later process passes the saved token as the third constructor argument (also `string | null`,
so a missing token simply falls back to a normal login):

```ts
const client = new TrainHeroicClient(
  process.env.TRAINHEROIC_EMAIL!,
  process.env.TRAINHEROIC_PASSWORD!,
  loadToken(),
);
```

If the reused token has expired, the next request gets a 401/403; the client logs in once with
the credentials, retries, and updates `client.sessionId` to the new token.

## Two entry points

```ts
// Runtime-agnostic. Safe in browsers and on workerd.
import { TrainHeroicClient, ExerciseLibrary, buildSession } from "@trainheroic-unofficial/js";

// Node-only filesystem helpers, kept out of the main entry.
import { JsonFileLibraryCache, defaultCachePath } from "@trainheroic-unofficial/js/node";
```

The `.` entry imports no `node:*` modules. Anything that touches the filesystem lives behind
`./node`.

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
- **Athlete training.** Functions for the logged-in account's own training: scheduled and
  completed workouts, per-exercise history, personal records, and working maxes.
- **Messaging.** Listing conversation streams, reading a stream, and building, sending, or
  deleting a comment.

## Working with exercises

`ExerciseLibrary` loads the full library once, caches it, and answers name lookups and fuzzy
search against the in-memory copy. By default it caches in memory; pass a `JsonFileLibraryCache`
from `./node` to persist between runs (it writes to `defaultCachePath()`,
`~/.trainheroic/library.json`, unless you pass a path).

```ts
import { ExerciseLibrary } from "@trainheroic-unofficial/js";
import { JsonFileLibraryCache } from "@trainheroic-unofficial/js/node";

// `client` is the TrainHeroicClient from the Quickstart above.
const library = new ExerciseLibrary(client, new JsonFileLibraryCache());

// Fuzzy search, ranked. Returns up to `limit` matches, each with id, title, and units.
const matches = await library.search("back squat", 5);

// resolve() returns { match, candidates }. A single confident hit fills `match`;
// an ambiguous name leaves `match` null and returns the candidates to choose from.
const { match, candidates } = await library.resolve("Barbell Back Squat");
if (!match) {
  // Ask the user (or the model) to pick one of `candidates`, then use its id.
  console.log(candidates.map((c) => `${c.id}: ${c.title}`));
}
```

## Building a workout

`buildSession` writes one session into a program on a given day: it creates the session, saves
the blocks and exercises, and optionally publishes. `programId` identifies one of your
TrainHeroic programs — find it in the program's URL in the web app, or from a programs read
(`client.request("GET", ...)`). Exercise ids come from the library.

```ts
import { buildSession, type BlockSpec } from "@trainheroic-unofficial/js";

const { match } = await library.resolve("Back Squat");
if (!match) throw new Error("Resolve to a single exercise before building.");

const blocks: BlockSpec[] = [
  {
    title: "Strength",
    exercises: [
      // sets/reps/weight scalars; rpe is routed into the instruction text (see the encoder).
      { id: match.id, sets: 5, reps: 5, weight: 225, rpe: 8 },
    ],
  },
];

const { pwId, workoutId } = await buildSession(client, {
  programId: 12345,
  date: [2026, 6, 22], // [year, month, day]; month is 1-based, so 6 = June
  blocks,
  instruction: "Warm up first.",
  publish: false, // build as a draft; publish makes it visible to athletes
});
```

Each exercise needs an `id`; `sets`, `reps`, `weight`, `rpe`, and a per-exercise `instr` are
optional. `reps` and `weight` take a scalar (broadcast across every set) or a per-set array
like `reps: [5, 5, 3]`. The full field list is `ExerciseSpec` / `BlockSpec` in
[`@trainheroic-unofficial/dto`](../dto). Loads are in whatever unit the exercise is configured
for in TrainHeroic; a mismatch becomes an advisory rather than a silent change (below).

`buildSession` returns `{ pwId, workoutId }`: `pwId` is the program-workout id (the placement
of the session in the program — this is the handle the other calls take), and `workoutId` is
the underlying workout id. Read it back with `readSession(client, programId, date, pwId)`,
publish later with `publishSession(client, pwId)`, or remove it with
`removeSession(client, programId, pwId)`.

## Reading athlete training

```ts
import { resolveAthleteUserId, fetchAthleteProfileSummary } from "@trainheroic-unofficial/js";

const userId = await resolveAthleteUserId(client);
const summary = await fetchAthleteProfileSummary(client, userId);
```

These work from any session, coach or athlete, since a coach account also carries athlete
scope.

## The workout encoder

`buildSession` calls the encoder for you; you only deal with it directly to preview warnings.
TrainHeroic's exercise payload expects every parameter slot present, so the encoder fills all
of them (empty slots included) to avoid an HTTP 500. A scalar prescription is broadcast across
the set count, RPE is routed into the instruction text rather than a numeric slot (the API
would otherwise coerce it to load), and unit mismatches between a spec and the exercise's fixed
parameter types are collected as advisories rather than silently dropped.

Those advisories are not part of the `buildSession` result; read them before building by
calling `collectAdvisories(blocks, index)` (the `index` is an `ExerciseLibrary`), which returns
the unit notes and warnings for a set of blocks.

## Develop

Clone the workspace and run `pnpm install` once at the repo root (Node >= 24, pnpm 11), then
from this package directory:

```bash
pnpm build       # tsdown -> dist (separate "." and "./node" outputs)
pnpm typecheck
pnpm test
pnpm exec vitest run test/workout-encode.test.ts          # one file
pnpm exec vitest run -t "broadcasts a scalar over sets"   # one test
```

## License

MIT
