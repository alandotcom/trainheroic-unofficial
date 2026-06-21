---
name: mcp-eval
description: Evaluate the TrainHeroic MCP's usability by having Sonnet subagents answer real athlete/coach questions through the tools, then synthesize where they got confused or burned turns. Use when asked to eval/benchmark/stress-test the MCP, check how an agent navigates the tools, or measure turns/confusion for tool-description tuning. Targets the local stdio server by default.
---

# MCP eval

Measure how well a model navigates the TrainHeroic MCP. Each run spawns Sonnet subagents that
answer realistic questions using only the MCP tools, report their tool trace and confusion in a
fixed format, then a synthesis pass turns that into prioritized tool-description/shape fixes.

The tools are defined once in `packages/core` and reused by every server, so an eval against the
**local** stdio server exercises the same surface a user hits on the hosted worker, without a
deploy. Default to local.

## Inputs (from the skill args, all optional)
- **target**: `local` (default) or `hosted`. `local` uses the project's stdio servers;
  `hosted` uses the deployed worker's `mcp__claude_ai_Trainheroic__*` tools.
- **role**: `athlete` (default) or `coach`. Selects which local server and which queries.
- **queries**: one or more questions to test. When none are given, use the bank in
  [queries.md](queries.md) for the chosen role.
- **count/scale**: how thorough. Default is the full default bank for the role; "quick" means
  3–4 queries.

## Step 1 — get the target connected

Resolve the tool prefix first with `ToolSearch` (query `trainheroic`). The prefix depends on
target and role:
- **local + athlete**: `mcp__trainheroic-local__athlete_*`.
- **local + coach**: `mcp__trainheroic-local-coach__*` (the coach surface — `list_athletes`,
  teams, programming, analytics, exercise resolution, messaging — has no `athlete_` prefix).
- **hosted**: `mcp__claude_ai_Trainheroic__*` (role-aware; a coach account also exposes the
  coach tools).

If the chosen target's tools are not present:
- **local**: the repo ships `.mcp.json` with two servers — `trainheroic-local` (athlete) and
  `trainheroic-local-coach` (coach) — both via `scripts/mcp-eval-server.sh`, which reads creds
  from `.env` (or the environment) and maps `TRAINHEROIC_ATHLETE_*` to the athlete server.
  Claude Code only connects a project MCP server after the user trusts it, so tell the user to
  approve the relevant server (the trust prompt, `/mcp`, or a session restart), then re-invoke.
  Do not try to spawn the server yourself — subagents can only reach servers the session has
  connected.
- **hosted**: confirm the claude.ai TrainHeroic integration is connected; if not, ask the user
  to connect it.

Stop here if the target cannot be reached. A run with no live tools is worthless.

Sanity-check the connection with one cheap read (`athlete_whoami`) before fanning out, so a
broken session fails fast instead of failing across every subagent.

## Step 2 — assemble the query set

Take the caller's queries, or the role's default bank. Note the real current date (from the
environment) — the subagents need it to reason about "this week" and date ranges.

## Step 3 — fan out, one subagent per query

Spawn the subagents in a single message so they run in parallel. Prefer
`subagent_type: mcp-eval-runner` — that custom agent bakes in `model: sonnet`, the read-only
rules, and the EVAL REPORT format, so the per-query prompt only needs three lines:

```
TOOL PREFIX: {TOOL_PREFIX}     (e.g. mcp__trainheroic-local__ or mcp__trainheroic-local-coach__)
TODAY'S DATE: {TODAY}
QUERY: "{QUERY}"
```

Run them in the background (`run_in_background: true`) when there are several, so completions
notify as they finish and you can work in parallel; collect and synthesize once they are all in.

If `mcp-eval-runner` is not available (e.g. it was just created and the session hasn't picked it
up), fall back to `subagent_type: general-purpose`, `model: sonnet`, and send the full template
below instead — substitute the tool prefix, the real current date, and the question. Either way
the read-only constraints are mandatory: the servers expose live write tools and this eval must
never write to a real account.

### Subagent prompt template (fallback)

```
You are role-playing a general AI assistant connected to the TrainHeroic MCP. Its tools are
named {TOOL_PREFIX}* and their schemas are deferred — load them with ToolSearch first (e.g.
ToolSearch query "trainheroic", or "select:{TOOL_PREFIX}athlete_workouts"). Use whatever
TrainHeroic tools you need.

CONTEXT: Today's date is {TODAY}. Answer as if for the account owner.

HARD CONSTRAINTS — this is an evaluation, stay strictly read-only:
- Never call a tool that writes, logs, creates, modifies, deletes, sends, publishes, archives,
  or confirms anything. Athlete write tools include athlete_log_set, athlete_session_create,
  athlete_session_add_exercises. Coach write tools include anything that creates/renames a
  team, athlete, exercise, or workout; publishes/unpublishes; sends or deletes a message; or
  archives/removes. If answering would require a write, do not do it — note that in your report
  instead.
- Only read/query/list operations are allowed.

YOUR TASK: Answer this question as naturally and correctly as you can, grounded in real tool
results. Work like a real assistant — explore, recover from dead ends, do not give up early:
"{QUERY}"

Then output a delimited report for the MCP developer in EXACTLY this format:

===EVAL REPORT===
QUERY: "{QUERY}"
FINAL_ANSWER: <one-paragraph summary of what you concluded for the user>
ANSWER_REACHED: yes | partial | no
TOOL_CALLS (in order, one per line): <n>. <tool_name> | args: <key args> | outcome: <useful / empty / error / wrong-direction>
TOTAL_TOOL_CALLS: <number>
DEAD_ENDS_AND_BACKTRACKS: <each tool call that did not help, wrong tool picked, or reconsideration — and why>
CONFUSION_POINTS: <where tool names/descriptions were ambiguous or misleading>
WHAT_WOULD_HAVE_HELPED: <concrete tool name/description/param changes that would have been faster>
CONFUSION_SCORE: <1=effortless to 5=very confusing>
===END EVAL REPORT===

Be brutally honest in the report — its purpose is to find MCP usability problems.
```

## Step 4 — synthesize

Collect every report and produce:
- A table: query, total tool calls, confusion score, answer reached.
- Recurring confusion themes (group the same complaint across queries — that is the real
  signal, more than any single run).
- The worst runs (high turns or confusion) with their root cause.
- A prioritized fix list. Map each fix to a concrete place: a tool description in
  `packages/core/src/tools/`, the hosted sync tools in `packages/cloudflare/src/tools/`, a
  presenter in `packages/js/src/athlete.ts`, or a missing tool. Separate cheap description
  edits from shape/new-tool work.
- If a tool repeatedly forces `raw:true` to get at data, treat that as a presenter gap to fix
  in `js`, not a description tweak.

Offer to save the synthesis to `docs/mcp-evals/<YYYY-MM-DD>.md` so runs can be compared over
time, and offer to implement the cheap fixes.

## Notes
- The subagents speak to the user in app terms and hide tool names, per the server
  instructions — but the EVAL REPORT section is for the developer, so it names tools and ids
  freely. That split is intended.
- Reads only. If a query genuinely needs a write to answer, the run should report that as a
  gap, never perform it.
- Scale to the ask: a quick check is 3–4 queries with single-pass synthesis; a thorough audit
  is the full bank plus a second round of queries aimed at whatever the first round flagged.
