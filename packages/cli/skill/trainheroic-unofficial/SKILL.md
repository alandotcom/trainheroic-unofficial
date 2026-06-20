---
name: trainheroic-unofficial
description: Call the TrainHeroic coach/athlete REST API to manage athletes, teams, programs, sessions, exercises, and analytics. Use when the user wants to authenticate against TrainHeroic, automate coaching tasks, build workouts or session templates, create teams/athletes/custom exercises, resolve exercise IDs, or pull training, readiness, and analytics data.
metadata:
  author: alandotcom
  version: "2.0.0"
---

# TrainHeroic API

Authenticated access to the TrainHeroic coaching API through the `trainheroic`
command-line tool (`@trainheroic-unofficial/cli`), which wraps the `@trainheroic-unofficial/js`
SDK: a spec-driven workout builder, an on-disk exercise cache, and gated messaging.

- Coach base URL: `https://api.trainheroic.com`
- Login endpoint: `https://apis.trainheroic.com/auth`

## Setup

### CLI

Before making API calls, verify the CLI is available:

```bash
which trainheroic
```

If not found, install it (no credentials required):

```bash
npm install -g @trainheroic-unofficial/cli
trainheroic install-skill   # also refreshes skill files in ~/.claude/skills/
```

To update to the latest version:

```bash
npm update -g @trainheroic-unofficial/cli
trainheroic install-skill   # pick up any updated skill files
```

Set `TH` to the binary name for the commands below:

```bash
TH="trainheroic"
```

### Credentials

Credentials come from the environment (if unset, ask the user — do not guess):

```bash
export TRAINHEROIC_EMAIL="coach@example.com"
export TRAINHEROIC_PASSWORD="..."
```

The CLI logs in, caches the session at `~/.trainheroic/session.json` (mode 0600),
reuses it across invocations, and re-authenticates automatically on a 401/403. The
exercise library is cached at `~/.trainheroic/library.json`.

Start a session with `$TH whoami`: it confirms auth and returns the coach's `id`,
`org_id`, and roles that later calls reference. Run `$TH help` for the full command list.

## Making requests

`$TH request <METHOD> <path> [json-body]` — path is everything after the base URL. It
prints `{status, ok, data}` and exits non-zero on failure. Bodies can be an inline JSON
argument, `--file <path>`, or piped on stdin.

```bash
$TH request GET  /v5/athletes
$TH request POST /v5/teams/4677619/teamCodes '{"type": 2}'
$TH request PUT  /v5/athletes/archive '{"athleteIds": [123]}'
$TH request DELETE /v5/teamCodes/874586
cat block.json | $TH request POST /2.0/coach/calendar/saveProgramWorkoutSets
```

A few endpoints live on the login host (`apis.trainheroic.com`); reach them with
`--base apis` (the default base is the coach host). Named shortcuts cover the common
reads: `whoami`, `head-coach`, `athletes`, `programs`, `teams`, `notifications`,
`analytics`, `program <id>`, `team <id>`, `team-codes <id>`.

Load `references/api-reference.md` when you need an endpoint's exact request or
response shape, or an area not covered here.

## What you can do

| Area                | How                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Athletes            | `$TH athletes`; invite/archive/restore via `$TH request ...`                                                              |
| Teams               | `$TH teams`, `$TH team <id>`, `$TH team-codes <id>`; create via `$TH request POST /1.0/coach/team/createWithTitleAndCode` |
| Programs            | `$TH programs`, `$TH program <id>`                                                                                        |
| Exercises           | `$TH exercise resolve\|search\|get\|sync\|create\|forget\|stats` (below)                                                  |
| Sessions / workouts | `$TH workout build\|read\|publish\|remove` (below)                                                                        |
| Messaging           | `$TH message list\|read\|draft\|send\|delete` (below)                                                                     |
| Analytics           | `$TH analytics`, then `$TH request POST /v5/analytics/*`                                                                  |

## Resolving exercises

Do **not** dump `GET /v5/exerciseLibrary/all` (~2,400 rows) to find an ID. Use the
cache, which mirrors the library into `~/.trainheroic/library.json` and serves lookups
locally:

