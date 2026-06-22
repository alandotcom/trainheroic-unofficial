# @trainheroic-unofficial/eval

In-code evals for the TrainHeroic toolkit. A vitest suite spawns a headless `claude -p` against a
**fixture-backed fake TrainHeroic backend** and asserts on how the agent behaves — across **both
surfaces (MCP and CLI)** from one scenario definition. This replaces the ad-hoc bash eval runners
with proper evals in code, and gives CLI↔MCP parity: the same question, dataset, and grader run on
either surface, so the two can be compared directly.

## Why a fake backend

The real test accounts are sparse. To reproduce failures that only show up at scale — a roster of
hundreds, dozens of programs, an athlete on many programs at once, ambiguous program names — the
harness serves **simulated** data from `src/datasets.ts` over a local HTTP server
(`src/fake-backend.ts`). The spawned MCP server / CLI reaches it because the SDK client honors
`TH_COACH_BASE` / `TH_APIS_BASE` / `TH_AUTH_URL` env overrides (a process-crossing seam a
`vi.stubGlobal` can't provide).

## How a run works

1. `startBackend(dataset)` boots the fake backend on an ephemeral port.
2. A **surface driver** spawns `claude -p … --output-format stream-json --verbose`:
   - **MCP** (`src/surfaces/mcp.ts`): runs the local coach MCP server directly via its tsx bin, with
     the base-URL overrides + fake creds injected on the server's env.
   - **CLI** (`src/surfaces/cli.ts`): generates a `trainheroic` shim on PATH (scoped via
     `Bash(trainheroic:*)`), pointed at the fake backend, with `--yes` blocked so a read eval can't
     commit a write.
3. `src/stream.ts` parses the JSONL trace into a `RunTranscript`. Each call is **normalized to a
   canonical capability name** — MCP tool ids strip their prefix; CLI `trainheroic …` commands map
   through `src/canonical.ts` (e.g. `coach teams` → `list_teams`,
   `coach athlete-workouts` → `athlete_saved_workouts`). So one grader works on both surfaces.
4. `runScenario(scenario, surface)` runs K times and asserts a pass-rate threshold (the K-loop
   absorbs LLM nondeterminism). The EVAL REPORT and call traces are attached to the failure message.

## Running

Evals are **not** part of `pnpm check` (they cost money, need the `claude` CLI, and are
nondeterministic). They self-skip unless opted in.

```bash
# from the repo root
pnpm eval                       # RUN_EVALS=1; every scenario on every surface it declares
pnpm eval:mcp                   # MCP surface only (EVAL_SURFACES=mcp)
pnpm eval:cli                   # CLI surface only (EVAL_SURFACES=cli)
EVAL_MODEL=haiku pnpm eval      # weaker model — the usability signal
EVAL_K=1 pnpm eval              # one run per scenario per surface (fast smoke)

# a single scenario
RUN_EVALS=1 pnpm --filter @trainheroic-unofficial/eval exec vitest run evals/coach-many-programs.eval.ts
```

Env knobs: `RUN_EVALS` (gate), `EVAL_SURFACES` (`mcp` | `cli` | both), `EVAL_MODEL`
(`sonnet` | `haiku`, default `sonnet`), `EVAL_K` (runs per scenario), `EVAL_THRESHOLD` (override the
pass-rate bar).

## Scenarios

| File                              | Simulates                                        | Surfaces | Guards against                                                                                   |
| --------------------------------- | ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `coach-pagination.eval.ts`        | 300-athlete roster + one oversized program       | mcp      | giving up on a large/truncated pull instead of narrowing or aggregating (truncation is MCP-only) |
| `coach-many-programs.eval.ts`     | 30 team programs, empty standalone list          | mcp, cli | concluding "no programs" instead of walking teams → program detail                               |
| `coach-ambiguous-clarify.eval.ts` | several "Bodybuilding"-titled programs           | mcp, cli | guessing one program instead of asking which                                                     |
| `coach-high-enrollment.eval.ts`   | one athlete in 8 programs on one day (issue #18) | mcp, cli | failing to reach a target program's log ids when the raw view truncates                          |

A scenario declares its `surfaces`; truncation-driven ones are MCP-only because the CLI streams full
results (no result budget). `EVAL_SURFACES` further narrows what runs.

## Adding a tool / command

Keep three lists in sync so both surfaces can exercise a new capability:

- `src/tools.ts` — the MCP read/write tool partition (a tool in neither list is denied in every
  mode, so the eval can't call it).
- `src/canonical.ts` — the CLI `trainheroic …` command → canonical capability mapping.
- the canonical name should match the MCP tool name, so one grader covers both surfaces.
