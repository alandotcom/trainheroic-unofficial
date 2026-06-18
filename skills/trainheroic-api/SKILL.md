---
name: trainheroic-api
description: Call the TrainHeroic coach/athlete REST API to manage athletes, teams, programs, sessions, exercises, and analytics. Use when the user wants to authenticate against TrainHeroic, automate coaching tasks, build workouts or session templates, create teams/athletes/custom exercises, resolve exercise IDs, or pull training, readiness, and analytics data.
metadata:
  author: alandotcom
  version: "1.0.0"
---

# TrainHeroic API

Authenticated access to the (reverse-engineered) TrainHeroic coaching API, plus a
spec-driven workout builder and a local SQLite store (exercise cache + programming
history + message history).

- Coach base URL: `https://api.trainheroic.com`
- Login endpoint: `https://apis.trainheroic.com/auth`

## Setup

Auth reads credentials from the environment:

```bash
export TRAINHEROIC_EMAIL="coach@example.com"
export TRAINHEROIC_PASSWORD="..."
```

If they are unset, ask the user — do not guess. The client logs in, caches the
session at `~/.trainheroic/session.json` (mode 0600), reuses it until expiry, and
re-authenticates automatically on a 401/403.

## Running the scripts

The skill's scripts are stdlib-only Python (no pip installs). Set `SKILL` to
wherever this skill lives, then call them:

```bash
SKILL=skills/trainheroic-api      # or .claude/skills/trainheroic-api once installed

python3 "$SKILL/scripts/th_client.py"       whoami       # raw API client
python3 "$SKILL/scripts/library_cache.py"   resolve "Bench Press"  # local exercise store
python3 "$SKILL/scripts/programming_sync.py"             # pull programming into the store
python3 "$SKILL/scripts/messaging_sync.py"               # pull chat messages into the store
python3 "$SKILL/scripts/message_send.py"    streams      # list conversations / draft + send
python3 "$SKILL/scripts/build_workout.py"   --help       # spec-driven session builder
```

Start a session with `th_client.py whoami`: it confirms auth and returns the
coach's `id`, `org_id`, and roles that later calls reference.

## Making requests

`th_client.py <method> <path> [json-body]` — path is everything after the base URL.
It prints the JSON response and exits non-zero on any non-2xx status.

```bash
python3 "$SKILL/scripts/th_client.py" get  /v5/athletes
python3 "$SKILL/scripts/th_client.py" post /v5/teams/4677619/teamCodes '{"type": 2}'
python3 "$SKILL/scripts/th_client.py" put  /v5/athletes/archive '{"athleteIds": [123]}'
python3 "$SKILL/scripts/th_client.py" delete /v5/teamCodes/874586
cat block.json | python3 "$SKILL/scripts/th_client.py" post /2.0/coach/calendar/saveProgramWorkoutSets -
```

A few endpoints (e.g. `apis.trainheroic.com/user`) want the `api-token` header
instead of the session token — pass `--auth api-token`.

## What you can do

| Area | Key endpoints |
|------|---------------|
| Athletes | list `GET /v5/athletes`, invite `POST /v5/athletes/inviteToTeam`, archive/restore |
| Teams | list `GET /1.0/coach/teams`, create `POST /1.0/coach/team/createWithTitleAndCode`, codes under `/v5/teams/{id}/teamCodes` |
| Programs | list `GET /1.0/coach/programs`, detail `GET /3.0/coach/program/{id}`, mirror history with `programming_sync.py` |
| Exercises | resolve via `library_cache.py` (below), create `POST /2.0/coach/exercise/create` |
| Sessions / workouts | build with `build_workout.py` (below) |
| Messaging | sync chat with `messaging_sync.py`, draft/send with `message_send.py` (below) |
| Analytics | readiness, 1RM history, training summary, compliance under `/v5/analytics/*` |

Load `references/api-reference.md` when you need an endpoint's exact request or
response shape, or an area not covered above.

## Resolving exercises

Do **not** dump `GET /v5/exerciseLibrary/all` (~2,400 rows) to find an ID. Use the
cache, which mirrors the library into `~/.trainheroic/library.db` and serves
lookups locally:

