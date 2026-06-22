---
name: cli-eval
description: Evaluate the `trainheroic` CLI's usability by having subagents (Sonnet or Haiku) answer real athlete/coach questions by running CLI subcommands, reads and — on a test account — writes, then synthesize where they got confused or burned commands. Use when asked to eval/benchmark/stress-test the CLI, check how an agent drives the commands, compare models, or tune command names / flags / help text / JSON output. The CLI twin of mcp-eval.
---

# CLI eval

Measure how well a model drives the `trainheroic` CLI. Each run answers a realistic question by
running CLI subcommands through Bash, reports its command trace and confusion in a fixed format,
then a synthesis pass turns that into prioritized help-text/flag/output fixes.

This is the CLI twin of [mcp-eval](../mcp-eval/SKILL.md). The CLI is a distinct agent-facing
surface from the MCP tools — its own command names, flag spellings, help text (`trainheroic` and
`trainheroic skill`), and JSON-only output. It can confuse a model in ways the MCP surface can't,
so it gets its own eval. Run both for full coverage.

Same two axes to sweep as mcp-eval:

- **Model.** Default **Sonnet**; also run **Haiku**. Where Haiku stumbles but Sonnet sails
  through is the help/flag wording a weaker model couldn't lean on — the highest-value fixes.
- **Role + mode.** Eval both roles (athlete, coach) and both modes. Reads are the default; write
  evals run against a TEST account (see Write mode), exercising the log/build/publish/send/create
  commands a read-only eval never touches.

## The runner: `scripts/cli-eval.sh`

`scripts/cli-eval.sh <athlete|coach> "<query>" [YYYY-MM-DD] [model]` runs ONE query through a
fresh headless `claude -p` subprocess. The subagent's only TrainHeroic tool is the `trainheroic`
command (run via Bash); it is restricted to `Bash(trainheroic:*)` so it cannot sidestep the
harness by calling `tsx`/`pnpm` directly. The CLI runs from CURRENT source (`pnpm exec tsx`), so
in-session edits are live. It prints the model's answer followed by the `===EVAL REPORT===` block.

- **Model:** 4th arg (default `sonnet`); `MODEL=` env works too. Empty date keeps today:
  `scripts/cli-eval.sh coach "Who's on my roster?" "" haiku`.
- **Read-only (default):** enforced structurally — a `trainheroic` shim on PATH refuses `--yes`,
  and every CLI write requires `--yes`, so all writes fail closed (including any added later; no
  command list to maintain). Safe against any account.
- **Write mode:** set `WRITES=1` to let `--yes` through and allow the write commands. Use ONLY on
  a TEST account — the destructive commands really fire. The subagent is told it's a disposable
  account, may carry the task out for real, must pass `--yes`, and should reverse its own test
  writes (`session-unpublish`, `team-delete`, `exercise forget`, `athlete-restore`, …) where it can.

Per run, the runner isolates the CLI's session and library caches to a temp dir
(`TRAINHEROIC_SESSION_FILE`/`TRAINHEROIC_CACHE_FILE`), so concurrent fan-out never clobbers and
the eval never touches your real `~/.trainheroic`.

