# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This package is `@trainheroic-unofficial/eval`, the in-code eval harness. For the workspace
dependency graph and shared conventions, read [../../CLAUDE.md](../../CLAUDE.md) first. **`README.md`
in this package is the architecture overview (the three axes, why a fake backend, how a run works,
the scenario table) — read it before changing the harness.** This file is the agent-facing quick
reference so adding a scenario or wiring a tool does not require re-deriving the harness from source.

## What it is, in one paragraph

A vitest suite spawns a headless `claude -p` against a fixture-backed fake TrainHeroic backend
(a Hono app on an ephemeral port, reached via the SDK's `TH_COACH_BASE` / `TH_APIS_BASE` /
`TH_AUTH_URL` overrides) and asserts on how the agent behaves — across both roles (coach/athlete)
and both surfaces (MCP/CLI) from one scenario definition. Tool calls and CLI commands are normalized
to one canonical capability name, so a single grader covers both surfaces.

## The pieces (file → role)

- `src/types.ts` — the `Scenario`, `RunTranscript`, `ToolCall`, `WriteRecord`, `Grade` types.
- `src/harness.ts` — `runScenario(scenario, surface)` (K-loop + threshold), `evalGate()`,
  `scenarioSurfaces()`.
- `src/fake-backend.ts` — the Hono route table. Reads come from the `Dataset`; `registerWrites`
  records every mutating request into `transcript.writes` and returns a plausible success. A
  `notFound` → 501 handler records routing gaps in `unmatched` (a non-empty `unmatched` is a bug).
- `src/datasets.ts` — `Dataset` type + builders (`buildOrg`, `largeRoster`, `highEnrollmentAthlete`,
  …). The `athlete` sub-object holds the athlete-surface reads (`range(start,end)` is
  `athlete_workouts`).
- `src/demo.ts` — populated "normal account" fixtures (`demoAthlete`, `demoCoach`) for the query bank.
- `src/shapes.ts` — typed builders for the raw API response shapes (`programWorkout`,
  `athleteRangeWorkout`, `workoutSetExercise`, …). One shape lives in one place; reuse these.
- `src/grade.ts` — grader predicates (see catalog below).
- `src/tools.ts` — the MCP read/write tool allow-list per role (`ROLE_TOOLS`).
- `src/canonical.ts` — CLI command path → canonical capability name (per role), and flag → arg name.
- `evals/*.eval.ts` — the scenarios. `vitest.config.ts` includes `evals/**/*.eval.ts` +
  `test/**/*.test.ts`.

## Scenario shape

```ts
type Scenario = {
  name: string; // also the eval filename: evals/<name>.eval.ts
  dataset: Dataset; // what the fake backend serves
  query: string; // the user's question/instruction
  today: string; // date context handed to the agent
  grade: (t: RunTranscript) => { pass: boolean; reason: string };
  role?: Role; // "coach" (default) | "athlete"
  mode?: Mode; // "read" (default) | "write" — write allows the write tools + records writes
  surfaces?: Surface[]; // ["mcp","cli"] default; truncation-only scenarios are mcp-only
  k?: number; // runs per surface (env EVAL_K)
  threshold?: number; // pass-rate bar (env EVAL_THRESHOLD); 0.6 is typical
};
```

The file body is boilerplate — copy an existing scenario (`evals/athlete-slot-target-log.eval.ts`
is the canonical write example):

```ts
const gate = evalGate();
describe.skipIf(!gate.enabled)(scenario.name, () => {
  for (const surface of scenarioSurfaces(scenario)) {
    it(`${surface}: <what it should do>`, async () => {
      const r = await runScenario(scenario, surface);
      expect(r.rate, r.report).toBeGreaterThanOrEqual(r.threshold);
    });
  }
});
```

## Grader catalog (`src/grade.ts`)

- Tool calls: `callsTo(t, name)`, `countCalls(t, name)`, `hadSuccessfulRead(t)`,
  `usedNarrowingArg(t, name)`, `narrowedAfterTruncation(t)`.
