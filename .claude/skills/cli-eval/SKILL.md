---
name: cli-eval
description: Evaluate the `trainheroic` CLI's usability by having a model drive the commands to answer real athlete/coach questions, then see where it got confused or burned commands. The primary path is the in-code harness (packages/eval) run on the CLI surface — same scenarios and graders as the MCP eval, for direct CLI↔MCP parity; a legacy bash runner stays for the real API. Use when asked to eval/benchmark/stress-test the CLI, add a scenario, compare models, or tune command names / flags / help text / JSON output.
---

# CLI eval

Measure how well a model drives the `trainheroic` CLI. The CLI is a distinct agent-facing surface
from the MCP tools — its own command names, flag spellings, help text, and JSON-only output — so it
can confuse a model in ways the MCP surface can't. There are two paths; **default to the in-code
harness** and reach for the bash runner only for the real API.

This is the CLI twin of [mcp-eval](../mcp-eval/SKILL.md). The two are now **one harness**: a scenario
is written once and runs on both surfaces, because each `trainheroic …` command normalizes to the
same canonical capability name as the matching MCP tool. So the CLI and MCP can be compared directly
on the same question, dataset, and grader.

## The harness (`packages/eval`) — CLI surface

The harness (full mechanics in [mcp-eval](../mcp-eval/SKILL.md#the-harness-packageseval) and
[packages/eval/README.md](../../packages/eval/README.md)) drives the CLI by generating a `trainheroic`
shim on PATH (scoped via `Bash(trainheroic:*)`), pointed at the fake backend, with `--yes` blocked in
read mode so a read eval can't commit a write. Run the CLI surface:

```bash
pnpm eval:cli                   # every scenario on the CLI surface (EVAL_SURFACES=cli)
EVAL_MODEL=haiku pnpm eval:cli  # weaker model — the help/flag-wording signal
EVAL_K=1 pnpm eval:cli          # fast smoke

# one scenario, CLI surface:
RUN_EVALS=1 EVAL_SURFACES=cli pnpm --filter @trainheroic-unofficial/eval exec vitest run evals/coach-bank.eval.ts
```

Because graders are surface-agnostic, a CLI failure where the MCP passes (or vice versa) is the
signal that one surface's naming/help/output is harder to drive — run `pnpm eval` (both surfaces) and
diff. The CLI→capability mapping lives in **`src/canonical.ts`**; when you add or rename a CLI
command, update it so the canonical name still matches the MCP tool (see
[mcp-eval → Adding a tool](../mcp-eval/SKILL.md#adding-a-tool-or-a-scenario), and the harness quick
reference in [packages/eval/CLAUDE.md](../../packages/eval/CLAUDE.md)). Truncation-driven
scenarios are MCP-only — the CLI streams full results — so they declare `surfaces: ["mcp"]`.

## The bash runner (`scripts/cli-eval.sh`) — real API

Use this for the **real** account, which the fixtures don't model.
`scripts/cli-eval.sh <athlete|coach> "<query>" [YYYY-MM-DD] [model]` runs ONE query through a fresh
`claude -p` whose only TrainHeroic tool is the `trainheroic` command (restricted to
`Bash(trainheroic:*)` so it can't sidestep via `tsx`/`pnpm`). Runs from current source; prints the
answer + an `===EVAL REPORT===` block (`COMMANDS` instead of `TOOL_CALLS`) you synthesize by hand.

- **Model:** 4th arg (default `sonnet`); empty date keeps today: `… "" haiku`.
- **Read-only (default):** enforced structurally — the shim refuses `--yes`, and every CLI write
  requires `--yes`, so all writes fail closed (no command list to maintain). Safe on any account.
- **Write mode:** `WRITES=1` lets `--yes` through — **TEST account only**, the destructive commands
  really fire. The subagent passes `--yes` and reverses its own writes where it can.
- Per run, the session/library caches are isolated to a temp dir
  (`TRAINHEROIC_SESSION_FILE`/`TRAINHEROIC_CACHE_FILE`), so fan-out never touches `~/.trainheroic`.

Fan out and synthesize exactly as in [mcp-eval](../mcp-eval/SKILL.md#the-bash-runner-scriptsmcp-evalsh--real-api--hosted)
(per-`(role, model, mode)` cache groups; warm then burst). Save real-API synthesis to
`docs/cli-evals/<YYYY-MM-DD>.md`, mapping each fix to the CLI's help/flags/output in
`packages/cli/src/cli.ts` (or a presenter/SDK gap in `packages/js`).

## Notes

- Default to the harness CLI surface; it's deterministic, models data the real account lacks, grades
  itself, and gives direct CLI↔MCP parity. Reach for the bash runner for real data.
- Shared query bank: the harness bank (`src/bank.ts`) and [queries.md](../mcp-eval/queries.md) are the
  same questions; the harness runs them on whichever surface you select.
- Scale to the ask: a quick check is one scenario at `EVAL_K=1`; a thorough audit is `pnpm eval:cli`
  across both models, then the bash runner against the real account for anything the fixtures miss.