```bash
$TH exercise resolve "Back Squat"      # exact/best match -> id (+ unit labels)
$TH exercise search  "incline press"   # ranked candidates
$TH exercise sync --force              # refresh the mirror (7-day TTL otherwise)
```

`resolve` returns `match: null` plus a candidate list when a name is ambiguous; pick the
right ID from there. The mirror auto-refreshes on a 7-day TTL and on a miss.

After creating a custom exercise, go through the cache so the mirror stays current; after
deleting one via the API, drop it from the mirror:

```bash
$TH exercise create '{"title":"Sandbag Clean","param_1_type":3,"param_2_type":1}'
$TH exercise forget 7721170 --yes      # cache-only, run after an API delete
```

`$TH exercise stats` shows the cached row count.

## Building a workout

**Confirm the program before you build, and confirm before you publish.** Writing a
session to a real coaching calendar is athlete-facing and hard to undo. When the request
is at all ambiguous — which team/program/calendar, which date, the exact exercises,
sets/reps/load, distance units, or how a scheme should be structured — **ask clarifying
follow-up questions first; do not guess.** Restate the program you intend to build and get
explicit confirmation before publishing. Build a draft (the default), show the read-back
for review, and only publish once the user confirms.

`$TH workout build` runs the whole sequence (program → session → blocks → exercises),
fills every field that otherwise makes the exercise step return HTTP 500, encodes
prescriptions correctly, and prints unit advisories plus a read-back. Feed it a JSON spec
(inline, `--file`, or stdin):

```bash
cat > day.json <<'JSON'
{ "blocks": [
  { "title": "Primary Press", "exercises": [
    { "id": 1162, "title": "Bench Press", "reps": [10,10,8,8], "rpe": 8 } ] },
  { "title": "Accessory", "instruction": "Superset", "exercises": [
    { "id": 903, "title": "Dips", "sets": 3, "reps": 12, "rpe": 8 },
    { "id": 6535, "title": "Tricep Pushdown", "reps": [15,15,15], "rpe": 8 } ] }
] }
JSON

$TH workout build --program 4980851 --date 2026-6-22 --file day.json     # draft
$TH workout publish --pw <id> --yes                                       # publish after review
```

The build defaults to a **draft** (unpublished). Add `--publish --yes` to publish in one
step, or publish later with `$TH workout publish --pw <id> --yes`. Read a built session
back with `$TH workout read --program <id> --date Y-M-D --pw <id>`. There is no in-place
replace: to rebuild a date, remove the old session first with
`$TH workout remove --program <id> --pw <id> --yes`.

Two exercises in one block become a superset. Add `"leaderboard": "rounds"` (or
`reps`/`time`/`calories`/`meters`/… or `{"unit":"time","lowest_wins":true}`) to a block to
make it a scored Red Zone leaderboard (trophy + "FOR <UNIT>"). A top-level `"instruction"`
in the spec sets the session's Coach Instructions (the day-note above the blocks;
`PUT /3.0/coach/workout/{id}`, applied after the blocks save and without publishing — a
draft stays a draft). The read-back shows it under "Coach Instructions". For an **AMRAP**,
score by `rounds`/`reps` and program multiple sets (one per expected round); for **"for
time"**, score by `time`. Ask the coach when the scheme or score is ambiguous rather than
guessing.

Load `references/workout-creation.md` before building manually or for something the builder
does not cover (drop sets, pyramids, %-of-max, the raw field list, or the parameter-type
table).

## Messaging

A **stream** is a conversation (a team, or a 1:1 with an athlete); a **comment** is a
message. Sending is athlete-facing and immediate — TrainHeroic chat has no server-side
draft state, so a POST is delivered at once. The CLI therefore separates drafting from
sending and requires `--yes` to actually send or delete.

```bash
$TH message list                                  # conversations (id, kind, title)
$TH message read   37730920                        # recent messages
$TH message draft  37730920 "Great session today!" # PREVIEW only — never sends
$TH message send   37730920 "Great session today!" --yes              # delivers (gate behind user OK)
$TH message send   37730920 "Nice PR!" --reply-to 125652586 --yes     # threaded reply
$TH message delete 37730920 <commentId> --yes                          # soft delete (destructive)
```

