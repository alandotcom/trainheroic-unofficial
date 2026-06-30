---
name: trainheroic-athlete
description: Read and analyze your own TrainHeroic training — scheduled and completed workouts, per-exercise history, PRs, working maxes, and lifetime totals — and optionally log completed sets. Use when the user wants to review their training history, track progress on a lift over time, look up PRs or working maxes, see what's programmed, export their training data, or log a workout result. Works for an athlete account or a coach account (a coach also has athlete-scoped training).
metadata:
  author: alandotcom
  version: "1.0.0"
---

# TrainHeroic Athlete API

Authenticated access to the logged-in user's **own** training through the `trainheroic`
command-line tool (`@trainheroic-unofficial/cli`), which wraps the
`@trainheroic-unofficial/js` SDK. This is the athlete surface: history, scheduled workouts,
PRs, working maxes. For coaching (rosters, teams, programming, messaging) use the
`trainheroic-unofficial` skill instead.

- Base URL: `https://api.trainheroic.com`
- Login endpoint: `https://apis.trainheroic.com/auth`

A coach account works here too: a coach login also carries athlete scope, so these commands
return the coach's own training data.

## Setup

### CLI

Verify the CLI is available, then install if missing (no credentials required):

```bash
which trainheroic || npm install -g @trainheroic-unofficial/cli
trainheroic install-skill   # refreshes skill files in ~/.claude/skills/
```

Set `TH` for the commands below:

```bash
TH="trainheroic"
```

### Credentials

Credentials come from the environment (if unset, ask the user — do not guess):

```bash
export TRAINHEROIC_EMAIL="athlete@example.com"
export TRAINHEROIC_PASSWORD="..."
```

The CLI logs in, caches the session at `~/.trainheroic/session.json`, and re-authenticates
on a 401/403. Start with `$TH athlete whoami` to confirm auth and get your `id`. Run
`$TH help` for the full command list.

## What you can do

| Goal                                  | Command                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| Lifetime totals + profile             | `$TH athlete profile [--metric]`                                               |
| Scheduled / completed workouts        | `$TH athlete workouts --start Y-M-D --end Y-M-D [--raw] [--summary]`           |
| Find an exercise you've logged        | `$TH athlete exercises [--q <text>] [--limit N]`                               |
| One lift's PRs + history over time    | `$TH athlete history <exerciseId> [--raw]`                                     |
| Personal records for a lift           | `$TH athlete prs <exerciseId>`                                                 |
| Last performance + PR as of a date    | `$TH athlete stats <exerciseId> --date Y-M-D`                                  |
| Working maxes (drive % prescriptions) | `$TH athlete working-maxes`                                                    |
| Benchmark leaderboard                 | `$TH athlete leaderboard <workoutId>`                                          |
| Download all historicals to JSON      | `$TH athlete export [--out dir] [--full]`                                      |
| Log ids for a scheduled workout       | `$TH athlete log-targets --start Y-M-D --end Y-M-D [--program <title>]`        |
| Log completed set results (gated)     | `$TH athlete log-set --date Y-M-D --set <id> ... --yes`                        |
| Log an off-plan session (gated)       | `$TH athlete log-session --date Y-M-D '[{"exerciseId":N,"sets":[...]}]' --yes` |
| Remove a stray personal session       | `$TH athlete session-remove --id <programWorkoutId> --date Y-M-D --yes`        |

## Reading training

Most analysis starts by finding the exercise id, then pulling its history:

```bash
$TH athlete exercises --q "back squat"     # -> id + title + positional units
$TH athlete history 1659830                # PRs + dated session time-series
$TH athlete stats 1659830 --date 2026-06-01
```

`history` returns a presented view (PRs plus each session's date, summary `abr`, estimated
1RM, and sets). Add `--raw` for the untouched API object.

`workouts` flattens each day into blocks and exercises with per-set prescriptions and
positional units:

```bash
$TH athlete workouts --start 2026-06-01 --end 2026-06-14
```

