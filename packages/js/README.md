# @trainheroic-unofficial/js

An unofficial TypeScript SDK for the TrainHeroic coaching API. It handles auth and session
renewal, talks to both TrainHeroic hosts, keeps a searchable exercise library, encodes
workouts into the API's payload format, and wraps messaging. It runs in any modern
JavaScript runtime, including Cloudflare workerd.

Part of the [trainheroic-unofficial](../../README.md) workspace.

> Unaffiliated with TrainHeroic. It drives the same undocumented endpoints the web app uses,
> so a server-side change can break it without warning. Use it against your own account.

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

// Every endpoint is reachable through request<T>(method, path, options).
const res = await client.request("GET", "/user/simple");
if (res.ok) {
  console.log(res.data); // parsed JSON, typed as T
}
```

`request` returns `{ status, ok, data }`. It never throws on an HTTP error status; check
`res.ok`. It does throw `TrainHeroicAuthError` when a fresh login fails (bad credentials).

If you already hold a session id (for example, one cached from a previous run), pass it as
the third constructor argument to skip the cold login:

```ts
const client = new TrainHeroicClient(email, password, cachedSessionId);
// client.sessionId is null until a login happens, then holds the current token.
```

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
from `./node` to persist between runs.

```ts
import { ExerciseLibrary } from "@trainheroic-unofficial/js";
import { JsonFileLibraryCache } from "@trainheroic-unofficial/js/node";

const library = new ExerciseLibrary(client, new JsonFileLibraryCache());

// Fuzzy search, ranked.
const matches = await library.search("back squat", 5);

// Resolve a name to one exercise. A single confident hit lands in `match`;
// an ambiguous name returns `match: null` with the candidates to disambiguate.
const { match, candidates } = await library.resolve("Barbell Back Squat");
```

## Building a workout

`buildSession` runs the full create-to-publish flow against one program day. Exercise ids
come from the library.

```ts
import { buildSession, type BlockSpec } from "@trainheroic-unofficial/js";

const { match } = await library.resolve("Back Squat");

const blocks: BlockSpec[] = [
  {
    title: "Strength",
    exercises: [
      { id: match!.id, sets: 5, reps: 5, weight: 225, rpe: 8 },
    ],
  },
];

const { pwId, workoutId } = await buildSession(client, {
  programId: 12345,
  date: [2026, 6, 22], // [year, month, day]
  blocks,
  instruction: "Warm up first.",
  publish: false, // leave it as a draft
});
```

Read it back with `readSession(client, programId, date, pwId)`, publish later with
`publishSession(client, pwId)`, or remove it with `removeSession(client, programId, pwId)`.

## Reading athlete training

```ts
import { resolveAthleteUserId, fetchAthleteProfileSummary } from "@trainheroic-unofficial/js";

const userId = await resolveAthleteUserId(client);
const summary = await fetchAthleteProfileSummary(client, userId);
```

These work from any session, coach or athlete, since a coach account also carries athlete
scope.

## The workout encoder

TrainHeroic's exercise payload expects every
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

## License

MIT
