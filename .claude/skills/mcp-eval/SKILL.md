---
name: mcp-eval
description: Evaluate the TrainHeroic MCP's usability by having a model answer real athlete/coach questions through the tools, then see where it got confused or burned turns. The primary path is the in-code harness (packages/eval) — vitest scenarios that drive claude -p against a fixture-backed fake backend with programmatic pass/fail; a legacy bash runner stays for the real API + hosted worker. Use when asked to eval/benchmark/stress-test the MCP, add a scenario, compare models, or tune tool descriptions.
---

# MCP eval

Measure how well a model navigates the TrainHeroic MCP. There are two paths; **default to the
in-code harness** and reach for the legacy bash runner only for the real API or the hosted worker.

| | In-code harness (primary) | Bash runner (real API) |
|---|---|---|
| Where | `packages/eval` | `scripts/mcp-eval.sh` |
| Data | fixture-backed **fake backend** — simulates large orgs (hundreds of athletes, dozens of programs, 2 years of history) | the **real** TrainHeroic API (your `.env` account) |
| Verdict | **programmatic** graders + K-run pass-rate (`pnpm eval`) | model-authored `===EVAL REPORT===`, human-synthesized |
| Surfaces | MCP **and** CLI from one scenario (parity) | MCP only (CLI has its own `cli-eval` runner) |
| Use for | regression guards, scale/history/ambiguity cases, write-path checks, CI-style runs | exploratory real-data runs, the hosted worker, anything the fixtures don't model |

## The harness (`packages/eval`)

A vitest suite spawns headless `claude -p --output-format stream-json` against the role's local MCP
server (or the CLI), pointed at a local **Hono** fake backend whose datasets simulate data the
sparse real test accounts can't. It parses the tool-call trace, normalizes every call to a canonical
capability name (so one grader covers MCP and CLI), runs each scenario K times, and asserts a
pass-rate. Three orthogonal axes: **role** (coach/athlete), **surface** (mcp/cli), **mode**
(read/write). Full detail in [packages/eval/README.md](../../packages/eval/README.md).

```bash
# from the repo root — evals are gated (cost money, need claude on PATH) and are NOT in `pnpm check`
pnpm eval                       # every scenario, every surface it declares
pnpm eval:mcp                   # MCP surface only (EVAL_SURFACES=mcp)
pnpm eval:cli                   # CLI surface only
EVAL_MODEL=haiku pnpm eval      # weaker model — the description-tuning signal
EVAL_K=1 pnpm eval              # one run per scenario (fast smoke)

# one scenario / one bank query, by vitest -t:
RUN_EVALS=1 pnpm --filter @trainheroic-unofficial/eval exec vitest run evals/coach-many-programs.eval.ts
RUN_EVALS=1 pnpm --filter @trainheroic-unofficial/eval exec vitest run evals/coach-bank.eval.ts -t "Romanian Deadlift"
```

Env knobs: `RUN_EVALS=1` (gate; the `pnpm eval*` scripts set it), `EVAL_SURFACES` (`mcp`|`cli`),
`EVAL_MODEL` (`sonnet` default | `haiku`), `EVAL_K` (runs per scenario), `EVAL_THRESHOLD`.

**Two kinds of scenario.** Named failure-mode scenarios (`evals/coach-*.eval.ts`,
`evals/athlete-*.eval.ts`) target one known way the agent fails with a tailored grader — they are
the sharp regression guards. The **query bank** (`evals/{coach,athlete}-bank.eval.ts`, sourced from
`src/bank.ts`, ported from [queries.md](queries.md)) is breadth: every everyday question a person
types, graded by a shared light check (reached an answer via the expected capability / fired the
expected write). The deterministic `test/fake-backend.test.ts` checks the fixtures serve the right
shapes without spending an LLM call — it runs in the normal `pnpm check` gate.

### Adding a tool or a scenario

Keep these in sync so a new capability is exercisable on both surfaces:

1. **`src/tools.ts`** — add the tool to the role's read or write list in `ROLE_TOOLS` (a tool in
   neither list is denied in every mode, so the eval can't call it).
2. **`src/canonical.ts`** — map the CLI `trainheroic …` command to the **same** canonical name as
   the MCP tool, so one grader covers both surfaces.
3. **`src/fake-backend.ts`** + a `Dataset` field — add the route(s) the tool calls and the data it
   returns. Response shapes are typed builders in `src/shapes.ts` (reuse them; don't hand-inline a
   shape). Athlete-surface reads go in `routeAthleteGet`; writes in `registerWrites` (record the
   request, return a plausible success). A 501 in a run's report means a missing route.