Default to `draft`: it prints the exact payload and target without touching the account.
Run `send` only after the user confirms the wording and recipient. Check
`$TH notifications` (`countMessagingNotViewed`) first as a cheap "anything new?" gate.

## Gotchas

Environment-specific facts that defy reasonable assumptions:

- **Sending a chat message needs `feed_id` in the body** — the stream id from the path,
  repeated. `{"content": "..."}` returns `400 Invalid parameters`; so does trimming any
  field. The CLI sends the full body. There is **no draft state**: a POST is delivered
  immediately, so gate sends behind explicit user confirmation (`--yes`).
- **Units are fixed per exercise — you can't set them at prescribe time.** On save the API
  discards the `param_1_type`/`param_2_type` you send and restores the exercise's library
  defaults (the _values_ are kept). So the stock `Run` (miles) can't be made metric; a
  "200 m run" on it shows as 200 _miles_. And `param_2_type` `2` (% of max) and `14` (RPE)
  coerce to weight on a weight lift, rendering as pounds — put % or RPE in the
  `instruction` (the builder does this from `rpe`). You _can_ add weight (`1`) to a
  no-secondary-param lift (weighted Pull-Ups). Check units with `$TH exercise resolve`
  (the `units` array, ordered by entry slot `[param 1, param 2]`); the builder prints a
  warning when a sent type will be overridden. "Max"/"AMRAP" reps work as free text in the
  rep slots.
- **`saveWorkoutSetExercises` returns HTTP 500** unless every field is present: all ten
  `param_1_data_N`/`param_2_data_N` slots (empty string for unused), `set_num`, `key`,
  `setKey`, `eType`, `tags`, `use_count`. The builder fills these — prefer it over raw calls.
- **`GET /1.0/coach/programs/edit/{cal}/{y}/{m}/{d}` returns every session in that date's
  _month_** — not just the day, and not the whole calendar. Match yours by the `id`
  returned at create time, not `programWorkouts[0]`; to read a whole program, walk month by
  month.
- **A created session exposes two IDs**: `workout_id` (for adding blocks) and `id` (the
  programWorkout id, used to publish and to delete; the CLI calls it `pw`).
- **The API ignores the exercise `title` you send** and uses the real title for
  `exercise_id`; it also overrides both `param_1_type` and `param_2_type` to the exercise
  default (see the units gotcha above).
- **Response envelopes vary.** `2.0/coach/*` tag/exercise endpoints wrap data as
  `{"success": 1, "data": {...}}`; most others return bare objects/arrays.
- **This API is undocumented and can change.** `references/api-reference.md` has a "Still
  Unexplored" section listing known gaps.
- **Destructive actions always require explicit user action.** For any call that deletes,
  archives, or removes live data — archive/restore athlete, delete team, delete custom
  exercise, remove or unpublish a session, delete team code, delete a message — and for
  **sending a chat message** (athlete-facing, instant, no draft state) — you must:
  1. **never run it autonomously** (no destructive call without the user's explicit
     go-ahead in the moment — prior approval does not carry over to a new action);
  2. **print a clear WARNING** stating exactly what will be affected, that it acts on the
     live account, and that it is hard or impossible to undo;
  3. **offer the user the option to do it themselves** — hand them the exact command (e.g.
     `$TH request DELETE /v5/teamCodes/874586`) or the UI steps.

  The CLI enforces a `--yes` flag on `message send`/`message delete`, `workout publish`,
  `workout remove`, and `exercise forget`, but the gate above still applies: confirm in the
  moment before adding `--yes`.

## Beyond the CLI

The same SDK powers two MCP servers (see `README.md`):
`@trainheroic-unofficial/coach-mcp` (local, single-user, stdio) and
`@trainheroic-unofficial/cloudflare` (hosted, multi-tenant). The hosted server adds a
programming/messaging history warehouse (D1); `references/data-warehouse.md` documents
those zones and the sync rules.
