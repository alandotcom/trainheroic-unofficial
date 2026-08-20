# TrainHeroic API coverage

Status key: **SDK** = typed method in `js`; **MCP** = tool in `core`; **CLI** = `trainheroic`
command; **tests** = stubbed unit coverage. Hosted warehouse tools are Cloudflare-only.

Canonical workflow: [SKILL.md](SKILL.md). Durable copy for agents:
[`docs/agents/api-coverage.md`](../../../docs/agents/api-coverage.md) (pointer).

Source for paths: `packages/cli/skill/trainheroic-unofficial/references/api-reference.md`
and `packages/cli/skill/trainheroic-athlete/references/athlete-api.md`.

Recent discovery that drove this inventory: [PR #104](https://github.com/alandotcom/trainheroic-unofficial/pull/104)
(`POST /1.0/coach/programs/create` + standalone `get_program` id split). Open issue:
[#13](https://github.com/alandotcom/trainheroic-unofficial/issues/13) (OAuth device flow, not an API gap).

**100% coverage** means every in-scope row is either **SDK + MCP + CLI + tests**, or moved
to [Closed without a wrap](#closed-without-a-wrap) with probe evidence. Marketplace stays
out of scope.

## Remaining wrap gaps

None. In-scope endpoints are wrapped (2026-08-16) or listed under Closed without a wrap.

## Closed without a wrap

Probed or decided. Do not re-wrap unless a new HAR finds a path. 100% coverage treats
these as done (closed), not as open gaps.

| Endpoint | Role | Why closed |
| --- | --- | --- |
| Working-max write (coach or athlete) | both | Read exists (`GET /2.0/athlete/workingMax`); set/update never found |
| Program update (title/settings) | coach | PUT `/v5/programs/{id}` is DELETE-only; update patterns 405/404 |
| Athlete remove from a team | coach | Archive exists; per-team remove not found |
| Notification mark-read / dismiss | coach | Prior probes 401/404 |
| `apis.trainheroic.com/user` (`api-token`) | both | Different auth header; not the session-token client |
| Workout set reorder / move exercises | coach | Path never found |
| Library settings, coach prefs write | coach | Prefs GET 200; writes 403/405 historically |
| `PUT /1.0/athlete/savedworkout/{id}` | athlete | Skip — per-set logging is enough |
| `GET /v5/programs/{,new,free,fixed}` | coach | Marketplace catalog — out of scope |
| `GET /v5/users/{id}/features` | both | Feature flags — out of scope |
| `GET /v5/coaches/orgs` | coach | Orgs list — out of scope |
| `GET /v5/coaches/activityFeed` | coach | Dashboard feed — out of scope |
| `GET /v5/messaging/reactions` | coach | Reaction catalog — out of scope |

Re-open a closed row only with a captured HAR (method, path, body) from the official UI.

## Implemented (do not re-wrap)

Coach reads: `/user/simple`, `/v5/headCoach`, `/1.0/coach/programs`, `/3.0/coach/program/{id}`,
`/v5/notifications/counts`, `/v5/analytics`, `/v5/athletes`, `/1.0/coach/teams`,
`/v5/teams/{id}`, `/v5/teams/{id}/teamCodes`, `/v5/exerciseLibrary/all`,
`/v5/calendars/athletes/{id}`, `/2.0/coach/athlete/calendar/summary/…`,
`/3.0/coach/athlete/programworkout/range/{id}`, `/v5/athleteProfile/summary`,
`/v5/exercises/{id}/history`, `/v5/messaging/streams` (+ comments), `/v5/users/{id}`,
`GET /1.0/coach/workouts` (`list_session_templates`), `GET /v5/notifications`,
`GET /1.0/coach/subscriptions`, `GET /2.0/coach/workoutSetExercise/template`,
`GET /v5/calendars/athletes/{id}/coachAthleteTeam`.

Coach writes: program create/delete; team create/update/delete/auto-publish; team codes;
athlete invite/archive/restore; exercise create/update/delete; workout build/publish/unpublish/copy/remove/save-as-template;
session-template library create/delete; session note `PUT /3.0/coach/workout/{id}`;
log/prescribe/swap for athlete; messaging send/delete;
analytics POSTs (readiness, 1RM, training-summary, compliance, lift-progress, working-max-history).

Athlete: whoami/profile/prefs/working-maxes/workouts/log-targets/exercises/recent-exercises/circuits/programming-programs/history/PRs/stats/leaderboard;
personal session create/add/remove; log/prescribe/swap set; ad-hoc log session.

Wrapped 2026-08-16 (not gaps): `DELETE /v5/programs/{programId}` (`program_delete`),
`DELETE /v5/exercises/{id}` (`exercise_delete`), `GET /1.0/coach/workouts`
(`list_session_templates`), `POST /2.0/coach/exercise/update/{id}` (`exercise_update`),
`POST`/`DELETE /v5/sessions/template` (`session_template_create` / `session_template_delete`),
athlete circuits / programming programs / recent exercises, notifications list, subscriptions,
prescription templates, coach-athlete-team calendar, team auto-publish.

## Notes

- `list_programs[].id` is a **container**; `group_program` is the **programId** `get_program` needs (#104).
- Circuit *blocks* in `workout_build` are type 1 (done). Circuit *history* GETs are wrapped
  (`athlete_circuits`).
- `exercise_forget` does not call TrainHeroic. `exercise_delete` is the live delete.
- `session_save_as_template` copies an existing session. Library create/delete
  (`POST`/`DELETE /v5/sessions/template`) are `session_template_create` / `session_template_delete`.
- Auto-publish (`team_publish_settings`) GETs `GET /3.0/coach/program/{id}` then POSTs the
  full program object with `pub_*` merged — a partial body 500s.
