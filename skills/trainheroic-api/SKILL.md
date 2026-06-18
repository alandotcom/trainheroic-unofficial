---
name: trainheroic-api
description: Call the TrainHeroic coach/athlete REST API to manage athletes, teams, programs, sessions, exercises, and analytics. Use when the user wants to authenticate against TrainHeroic, automate coaching tasks, build workouts or session templates, create teams/athletes/custom exercises, resolve exercise IDs, or pull training, readiness, and analytics data.
metadata:
  author: alandotcom
  version: "1.0.0"
---

# TrainHeroic API

Authenticated access to the (reverse-engineered) TrainHeroic coaching API, plus a
spec-driven workout builder and a local exercise-library cache.

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

python3 "$SKILL/scripts/th_client.py"     whoami         # raw API client
python3 "$SKILL/scripts/library_cache.py" resolve "Bench Press"   # name -> id
python3 "$SKILL/scripts/build_workout.py" --help        # spec-driven session builder
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
| Programs | list `GET /1.0/coach/programs`, detail `GET /3.0/coach/program/{id}` |
| Exercises | resolve via `library_cache.py` (below), create `POST /2.0/coach/exercise/create` |
| Sessions / workouts | build with `build_workout.py` (below) |
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

`library_cache.py` is also a durable local store (SQLite at
`~/.trainheroic/library.db`): `stats` shows row counts per zone and `cursors`
shows the incremental-sync watermarks. Beyond the exercise mirror it scaffolds a
programming-data schema. Load `references/data-warehouse.md` when working on the
DB schema, adding a sync, or querying the store — it covers the zones, the
prune-vs-accumulate rule, the `source='seed'` convention, and what the API cannot
provide (performance history has no write path).

## Building a workout

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

Two exercises in one block become a superset. `--replace` deletes any existing
session on that date first (idempotent re-runs); `--no-publish` leaves a draft;
`--read --pw <id>` prints a built session back to verify it.

Load `references/workout-creation.md` before building manually or when doing
something the builder does not cover (drop sets, pyramids, %-of-max, the raw
field list, or the parameter-type table).

## Gotchas

Environment-specific facts that defy reasonable assumptions:

- **RPE is not a structured param.** `param_2_type: 14` (RPE) is silently
  overridden to weight on any lift whose library default is weight, so RPE values
  render as pounds. Put RPE in the exercise `instruction` and leave load blank.
  The builder does this from an exercise's `rpe`.
- **`saveWorkoutSetExercises` returns HTTP 500** unless every field is present:
  all ten `param_1_data_N`/`param_2_data_N` slots (empty string for unused),
  `set_num`, `key`, `setKey`, `eType`, `tags`, `use_count`. The builder fills
  these — prefer it over raw calls.
- **`GET /1.0/coach/programs/edit/{cal}/{y}/{m}/{d}` returns the whole calendar**,
  not just that date. Its `programWorkouts` is every session; match yours by the
  `id` returned at create time, not `programWorkouts[0]`.
- **A created session exposes two IDs**: `workout_id` (for adding blocks) and `id`
  (the programWorkout id, used to publish and to delete).
- **The API ignores the exercise `title` you send** and uses the real title for
  `exercise_id`; it may also override `param_2_type` from the exercise default.
- **Response envelopes vary.** `2.0/coach/*` tag/exercise endpoints wrap data as
  `{"success": 1, "data": {...}}`; most others return bare objects/arrays.
- **This API is undocumented and can change.** `references/api-reference.md` has a
  "Still Unexplored" section listing known gaps.
- **Confirm before destructive calls** (archive athlete, delete team, delete
  exercise, remove/unpublish session) — these act on the user's live account.
