---
name: mcp-eval
description: Evaluate the TrainHeroic MCP's usability by having subagents (Sonnet or Haiku) answer real athlete/coach questions through the tools across every surface and tool — reads and, on a test account, writes — then synthesize where they got confused or burned turns. Use when asked to eval/benchmark/stress-test the MCP, check how an agent navigates the tools, compare models, or measure turns/confusion for tool-description tuning. Defaults to the local stdio servers.
---

# MCP eval

Measure how well a model navigates the TrainHeroic MCP. Each run answers a realistic question
using only the MCP tools, reports its tool trace and confusion in a fixed format, then a
synthesis pass turns that into prioritized tool-description/shape fixes.

Two axes to sweep:

- **Model.** Default is **Sonnet**; also run **Haiku**. A weaker model leans harder on the tool
  names and descriptions, so where Haiku stumbles but Sonnet sails through is exactly the wording
  the descriptions need to carry. Diffing the same bank across both models is the strongest
  signal for description tuning.
- **Surface + tools.** Eval **every surface** (local athlete, local coach, hosted) and **every
  tool, not just reads**. Reads are the default; write evals run against a TEST account (see
  Write mode), where logging, building, publishing, and messaging really fire — that exercises
  the half of the tool surface a read-only eval never touches. (The CLI is a fourth surface,
  evaluated by the planned `cli-eval` skill — build it once the CLI command surface settles.)

The tools are defined once in `packages/core` and reused by every server, so a local eval
exercises the same tool surface a user hits on the hosted worker, without a deploy. Default to
local; reach for hosted to catch worker-only behavior (the D1 sync tools, OAuth-scoped role
gating) the local servers don't have.

## The runner: `scripts/mcp-eval.sh`

This is the path. `scripts/mcp-eval.sh <athlete|coach> "<query>" [YYYY-MM-DD] [model]` runs ONE
query through a fresh headless `claude -p` subprocess that spawns its OWN stdio server from a
generated config. Because each run is a new process, it always loads the CURRENT source — no
reconnect, and no dependency on this session's pinned MCP connection (the running stdio servers
cache the code they booted with, so in-session edits are invisible to them until restart; the
runner sidesteps that). It prints the model's answer followed by the `===EVAL REPORT===` block.

- **Model:** 4th arg (default `sonnet`); `MODEL=` env works too. Pass an empty date to keep
  today and still set the model: `scripts/mcp-eval.sh athlete "..." "" haiku`.
- **Read-only (default):** read/query tools are whitelisted; every write tool is whitelisted out
  and explicitly denied. Safe to run against any account.
- **Write mode:** set `WRITES=1` to ALSO allow the write tools. Use this ONLY on a TEST account —
  the destructive tools really fire. The subagent is told it's a disposable account, may carry
  out the task for real, should pass `confirm:true` where a tool gates on it (there is no
  interactive prompt headless), and should reverse its own test writes (unpublish/delete/restore)
  where it can.

Fan out a bank **per `(role, model, mode)` cache group**: warm the shared prefix with one
throwaway run, then burst the real queries so they read it instead of each re-writing it.
Each run is a fresh `claude -p`, but Claude Code caches its system prompt + the role's tool
schemas, and that prefix is served across processes for ~5 min (refreshed on each read).
Same role/model/mode/cwd → byte-identical cached prefix. Backgrounding the whole bank at
once is the worst case: every process starts before any has written the prefix, so they all
miss and each pays the ~1.25× cache-write premium. The warm-up query text is arbitrary —
only the launch config decides the cached prefix — so use something that finishes in one
shot and calls no tools, and discard its output.

```bash
role=athlete model=sonnet   # one cache group (read mode shown; write mode = WRITES=1 below)
WARM="Warm-up only: reply with OK, then output the eval report with ANSWER_REACHED: no and CONFUSION_SCORE: 1. Do not call any tools."

scripts/mcp-eval.sh "$role" "$WARM" "" "$model" >/dev/null 2>&1   # primes + warms the prefix; ~10-25s

# now burst the real bank — every run reads the warmed prefix
scripts/mcp-eval.sh "$role" "Did I record anything this week?"     "" "$model" > /tmp/e1.txt 2>/dev/null &
scripts/mcp-eval.sh "$role" "What are my working maxes right now?" "" "$model" > /tmp/e2.txt 2>/dev/null &
wait
```

