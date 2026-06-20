# Code Review Summary — TrainHeroic MCP Worker

Two reviews were run against `worker/src` (~3000 LOC, 26 files):

1. A **thermonuclear code-quality** pass (structure, the 1k-line rule, spaghetti,
   duplication, leaky abstractions). Verdict: **Approve / polish pass** — no file
   approaches 1k lines (largest 298), layering is clean, secrets handling is careful.
2. A **multi-dimension adversarial review** (correctness, security/credential
   handling, MCP-spec compliance, reliability, maintainability), with every finding
   independently verified against the code. It confirmed **21 findings** (4 high,
   5 medium, 12 low).

## High-severity findings (all fixed)

- **Weight silently dropped** when a scalar `weight` was given with no `reps`
  (`workout/encode.ts`). `makeExercise` now derives an effective set count from
  reps, the weight array, or `sets`, and sets `param_count`/`set_num` accordingly.
  Regression tests added.
- **`th_request` bypassed the destructive-action gate** — an LLM could DELETE/publish
  with no confirmation. Mutating methods (POST/PUT/DELETE) now go through the same
  `confirmGate` (elicitation + `confirm:true` fallback) as the dedicated tools; GET
  stays ungated.
- **`runBatches` broke delete-then-reinsert atomicity** across chunk boundaries
  (programming sync could lose synced data on a mid-sync failure). Replaced with
  `runGroups`, which packs whole per-session statement groups into batches and never
  splits a group, so a failure can't half-apply a session. Multi-session test added.
- **`syncCalendar` fan-out** could abort all of `syncAll` and discard results. Each
  calendar (and each messaging stream) is now wrapped so one failure is recorded in
  the result instead of aborting the run.

## Medium / low findings addressed

- Shared `OrgScopedStore` base removes the triplicated `#db`/`#client`/`#orgId` +
  org-resolver across the three stores; `ExerciseStore`'s inconsistent inline
  resolver is gone.
- Exercise search now `ORDER BY use_count DESC, length(title) ASC` before the
  candidate `LIMIT`, so the best match is not truncated before ranking.
- Workout read-back uses `coerceInt` for type/redzone fields, so string-encoded
  numerics still yield units and the leaderboard label.
- Cold-client login stampede fixed by memoizing the in-flight login promise.
- Auth hardening: `oauth_req` is now bound to the CSRF token with an expiry, and the
  CSRF compare is constant-time.
- DRY consolidation: `toId`/`idParam`/annotation presets centralized in
  `mcp/context.ts`; `isRecord`, `coerceNum`, and the `sync_state` upsert each have a
  single home; `runBatches` builds on `runGroups`.
- The `account` table is now populated (last-seen registry), removing the dead
  schema. Sync tools carry `destructiveHint: false`. Dead `deleteSessionsOnDate`
  removed.

## Consciously kept

- The TrainHeroic password lives at rest in the encrypted grant `props` (no upstream
  refresh token exists). This is the documented, accepted tradeoff for a private
  deployment; it is never logged, never in `userId`/`metadata`, and never forwarded
  upstream except as a fresh `/auth` login.

## Final state

`oxfmt --check` + `oxlint --deny-warnings` + `tsc` (strict) + **75 tests across 12
files**, all green. `wrangler deploy --dry-run` bundles cleanly (415 KB gzip) with
all three bindings resolving.

## Live end-to-end verification

Driven against `wrangler dev` (local) with browser automation and a real MCP SDK
client, using a real TrainHeroic coach account:

- Real browser login at `/authorize` → live `apis.trainheroic.com/auth` → PKCE
  authorization-code flow → token issued.
- `whoami` over the MCP transport returned the real coach profile (live API).
- `exercise_resolve "Back Squat"` synced the real ~2,400-row exercise library into
  D1 (chunked upserts) and resolved to id 1 with units reps/lb.
- `message_send` without `confirm`, from a client without elicitation, was refused
  ("Not confirmed…") — the destructive gate holds in practice.