```bash
python3 "$SKILL/scripts/library_cache.py" resolve "Back Squat"   # exact/best match -> id
python3 "$SKILL/scripts/library_cache.py" search  "incline press" # ranked candidates
python3 "$SKILL/scripts/library_cache.py" sync --force            # refresh the mirror
```

`resolve` exits non-zero with a candidate list when a name is ambiguous; pick the
right ID from there. The mirror auto-refreshes on a 7-day TTL and on a miss.

After creating a custom exercise, go through the cache so the mirror stays
current without a re-sync; after deleting one via the API, drop it from the mirror:

```bash
python3 "$SKILL/scripts/library_cache.py" create '{"title":"Sandbag Clean","param_1_type":3,"param_2_type":1}'
python3 "$SKILL/scripts/library_cache.py" forget 7721170   # cache-only, run after an API delete
```

`library_cache.py` is also a durable local store (SQLite at
`~/.trainheroic/library.db`): `stats` shows row counts per zone and `cursors`
shows the incremental-sync watermarks. Beyond the exercise mirror it holds a
**programming-history** zone — run `programming_sync.py` to pull a coach's
prescribed programs (standalone programs plus team group-programs) into it. Load
`references/data-warehouse.md` when working on the DB schema, adding a sync, or
querying the store — it covers the zones, the prune-vs-accumulate rule, the
`source` provenance flag, and the per-calendar month-window the sync must walk.

## Building a workout

**Confirm the program before you build, and confirm before you publish.** Writing a
session to a real coaching calendar is athlete-facing and hard to undo. When the
request is at all ambiguous — which team/program/calendar, which date, the exact
exercises, sets/reps/load, distance units, or how a scheme should be structured —
**ask clarifying follow-up questions first; do not guess.** Restate the program you
intend to build (blocks, exercises, prescriptions) and get explicit confirmation
before publishing. When in doubt, build with `--no-publish` (a draft) and show the
read-back for review rather than publishing unprompted. Only publish a new workout
once the user has confirmed the program is what they want.

Use `build_workout.py` rather than hand-assembling calls. It runs the whole
sequence (program → session → blocks → exercises → publish), fills every field
that otherwise makes the exercise step return HTTP 500, and encodes prescriptions
correctly. Feed it a JSON spec:

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