Write mode is its own cache group — prefix `WRITES=1` on the warm-up **and** every bank line
of that group (the warm-up calls no tools, so it's a no-op even on a test account). Skip the
warm-up when a group has only **one** query — there is no second reader to amortize the write.

Compare models — same bank under each, tag the file with the model. Each model is a separate
cache group, so warm once per model inside the loop:

```bash
for m in sonnet haiku; do
  scripts/mcp-eval.sh athlete "$WARM" "" "$m" >/dev/null 2>&1
  scripts/mcp-eval.sh athlete "Did I record anything this week?"     "" "$m" > "/tmp/e1.$m.txt" 2>/dev/null &
  scripts/mcp-eval.sh athlete "What are my working maxes right now?" "" "$m" > "/tmp/e2.$m.txt" 2>/dev/null &
  wait
done
```

Write eval (TEST account only) — tag the file with the mode too:

```bash
WRITES=1 scripts/mcp-eval.sh coach "Log 5x5 at 185 for athlete 12345 on today's session" "" haiku \
  > /tmp/w1.haiku.txt 2>/dev/null
```

The runner needs the `claude` CLI on PATH and the repo `.env` (coach/athlete creds) that the
generated config's launcher (`scripts/mcp-eval-server.sh`) reads. That launcher maps
`TRAINHEROIC_ATHLETE_*` to the athlete server, so point those at your test athlete account.

## Inputs (from the skill args, all optional)
- **role**: `athlete`, `coach`, or `both` (default: sweep both for a full eval; a quick check
  can pick one). Selects which server(s) and query bank(s).
- **model**: `sonnet` (default) or `haiku`, or both to compare. The runner's 4th arg.
- **mode**: `read` (default) or `write` (`WRITES=1`, TEST account only).
- **target**: `local` (default) or `hosted`. Hosted has no runner — see "Hosted / in-session".
- **queries**: one or more questions. When none are given, use the bank in
  [queries.md](queries.md) for the role(s).
- **count/scale**: how thorough. Default is the full bank per role; "quick" means 3–4 queries.

## Step 1 — sanity-check creds

A run with no live tools (or wrong creds) is worthless. Before fanning out, do one cheap read to
confirm the account resolves:

```bash
scripts/mcp-eval.sh athlete "Who is the logged-in account?" 2>/dev/null | head -40
```

For coach, ask "Who am I and how many athletes are on my roster?". For write mode, also confirm
you are pointed at the TEST account, not a real one, before setting `WRITES=1`.

## Step 2 — assemble the query set

Take the caller's queries, or the role's default bank from [queries.md](queries.md). For a full
eval, run the matrix you were asked for: each role × each model × each mode you're covering. Note
the real current date — the queries reason about "this week" and date ranges, and the runner
defaults the date to today.

## Step 3 — fan out and collect

Group the matrix by `(role, model, mode)` — that is the cache-sharing unit. For each group:
one throwaway warm-up run (see the prime-then-burst pattern above), wait for it to exit, then
background every real query in the group to its own tagged stdout file (e.g.
`/tmp/eval-<role>-<model>-<mode>-<n>.txt`) and `wait`. Keep a group's burst within ~5 min of
its warm-up — each burst read refreshes the TTL, so a group that drains under 5 min stays hot.
Groups don't share cache, so their order doesn't matter. Step 1's creds sanity-check already
warms the `(role, sonnet, read)` prefix — if the bank starts within the TTL, that group can
skip its own warm-up. Then read the `===EVAL REPORT===` block out of each file. The report
format the runner emits:

```
===EVAL REPORT===
QUERY: "<the query>"
FINAL_ANSWER: <one-paragraph summary of what was concluded / done>
ANSWER_REACHED: yes | partial | no
TOOL_CALLS (in order, one per line): <n>. <tool_name> | args: <key args> | outcome: <useful / empty / error / wrong-direction>
TOTAL_TOOL_CALLS: <number>
DEAD_ENDS_AND_BACKTRACKS: <each unhelpful call / wrong tool / reconsideration and why>
CONFUSION_POINTS: <ambiguous or misleading tool names/descriptions>
WHAT_WOULD_HAVE_HELPED: <concrete tool name/description/param changes that would have been faster>
CONFUSION_SCORE: <1=effortless to 5=very confusing>
===END EVAL REPORT===
```

### Hosted / in-session variant

The runner only spawns local stdio servers. To eval the **hosted** worker, or to measure this
session's own deferred-tool / ToolSearch friction, spawn an in-session subagent instead:
`subagent_type: general-purpose`, set its `model` to the model under test, and send the prompt
template below (substitute the tool prefix, the real date, the query, and read-vs-write
constraints). Hosted tools are `mcp__claude_ai_Trainheroic__*` (role-aware; a coach account also
exposes the coach tools); confirm the claude.ai TrainHeroic integration is connected first.
There is no dedicated eval subagent — a plain `general-purpose` agent takes any model and either
mode, which the old pinned `mcp-eval-runner` (sonnet + read-only only) could not.

#### In-session prompt template

```
You are role-playing a general AI assistant connected to the TrainHeroic MCP. Its tools are
named {TOOL_PREFIX}* and their schemas are deferred — load them with ToolSearch first (e.g.
ToolSearch query "trainheroic", or "select:{TOOL_PREFIX}athlete_workouts"). Use whatever
TrainHeroic tools you need.

CONTEXT: Today's date is {TODAY}. Answer as if for the account owner.

{CONSTRAINTS}
  read mode  -> HARD CONSTRAINTS — read-only: never call a tool that writes, logs, creates,
                modifies, deletes, sends, publishes, archives, or confirms anything. Only
                read/query/list ops. If answering would need a write, note it in the report
                instead of doing it.
  write mode -> MODE — write eval against a TEST account: you MAY use write tools to carry out
                the task for real. Pass confirm:true where a tool gates on it. Reverse your own
                test writes (unpublish/delete/restore) where you can. Do not touch data you did
                not create unless the task requires editing it.

YOUR TASK: Answer/do this as naturally and correctly as you can, grounded in real tool results.
Work like a real assistant — explore, recover from dead ends, do not give up early:
"{QUERY}"

Then output a delimited report in EXACTLY the ===EVAL REPORT=== format above. Be brutally
honest — its purpose is to find MCP usability problems. Name tools, params, and ids freely in
the report (that section is for the developer); keep the FINAL_ANSWER paragraph in plain app
language.
```

## Step 4 — synthesize

Collect every report and produce:
- A table keyed by query, with columns for role, model, mode, total tool calls, confusion score,
  and answer reached — one row per run so every cell of the matrix is visible.
- **Model delta:** where Haiku stumbled but Sonnet did not (more turns, lower answer-reached,
  extra confusion). Those gaps are the descriptions a weaker model could not lean on — the
  highest-value wording fixes. A spot where even Sonnet struggled is a structural/shape problem,
  not just wording.
- **Mode/surface delta:** confusion that only shows up in write mode (e.g. ambiguous confirm
  gating, unclear required params on create/build/publish) or only on the hosted surface (the D1
  sync tools). Read-only evals never surface these.
- Recurring confusion themes — the same complaint across queries is the real signal, more than
  any single run.
- The worst runs (high turns or confusion) with their root cause.
- A prioritized fix list. Map each fix to a concrete place: a tool description in
  `packages/core/src/tools/`, the hosted sync tools in `packages/cloudflare/src/tools/`, a
  presenter in `packages/js/src/athlete.ts`, or a missing tool. Separate cheap description edits
  from shape/new-tool work. If a tool repeatedly forces `raw:true` to get at data, that is a
  presenter gap to fix in `js`, not a description tweak.

Offer to save the synthesis to `docs/mcp-evals/<YYYY-MM-DD>.md` so runs compare over time, and
offer to implement the cheap fixes.

## Notes
- The subagents speak to the user in app terms and hide tool names, per the server instructions —
  but the EVAL REPORT section is for the developer, so it names tools and ids freely. That split
  is intended.
- Write mode is for TEST accounts only and the runner gates it behind `WRITES=1`. Never enable it
  against a real account; confirm the account first.
- Scale to the ask: a quick check is 3–4 queries, one role/model/mode, single-pass synthesis; a
  thorough audit is the full bank across both roles, both models, and both modes, plus a second
  round aimed at whatever the first round flagged.
