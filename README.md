# trainheroic-skill

[![skills.sh](https://skills.sh/b/alandotcom/trainheroic-skill)](https://skills.sh/alandotcom/trainheroic-skill)

An [Agent Skill](https://agentskills.io/) for the TrainHeroic
coach/athlete REST API. It authenticates, caches the session, resolves exercise
IDs locally, builds and publishes workouts from a JSON spec, and ships a full
endpoint reference.

## Skill: `trainheroic-api`

Call the TrainHeroic coaching API to manage athletes, teams, programs, sessions,
exercises, and analytics.

**Use when:**

- Authenticating against TrainHeroic or automating coaching tasks
- Building workouts or session templates, or publishing to a team calendar
- Creating teams, athletes, or custom exercises
- Resolving exercise names to IDs
- Pulling readiness, 1RM, training-summary, compliance, or other analytics

## Layout

```
skills/
  trainheroic-api/
    SKILL.md                 # entry point: auth, scripts, gotchas
    scripts/
      th_client.py           # authenticated client (login, session cache, requests)
      build_workout.py       # build a session from a JSON spec (whole flow)
      library_cache.py       # local SQLite store: exercise mirror (name -> id) + sync scaffolding
    references/
      api-reference.md        # full endpoint catalog + request/response shapes
      workout-creation.md     # the multi-step workout build, with verified gotchas
      data-warehouse.md       # the local SQLite store: zones, cursors, conventions
skills.sh.json               # skills.sh repo-page grouping
```

## Install

Browse and install from the skills.sh page linked above, or copy the skill into a
project manually:

```bash
cp -R skills/trainheroic-api /path/to/project/.claude/skills/
```

(This repo keeps `.claude/skills/trainheroic-api` as a symlink to `skills/trainheroic-api`
so the skill is active when working in this repo with Claude Code.)

## Auth

Credentials come from the environment; the client caches the session at
`~/.trainheroic/session.json` (outside the repo) and re-authenticates on expiry.

```bash
export TRAINHEROIC_EMAIL="coach@example.com"
export TRAINHEROIC_PASSWORD="..."
```

## Quick start

```bash
SKILL=skills/trainheroic-api

python3 $SKILL/scripts/th_client.py whoami
python3 $SKILL/scripts/library_cache.py resolve "Back Squat"
python3 $SKILL/scripts/build_workout.py --program <calendarId> --date 2026-6-22 --replace day.json
```

See `skills/trainheroic-api/SKILL.md` for full usage and the `references/` for the
API surface.
