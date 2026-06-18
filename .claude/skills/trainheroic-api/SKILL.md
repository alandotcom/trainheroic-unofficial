---
name: trainheroic-api
description: Call the TrainHeroic coach/athlete REST API to manage athletes, teams, programs, sessions, exercises, and analytics. Use when the user wants to authenticate against TrainHeroic, automate coaching tasks, build workouts or session templates, create teams/athletes/custom exercises, or pull training and readiness data.
---

# TrainHeroic API

Reverse-engineered REST API for the TrainHeroic coaching platform. This skill
provides an authenticated client plus a full endpoint reference.

- Coach base URL: `https://api.trainheroic.com`
- Login endpoint: `https://apis.trainheroic.com/auth`

## Setup

Auth needs the user's TrainHeroic credentials in the environment:

```
export TRAINHEROIC_EMAIL="coach@example.com"
export TRAINHEROIC_PASSWORD="..."
```

If those are unset, ask the user to provide them rather than guessing. The client
logs in, caches the session at `~/.trainheroic/session.json` (mode 0600), reuses
it until it expires, and re-logs-in automatically on expiry or a 401/403.

## Making requests

Use the bundled client (stdlib Python, no dependencies). Paths are everything
after the base URL.

```bash
SKILL_DIR=.claude/skills/trainheroic-api

python3 $SKILL_DIR/scripts/th_client.py whoami
python3 $SKILL_DIR/scripts/th_client.py get  /v5/athletes
python3 $SKILL_DIR/scripts/th_client.py post /v5/teams/4677619/teamCodes '{"type": 2}'
python3 $SKILL_DIR/scripts/th_client.py put  /v5/athletes/archive '{"athleteIds": [123]}'
python3 $SKILL_DIR/scripts/th_client.py delete /v5/teamCodes/874586
```

A large JSON body can come from stdin with `-`:

```bash
cat block.json | python3 $SKILL_DIR/scripts/th_client.py post \
  /2.0/coach/calendar/saveProgramWorkoutSets -
```

The client prints the JSON response and exits non-zero on any non-2xx status.
A handful of endpoints (notably `apis.trainheroic.com/user`) authenticate with the
`api-token` header instead of the session token; reach those with
`--auth api-token`.

Run `whoami` first when starting; it confirms auth works and returns the coach's
`id`, `org_id`, and roles, which other calls reference.

## What you can do

| Area | Key endpoints |
|------|---------------|
| Athletes | list `GET /v5/athletes`, invite `POST /v5/athletes/inviteToTeam`, archive/restore |
| Teams | list `GET /1.0/coach/teams`, create `POST /1.0/coach/team/createWithTitleAndCode`, access codes under `/v5/teams/{id}/teamCodes` |
| Programs | list `GET /1.0/coach/programs`, detail `GET /3.0/coach/program/{id}` |
| Exercises | library `GET /v5/exerciseLibrary/all`, create `POST /2.0/coach/exercise/create` |
| Sessions / workouts | the multi-step build flow (see below) |
| Analytics | readiness, 1RM history, training summary, compliance under `/v5/analytics/*` |

For the complete endpoint catalog with request/response shapes, read
`reference/api-reference.md`.

## Building a workout

Build sessions with `scripts/build_workout.py` rather than hand-assembling the
calls. It drives the full sequence (program → session → blocks → exercises →
publish), fills every field that otherwise makes the exercise step return HTTP
500, and encodes prescriptions correctly. Give it a JSON spec:

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

python3 $SKILL_DIR/scripts/build_workout.py --program 4980851 --date 2026-6-22 --replace day.json
```

Two exercises in one block become a superset. `--replace` deletes any existing
session on that date first (so re-runs are idempotent); `--no-publish` leaves a
draft; `--read --pw <id>` prints a built session back.

RPE rule, baked into the builder: an exercise's `rpe` goes into its `instruction`
text, never a structured param. Setting `param_2_type: 14` (RPE) is silently
overridden to weight on any lift whose library default is weight, so the RPE
numbers would render as pounds. Use `weight: [...]` only when you want a real
prescribed load.

For the underlying step-by-step flow, the required-field list, the parameter-type
table, and patterns (supersets, drop sets, pyramids, bodyweight), see
`reference/workout-creation.md`.

## Notes

- IDs chain between steps. Capture the ID a call returns before making the next
  call that depends on it.
- Some response envelopes wrap data as `{"success": 1, "data": {...}}` (the
  `2.0/coach/*` tag and exercise endpoints); others return bare objects/arrays.
- This is an undocumented, reverse-engineered API. Endpoints can change, and the
  `reference/api-reference.md` "Still Unexplored" section lists gaps. Treat
  destructive calls (archive, delete team, delete exercise) carefully and confirm
  with the user before running them.
