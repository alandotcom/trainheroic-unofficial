# trainheroic-2

Tooling for the (reverse-engineered) TrainHeroic coach/athlete REST API, packaged
as a Claude Code skill.

## Skill: `trainheroic-api`

Lives at `.claude/skills/trainheroic-api/`. It authenticates against TrainHeroic,
caches the session, and exposes an authenticated client plus a spec-driven workout
builder, alongside a full endpoint reference.

```
.claude/skills/trainheroic-api/
├── SKILL.md                    # entry point: auth, client usage, capability map
├── scripts/
│   ├── th_client.py            # auth + raw authenticated requests
│   └── build_workout.py        # build a session from a JSON spec (whole flow)
└── reference/
    ├── api-reference.md         # full endpoint catalog + request/response shapes
    └── workout-creation.md      # the multi-step workout build, verified caveats
```

## Auth

Credentials come from the environment:

```bash
export TRAINHEROIC_EMAIL="coach@example.com"
export TRAINHEROIC_PASSWORD="..."
```

The client logs in once, caches the session at `~/.trainheroic/session.json`
(outside this repo), and re-authenticates on expiry.

## Quick start

```bash
SKILL=.claude/skills/trainheroic-api/scripts

python3 $SKILL/th_client.py whoami
python3 $SKILL/th_client.py get /v5/athletes

# build a published session from a spec
python3 $SKILL/build_workout.py --program <calendarId> --date 2026-6-22 --replace day.json
```

See `SKILL.md` for the full usage and `reference/` for the API surface.