Add `--summary` for one compact row per session (date, title, logged flag, exercise/performed
counts) instead of every set — use it to scan a multi-week window, then re-query a single day
without it to see that day's sets. `--logged-only` keeps only sessions with logged sets;
`--limit N` returns the most recent N.

`profile` returns lifetime totals (reps, volume, sessions, first/last logged, hours) plus
the profile. Pass `--metric` for kg/metric totals.

## Exporting your history

`$TH athlete export` writes your historicals to JSON files (default
`~/.trainheroic/athlete-export`): `profile.json`, `workouts.json` (a 2-year window by
default; override with `--start`/`--end`), `exercises.json` (the catalog), and
`working-maxes.json`. Add `--full` to also fetch each exercise's history into
`history/<id>.json` — that is one request per exercise (hundreds), so it is slower.

```bash
$TH athlete export --out ./my-training            # fast: workouts, catalog, maxes, profile
$TH athlete export --out ./my-training --full     # also per-exercise history (slow)
```

## Logging a set

`$TH athlete log-set` writes completed results back to a workout (reps/weight per set),
marks the set completed, and the result shows up in your exercise history. **It is
athlete-facing**: it mutates your training log, which your coach can see, so confirm before
running and re-read the workout to check the result landed.

Get the `savedWorkoutSetId` and each `savedWorkoutSetExerciseId` from `$TH athlete log-targets`
— a compact one-row-per-set view, no raw blob to dig through. When several workouts fall on the
same day (you're on more than one program), narrow with `--program <title-substring>`:

```bash
$TH athlete log-targets --start 2026-06-01 --end 2026-06-01 --program "Bodybuilding"
$TH athlete log-set --date 2026-06-01 --set 1593305783 --yes \
  '[{"savedWorkoutSetExerciseId": 2712369448, "sets": [{"param1": 3, "param2": 225}]}]'
```

`--yes` is required. Confirm with the user before running it, and re-read the workout to
check the result landed as intended. `param1`/`param2` are the entered values by entry slot
(check the exercise's positional units first).

### Logging an off-plan session

When you trained something a coach never scheduled (accessory work, a makeup lift, an
unplanned gym session), `log-set` has no set to target. Use `log-session` instead — it
creates (or reuses) a personal session for the date, adds the exercises, and logs them in one
call. Pass the exercises array directly; get each `exerciseId` from `$TH athlete exercises`:

```bash
$TH athlete log-session --date 2026-06-21 --yes \
  '[{"exerciseId": 1, "sets": [{"param1": 5, "param2": 185}, {"param1": 5, "param2": 185}]}]'
```

Same coach-visible write and the same `--yes` gate as `log-set`. For a workout the coach
already scheduled, prefer `log-set` so it attaches to the prescription.

## Gotchas

- `profile` must send `use_metric` and `stats` must send `date`, or the API returns 400.
  The CLI fills `use_metric` (toggle with `--metric`); pass `--date` to `stats`.
- Units are **fixed per exercise** and surfaced positionally as `[param 1, param 2]` (e.g.
  `["reps", "lb"]`). They are not labelled by role: some exercises reverse the slots.
- `log-set` writes to your coach-visible log. Gate it behind explicit user confirmation,
  never run it autonomously, and verify the result. Its request shape was reverse-engineered
  from the mobile app (a two-step write: log the exercise data, then mark the set completed).
- This API is undocumented and can change. `references/athlete-api.md` lists the endpoints
  and shapes.

## Beyond the CLI

The same SDK powers the local `@trainheroic-unofficial/athlete-mcp` stdio server (the same
tools as MCP tools) and the hosted Cloudflare worker. The hosted worker adds a **training
warehouse** (D1): `athlete_workouts_sync` / `athlete_training_sync` download your
historicals, and `athlete_workouts_stored` / `athlete_training_stored` query them — so you
can research your training over time without re-hitting the API. See
`references/athlete-api.md` for the warehouse tools.