4. **A scenario** — either a named `evals/*.eval.ts` (tailored grader from `src/grade.ts`) or a new
   `BankEntry` in `src/bank.ts` (`{query, expect: [canonical names], expectWrite?}`). Back it with
   data: extend `demoAthlete`/`demoCoach` in `src/demo.ts`, or a scale/structure builder in
   `src/datasets.ts`.
5. Verify cheaply first with a deterministic assertion in `test/fake-backend.test.ts`, then one
   `EVAL_K=1` LLM run.

### Reading a result

The pass-rate is the verdict; on failure the report prints each run's normalized call trace, any
recorded writes, and the model-authored `===EVAL REPORT===` (kept for the human-readable confusion
notes — `CONFUSION_POINTS` / `WHAT_WOULD_HAVE_HELPED` are the description-tuning gold). Diff
`EVAL_MODEL=sonnet` vs `haiku`: where haiku drops below threshold but sonnet passes is exactly the
wording a weaker model couldn't lean on. Map each fix to a tool description in
`packages/core/src/tools/`, a presenter in `packages/js/src/athlete.ts`, or a missing tool — and if
a tool repeatedly forces `raw:true` to reach data, that's a presenter gap in `js`, not a wording
tweak (issue #18 was exactly this).

## The bash runner (`scripts/mcp-eval.sh`) — real API + hosted

Use this when you need the **real** account or the hosted worker, which the fixtures don't model.
`scripts/mcp-eval.sh <athlete|coach> "<query>" [YYYY-MM-DD] [model]` runs ONE query through a fresh
`claude -p` that spawns its own stdio server from a generated config (always current source). It
prints the answer + an `===EVAL REPORT===` block you synthesize by hand.

- **Model:** 4th arg (default `sonnet`); empty date keeps today: `… "" haiku`.
- **Read-only (default):** write tools are whitelisted out and denied — safe on any account.
- **Write mode:** `WRITES=1` allows the write tools — **TEST account only**, the destructive tools
  really fire. The subagent passes `confirm:true` where a tool gates, and reverses its own writes.
- Needs `claude` on PATH and the repo `.env` (creds the launcher `scripts/mcp-eval-server.sh`
  reads; `TRAINHEROIC_ATHLETE_*` point the athlete server at the test athlete).

Fan a bank out **per `(role, model, mode)` cache group**: warm the shared `claude` prefix with one
throwaway tool-less run, `wait`, then background the real queries so they read the warmed prefix
(~5-min TTL, refreshed per read). Don't background a whole multi-group bank at once — cache is
per-group, so cross-group runs all miss. A group with one query needs no warm-up.

```bash
role=athlete model=sonnet
WARM="Warm-up only: reply OK, then output the eval report with ANSWER_REACHED: no, CONFUSION_SCORE: 1. Call no tools."
scripts/mcp-eval.sh "$role" "$WARM" "" "$model" >/dev/null 2>&1
scripts/mcp-eval.sh "$role" "Did I record anything this week?"     "" "$model" > /tmp/e1.txt 2>/dev/null &
scripts/mcp-eval.sh "$role" "What are my working maxes right now?" "" "$model" > /tmp/e2.txt 2>/dev/null &
wait
```

**Hosted worker:** the runner only spawns local stdio servers. To eval the hosted worker (or this
session's deferred-tool / ToolSearch friction), spawn an in-session `general-purpose` subagent with
the model under test; its tools are `mcp__claude_ai_Trainheroic__*` (role-aware; schemas deferred —
`ToolSearch` first). Same `===EVAL REPORT===` format.

Synthesize bash runs into `docs/mcp-evals/<YYYY-MM-DD>.md`: a table keyed by query (role, model,
mode, tool calls, confusion, answer-reached), the model deltas, recurring themes, and a prioritized
fix list separating cheap description edits from shape/new-tool work. Offer to implement the cheap
fixes.

## Notes

- The harness is the default; it's deterministic, models data the real accounts lack, and grades
  itself. Reach for the bash runner for real data or the hosted worker.
- Write mode (either path) is TEST account only on the real API; the harness's writes hit the fake
  backend, so they're always safe.
- Scale to the ask: a quick check is one scenario or a few bank queries at `EVAL_K=1`; a thorough
  audit is `pnpm eval` across both surfaces and both models, then the bash runner against the real
  account for anything the fixtures don't cover.
