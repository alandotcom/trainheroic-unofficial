# Eval — coach `prescribe_athlete_set` / `coach prescribe-set` (2026-06-22)

Model: **Haiku**. Mode: **write** (`WRITES=1`), coach role, local servers. Test account
(coach "A Cohen", real athlete "alan test" = 2858055). Focus: the new per-athlete
prescription override, across both the MCP and CLI surfaces, twice each plus one deliberately
vague query.

## Harness bug found and fixed first

The MCP runner (`scripts/mcp-eval.sh`) leaked the host environment into the headless subagent,
so the eval was not measuring the MCP surface:

- Built-in tools (Bash, Read, ToolSearch) stayed in the toolset; under `--permission-mode
  default` they prompted and **stalled headless** instead of failing closed. One run tried to
  run `scripts/mcp-eval.sh` itself; another shelled out to `pnpm --filter cli`.
- cwd was the repo root, so the subagent loaded the project `CLAUDE.md` (which documents the
  CLI and the eval scripts) and therefore "knew the CLI exists".
- A first attempted fix (`--tools ""`) disabled the MCP tools too, leaving the model with
  nothing — it hallucinated a fake `get_athletes` tool and a roster of 22 (real answer: 4).

Fix applied: hard-**deny** the built-in tools by name (`--disallowed-tools Bash Read Edit Write
NotebookEdit Glob Grep WebFetch WebSearch Task TodoWrite ToolSearch`) and add
`--setting-sources user` so the project `CLAUDE.md` no longer loads. MCP tools still come from
`--mcp-config` + `--strict-mcp-config`. Also added the two shipped coach write tools that were
missing from the write allowlist: `swap_athlete_exercise` and `prescribe_athlete_set`. After the
fix a roster read is one clean `list_athletes` call, correct answer, no Bash/CLI/ToolSearch.

## Results (post-fix)

| Surface | Query | Calls | Confusion | Reached | Write fired |
|---|---|---|---|---|---|
| MCP | explicit: 185 lb target only | 4 | 1 | yes | yes (made/completed = 0 verified) |
| MCP | "prescribe weights", 5×225 | 4 | 2 | yes | yes |
| MCP | vague: "prescribe a weight for an athlete for their workout" | 4 | 1 | yes | yes |
| CLI | explicit: 185 lb target only | 7 | 2 | yes | yes |
| CLI | "prescribe weights", 5×225 | 8 | 2 | yes | yes |

The chain is the same every time: `list_athletes` → `athlete_saved_workouts --log-ids` (raw) →
`prescribe_athlete_set` (confirm:true) → read-back to verify. The tool name maps directly to the
intent — even the vague query and the weaker model went straight to it with no dead ends.

## Findings

1. **CLI `resultsJson` shape was not discoverable (both CLI runs).** Both first tried a flat
   `[{"param1":X,"param2":Y}]` array, errored, then corrected to the nested
   `[{"savedWorkoutSetExerciseId":N,"sets":[...]}]`. The error message was clear enough that each
   recovered in one retry (hence confusion 2, not higher). **Fixed:** added a `resultsJson:`
   example line to both `coach prescribe-set` and `coach log-set` help (same shape, log-set's
   help lacked it too).

2. **Sets-array replacement semantics (MCP run 2).** "Does one set in the array replace all
   prescribed sets, or just the first?" The full-replacement contract was documented but the
   per-set-count question was not. **Fixed:** the `prescribe_athlete_set` description now says
   "pass one sets[] entry per prescribed set … the sets you pass become the whole prescription".

3. **`param1`/`param2` opacity.** Generic param names; the descriptions already spell out
   reps/weight, and no run failed on it. Left as-is.

4. **`athlete_saved_workouts` raw output is verbose/nested (pre-existing).** Every run needed
   `raw:true` to get the ids and then parsed a deep structure. This is a presenter gap in
   `packages/js/src/athlete.ts`, not specific to prescribe — out of scope here, noted for a
   future `--log-ids`-style flattened coach view.

## Verdict

`prescribe_athlete_set` / `coach prescribe-set` are highly discoverable (confusion 1–2 on Haiku)
and the write fires correctly end-to-end with the set left un-done. The cheap description fixes
from findings 1–2 are applied.