- Answer text: `mentionsAny(t, words)` (answer prose only), `finalMentions(t, words)` (answer + the
  model-authored EVAL REPORT — use for "did it surface this fact"), `soundsLikeGivingUp(t)`,
  `reportField(t, field)`, `answerReached(t)`.
- Writes (write mode, over `t.writes` of `{ method, path, body }`): `writesTo(t, pathFragment)`,
  `didWrite(t, pathFragment)`, `writeBodyHas(t, pathFragment, value)`, `noWrites(t, writeNames)`.
  For a DELETE, filter `t.writes` by `w.method === "DELETE"` yourself (there is no method-aware
  helper). The set-write PUT body carries `id` = the savedWorkoutSetExerciseId, and the path is
  `/1.0/{role}/savedworkoutsetexercise/{id}` — assert on either.

A grader returns `{ pass, reason }`; put the failing sub-conditions in `reason` so a failure report
is debuggable.

## Adding a tool / command (keep these in sync)

A new capability must be wired in three places or a surface can't call it:

1. `src/tools.ts` — add the MCP tool name to the role's `readTools` or `writeTools`. A tool in
   neither list is denied in every mode.
2. `src/canonical.ts` — add `"athlete <cmd>": "<mcp_tool_name>"` to `ATHLETE_COMMANDS` (or
   `COACH_COMMANDS`). **The canonical name must equal the MCP tool name** so one grader covers both
   surfaces — this is why a capability the CLI exposes as a flag on an existing command (e.g. an old
   `--log-ids`) needs its own subcommand to map cleanly. Map any flag a grader inspects in `FLAG_MAP`.
3. `src/fake-backend.ts` — a read needs a route in `registerAthleteReads`/`buildApp` and a
   `Dataset.athlete` field for its data; a write needs a route in `registerWrites` that calls
   `record(c, writes)`. **A tool that is a client-side projection of an existing endpoint needs no
   new route** (e.g. `athlete_log_targets` reads `/3.0/athlete/programworkout/range`, same as
   `athlete_workouts`).

The set-write path reads `workout_set_exercise_id` off each saved-copy exercise and
`saved_workout_id`/`workout_set_id` off the saved set — the `shapes.ts` builders include these, so a
loggable fixture should come from `programWorkout()` (its `saved_workout.workoutSets` is populated)
rather than `athleteRangeWorkout({ logged: false })` (whose saved sets are empty until logged).

Deterministic coverage of new datasets/routes goes in `test/fake-backend.test.ts` (runs in
`pnpm check`); the LLM evals (`evals/*.eval.ts`) do not.

## Running

RULE: "run the evals" means run the actual LLM evals with `RUN_EVALS=1 … vitest run evals/…`. Do not
substitute `pnpm test` or `pnpm check` — those run only the deterministic `test/**` backend checks
and skip every scenario under `evals/`. The point of the evals is to spend the tokens and watch a
model drive the surface. After adding or changing a scenario, run it (at least `EVAL_K=1`) and
confirm it passes before considering the work done. Never ship an unrun scenario.

```bash
pnpm test                       # deterministic backend/dataset tests only (part of pnpm check) — NOT the evals
pnpm eval                       # RUN_EVALS=1; every scenario on every surface (costs money, needs `claude`)
pnpm eval:mcp                   # EVAL_SURFACES=mcp
pnpm eval:cli                   # EVAL_SURFACES=cli
EVAL_K=1 EVAL_MODEL=haiku pnpm eval   # fast, weaker-model usability signal
RUN_EVALS=1 pnpm exec vitest run evals/<name>.eval.ts   # one scenario
```

Env knobs: `RUN_EVALS` (gate), `EVAL_SURFACES`, `EVAL_MODEL` (`sonnet`|`haiku`), `EVAL_K`,
`EVAL_THRESHOLD`. The skills `mcp-eval` and `cli-eval` drive this harness.