Fan out a bank **per `(role, model, mode)` cache group**: warm the shared prefix with one
throwaway run, then burst the real queries so they read it instead of each re-writing it.
Each run is a fresh `claude -p`, but Claude Code caches its system prompt + the tool surface,
and that prefix is served across processes for ~5 min (refreshed on each read). Same
role/model/mode/cwd → byte-identical cached prefix. Backgrounding the whole bank at once is
the worst case: every process starts before any has written the prefix, so they all miss and
each pays the ~1.25× cache-write premium. The warm-up query text is arbitrary — only the
launch config decides the cached prefix — so use something that finishes in one shot and runs
no commands, and discard its output. (The CLI surface exposes only `Bash(trainheroic:*)`, so
the cached prefix is mostly Claude Code's own system prompt; cross-run savings are smaller
here than on mcp-eval's large tool block, but still real.)

```bash
role=coach model=sonnet   # one cache group (read mode shown; write mode = WRITES=1 below)
WARM="Warm-up only: reply with OK, then output the eval report with ANSWER_REACHED: no and CONFUSION_SCORE: 1. Do not run any commands."

scripts/cli-eval.sh "$role" "$WARM" "" "$model" >/dev/null 2>&1   # primes + warms the prefix; ~10-25s

# now burst the real bank — every run reads the warmed prefix
scripts/cli-eval.sh "$role" "Who's on my roster?"            "" "$model" > /tmp/c1.txt 2>/dev/null &
scripts/cli-eval.sh "$role" "Who did the most work this week?" "" "$model" > /tmp/c2.txt 2>/dev/null &
wait
```

Write mode is its own cache group — prefix `WRITES=1` on the warm-up **and** every bank line
of that group (the warm-up runs no commands, so it's a no-op even on a test account). Skip the
warm-up when a group has only **one** query — there is no second reader to amortize the write.

Compare models — same bank under each, tag the file with the model. Each model is a separate
cache group, so warm once per model inside the loop:

```bash
for m in sonnet haiku; do
  scripts/cli-eval.sh coach "$WARM" "" "$m" >/dev/null 2>&1
  scripts/cli-eval.sh coach "Who's on my roster?"            "" "$m" > "/tmp/c-roster.$m.txt" 2>/dev/null &
  scripts/cli-eval.sh coach "Who did the most work this week?" "" "$m" > "/tmp/c-work.$m.txt" 2>/dev/null &
  wait
done
```

Write eval (TEST account only):

```bash
WRITES=1 scripts/cli-eval.sh coach "Build 3x5 back squat in program 678 for tomorrow and publish it" "" haiku \
  > /tmp/cw1.haiku.txt 2>/dev/null
```

The runner needs the `claude` CLI on PATH, pnpm, and the repo `.env` (it loads it and maps
`TRAINHEROIC_ATHLETE_*` to the athlete role). Point those at your test accounts before `WRITES=1`.

## Inputs (from the skill args, all optional)
- **role**: `athlete`, `coach`, or `both` (default: both for a full eval; a quick check picks one).
- **model**: `sonnet` (default) or `haiku`, or both to compare. The runner's 4th arg.
- **mode**: `read` (default) or `write` (`WRITES=1`, TEST account only).
- **queries**: one or more questions. When none are given, use the shared bank in
  [../mcp-eval/queries.md](../mcp-eval/queries.md) for the role(s) — the questions are
  surface-agnostic, and write-task queries live in its "Write tasks" group.
- **count/scale**: how thorough. Default is the full bank per role; "quick" means 3–4 queries.

## Step 1 — sanity-check creds

A run with wrong creds is worthless. Confirm the account resolves before fanning out:

```bash
scripts/cli-eval.sh coach "Who am I and how many athletes are on my roster?" 2>/dev/null | head -40
```

For write mode, confirm you are pointed at the TEST account before setting `WRITES=1`.

## Step 2 — assemble the query set

Take the caller's queries, or the role's default bank. For a full eval, run the matrix you were
asked for: each role × each model × each mode. The runner defaults the date to today; the queries
reason about "this week" and date ranges.

## Step 3 — fan out and collect

Group the matrix by `(role, model, mode)` — that is the cache-sharing unit. For each group:
one throwaway warm-up run (see the prime-then-burst pattern above), wait for it to exit, then
background every real query in the group to its own tagged stdout file (e.g.
`/tmp/cli-eval-<role>-<model>-<mode>-<n>.txt`) and `wait`. Keep a group's burst within ~5 min
of its warm-up — each burst read refreshes the TTL, so a group that drains under 5 min stays
hot. Groups don't share cache, so their order doesn't matter. Step 1's creds sanity-check
already warms the `(role, sonnet, read)` prefix — if the bank starts within the TTL, that
group can skip its own warm-up. Then read the `===EVAL REPORT===` block out of each file. The
report format the runner emits:

```
===EVAL REPORT===
QUERY: "<the query>"
FINAL_ANSWER: <one-paragraph summary of what was concluded / done>
ANSWER_REACHED: yes | partial | no
COMMANDS (in order, one per line): <n>. trainheroic <subcommand> <key args> | outcome: <useful / empty / error / wrong-direction>
TOTAL_COMMANDS: <number>
DEAD_ENDS_AND_BACKTRACKS: <each command that did not help / wrong command / reconsideration and why>
CONFUSION_POINTS: <ambiguous or misleading command names / flags / help text / JSON output>
WHAT_WOULD_HAVE_HELPED: <concrete command/flag/help/output changes that would have been faster>
CONFUSION_SCORE: <1=effortless to 5=very confusing>
===END EVAL REPORT===
```

## Step 4 — synthesize

Collect every report and produce:
- A table keyed by query, with columns for role, model, mode, total commands, confusion score,
  and answer reached — one row per run so every cell of the matrix is visible.
- **Model delta:** where Haiku stumbled but Sonnet did not — the help/flag wording a weaker model
  couldn't lean on, the highest-value fixes. Where even Sonnet struggled is a structural problem
  (a missing command, a confusing flag), not just wording.
- **Mode delta:** confusion that only shows in write mode (unclear `--yes` requirement, ambiguous
  required flags on `workout build` / `log-set`, opaque success output after a write).
- Recurring themes — the same complaint across queries is the real signal.
- The worst runs (high command count or confusion) with their root cause.
- A prioritized fix list, each mapped to a concrete place:
  - **Help / flag / dispatch / output shape** → `packages/cli/src/cli.ts` (the `HELP` string, the
    command handlers, the `out()` JSON). Most CLI-specific findings land here.
  - **Underlying behavior / data shape** shared with the MCP tools → the SDK in
    `packages/js/src/` (fix once, both surfaces benefit). If the CLI and MCP evals surface the
    same confusion, it is almost certainly an `js` fix, not a per-surface one.
  - A missing command.
- Cross-reference the latest mcp-eval run: a confusion present in BOTH evals is a shared `js`
  problem; one present only here is CLI-surface (help/flags/output).

Offer to save the synthesis to `docs/cli-evals/<YYYY-MM-DD>.md` so runs compare over time, and
offer to implement the cheap fixes.

## Notes
- The CLI prints JSON to stdout and diagnostics to stderr; the subagent sees both. The
  FINAL_ANSWER paragraph should be plain user language; the rest of the report names commands,
  flags, and ids freely (it is for the developer).
- Write mode is for TEST accounts only and the runner gates it behind `WRITES=1`. Confirm the
  account first; never enable it against a real one.
- Scale to the ask: a quick check is 3–4 queries, one role/model/mode, single-pass synthesis; a
  thorough audit is the full bank across both roles, both models, and both modes.