python3 "$SKILL/scripts/build_workout.py" --program 4980851 --date 2026-6-22 --replace day.json
```

Two exercises in one block become a superset. Add `"leaderboard": "rounds"` (or
`reps`/`time`/`calories`/`meters`/… or `{"unit":"time","lowest_wins":true}`) to a
block to make it a scored Red Zone leaderboard (trophy + "FOR <UNIT>"). `--replace`
deletes any existing session on that date first (idempotent re-runs); `--no-publish`
leaves a draft; `--read --pw <id>` prints a built session back to verify it.

For an **AMRAP**, score by `rounds`/`reps` and program multiple sets (one per
expected round — assume a fit athlete's count); for **"for time"**, score by `time`.
Ask the coach when the scheme or score is ambiguous rather than guessing.

Load `references/workout-creation.md` before building manually or when doing
something the builder does not cover (drop sets, pyramids, %-of-max, the raw
field list, or the parameter-type table).

## Messaging

A **stream** is a conversation (a team, or a 1:1 with an athlete); a **comment**
is a message. The store mirrors both, and sending is gated.

**Sync messages you receive** with `messaging_sync.py` into the local store's
messaging zone (`message_stream` → `message_comment`, accumulate-only):

```bash
python3 "$SKILL/scripts/messaging_sync.py"            # incremental: only new comments per stream
python3 "$SKILL/scripts/messaging_sync.py" --full     # re-pull every stream (refresh reactions/replies)
python3 "$SKILL/scripts/messaging_sync.py" 37730920   # one stream id
```

It walks every conversation and pulls comments newer than the per-stream cursor
(`sync_state('messaging', stream_id)` = the highest comment id seen), so re-runs
are cheap. Received messages are `is_author=0`; check `GET /v5/notifications/counts`
(`countMessagingNotViewed`) first as a cheap "anything new?" gate. The real-time
web channel (`adapter.trainheroic.com`) isn't needed — REST polling sees the same
messages.

**Sending is athlete-facing and immediate** — TrainHeroic chat has no server-side
draft state, so a POST is delivered at once. `message_send.py` therefore separates
drafting from sending, and you must get the user's explicit go-ahead in the moment
before sending (see Destructive actions in Gotchas):

```bash
python3 "$SKILL/scripts/message_send.py" streams                       # find the stream id
python3 "$SKILL/scripts/message_send.py" read   37730920               # recent messages
python3 "$SKILL/scripts/message_send.py" draft  37730920 "Great session today!"   # PREVIEW only — never sends
python3 "$SKILL/scripts/message_send.py" send   37730920 "Great session today!"   # actually delivers (gate behind user OK)
python3 "$SKILL/scripts/message_send.py" send   37730920 "Nice PR!" --reply-to 125652586   # threaded reply
```

Default to `draft`: it prints the exact payload and target conversation without
touching the account. Run `send` only after the user confirms the wording and
recipient. `delete <stream> <commentId>` removes a message (soft delete) and is
destructive — same gate.

## Gotchas

Environment-specific facts that defy reasonable assumptions:

- **Sending a chat message needs `feed_id` in the body** — the stream id from the
  path, repeated. `{"content": "..."}` returns `400 Invalid parameters`; so does
  trimming any field. Send the full body (`type`, `content`, `photo_url`,
  `photoUrl`, `access_level`, `parent_feed_item_id`, `feed_id`) — `message_send.py`
  does. There is **no draft state**: a POST is delivered immediately, so gate sends
  behind explicit user confirmation.

- **Units are fixed per exercise — you can't set them at prescribe time.** On save
  the API discards the `param_1_type`/`param_2_type` you send and restores the
  exercise's library defaults (the *values* are kept). So the stock `Run` (miles)
  can't be made metric; a "200 m run" on it shows as 200 *miles*. And `param_2_type`
  `2` (% of max) and `14` (RPE) coerce to weight on a weight lift, rendering as
  pounds — put % or RPE in the `instruction` (the builder does this from `rpe`).
  You *can* add weight (`1`) to a no-secondary-param lift (weighted Pull-Ups). Check
  units with `library_cache.py resolve` (`param_1_unit`/`param_2_unit`); the builder
  prints a `WARNING` when a sent type will be overridden. "Max"/"AMRAP" reps work as
  free text in the rep slots.
- **`saveWorkoutSetExercises` returns HTTP 500** unless every field is present:
  all ten `param_1_data_N`/`param_2_data_N` slots (empty string for unused),
  `set_num`, `key`, `setKey`, `eType`, `tags`, `use_count`. The builder fills
  these — prefer it over raw calls.
- **`GET /1.0/coach/programs/edit/{cal}/{y}/{m}/{d}` returns every session in that
  date's *month*** — not just the day, and not the whole calendar (other months
  come back empty). Match yours by the `id` returned at create time, not
  `programWorkouts[0]`; to read a whole program, walk month by month as
  `programming_sync.py` does.
- **A created session exposes two IDs**: `workout_id` (for adding blocks) and `id`
  (the programWorkout id, used to publish and to delete).
- **The API ignores the exercise `title` you send** and uses the real title for
  `exercise_id`; it also overrides both `param_1_type` and `param_2_type` to the
  exercise default (see the units gotcha above).
- **Response envelopes vary.** `2.0/coach/*` tag/exercise endpoints wrap data as
  `{"success": 1, "data": {...}}`; most others return bare objects/arrays.
- **This API is undocumented and can change.** `references/api-reference.md` has a
  "Still Unexplored" section listing known gaps.
- **Destructive actions always require explicit user action.** For any call that
  deletes, archives, or removes live data — archive/restore athlete, delete team,
  delete custom exercise, remove or unpublish a session, delete team code, delete a
  message — and for **sending a chat message** (athlete-facing, instant, no draft
  state) — you must:
  1. **never run it autonomously** (no destructive call without the user's explicit
     go-ahead in the moment — prior approval does not carry over to a new action);
  2. **print a clear WARNING** stating exactly what will be affected, that it acts on
     the live account, and that it is hard or impossible to undo;
  3. **offer the user the option to do it themselves** — hand them the exact command
     (e.g. `th_client.py delete /v5/teamCodes/874586`) or the UI steps, so they can
     run it rather than having you do it.
  **Publishing a new workout** is athlete-facing: confirm the program first (see
  "Building a workout") and ask clarifying questions when anything is unclear instead
  of guessing.
