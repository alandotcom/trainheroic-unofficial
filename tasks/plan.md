# Implementation Plan: 100% in-scope API coverage

## Overview

Wrap every remaining in-scope TrainHeroic endpoint that already has a documented or
live-probed path, using the reverse-engineer loop in
[`.agents/skills/reverse-engineer-api/SKILL.md`](../.agents/skills/reverse-engineer-api/SKILL.md).
Living inventory:
[`.agents/skills/reverse-engineer-api/coverage.md`](../.agents/skills/reverse-engineer-api/coverage.md).

**100% coverage** means each in-scope row is either **SDK + MCP + CLI + tests**, or sits
under **Closed without a wrap** with probe evidence. Marketplace stays out of scope.
Closed rows (program update, working-max write, per-team remove, …) are not wrap work
unless a new HAR appears; Phase 6 is one discovery pass to try to reopen them.

Do not invent a raw-request tool. Destructive tools use `confirmGate`. Thin GETs may use
the existing `SIMPLE_GETS` / `apiCall` pattern; writes with bodies or id-resolution go
through `js`. Exercise-library writes go through `ExerciseIndex` (both `ExerciseLibrary`
and D1 `ExerciseStore`).

## Architecture Decisions

- **Vertical slice = one endpoint (or one CRUD family)** through dto → js → core → CLI →
  tests → eval catalog → website `TOOL_SUMMARIES` → `coverage.md`. Copy
  `program_delete` / `list_session_templates` / `exercise_delete`.
- **Thin GETs** (notifications list, subscriptions, orgs, features, activity feed,
  reactions, circuits, programming programs, recent exercises, prescription templates,
  coachAthleteTeam): typed SDK getter when the path needs a user id or shaping;
  otherwise `SIMPLE_GETS` + CLI command, matching `list_session_templates`.
- **Exercise update** writes through `ExerciseIndex.update` (new), same as create/delete,
  so the local/D1 mirror stays coherent. Reuse `exerciseCreateSchema` fields.
- **Empty live payloads** (`[]` on the test athlete): still wrap. Pin schemas with a
  stubbed fixture plus an empty-list test. Do not invent fields.
- **Session template create**: live-probe `title` (+ optional `instructions`) first. If
  the API 400s, capture a HAR from the UI before wrapping. Distinct from
  `session_save_as_template` (save-from-session).
- **Out of scope stays closed**: marketplace catalog, whole-workout `savedworkout` PUT,
  `apis.trainheroic.com/user` (different auth).

## Task List

Tasks will be filed as GitHub issues after this plan is approved (project tracker:
`docs/agents/issue-tracker.md`). Until then this file is the ordered index.

### Phase 1: Finish CRUD families (P0/P1 writes)

- [ ] **Task 1: Custom exercise update**
- [ ] **Task 2: Session-template library create + delete**

### Checkpoint: CRUD

- [ ] `pnpm fmt` on touched packages
- [ ] Focused vitest in js/core/eval (+ cloudflare exercise-store if Task 1)
- [ ] Live throwaway exercise/template created, updated/deleted, cleaned up
- [ ] `coverage.md` rows moved to Implemented

### Phase 2: Athlete reads (P1/P2, already probed 200)

- [ ] **Task 3: Circuit history** (`GET /v5/users/circuits/{recent,history}`)
- [ ] **Task 4: Subscribed programs** (`GET /1.0/athlete/programming/programs`)
- [ ] **Task 5: Recent exercises** (`GET /v5/users/exercises/recent`)

### Checkpoint: Athlete reads

- [ ] Athlete MCP + CLI commands return JSON (empty list is success)
- [ ] eval `canonical.ts` / `fake-backend.ts` routes exist
- [ ] Review with human before P2 coach writes

### Phase 3: Coach reads + auto-publish (P2)

- [ ] **Task 6: Notifications list** (`GET /v5/notifications`)
- [ ] **Task 7: Program subscriptions** (`GET /1.0/coach/subscriptions`)
- [ ] **Task 8: Prescription templates** (`GET /2.0/coach/workoutSetExercise/template`)
- [ ] **Task 9: Coach-athlete-team calendar** (`GET /v5/calendars/athletes/{id}/coachAthleteTeam`)
- [ ] **Task 10: Team auto-publish** (`POST /1.0/coach/team/updatePublishSettings`)

### Checkpoint: Coach P2

- [ ] `notifications` (counts) still distinct from the new list tool
- [ ] Auto-publish gated (`confirmGate`) — athlete-facing
- [ ] Focused tests + `pnpm fmt`

### Phase 4: P3 dashboard / meta reads

- [ ] **Task 11: Feature flags + orgs** (`GET /v5/users/{id}/features`, `GET /v5/coaches/orgs`)
- [ ] **Task 12: Activity feed + reaction catalog** (`GET /v5/coaches/activityFeed`, `GET /v5/messaging/reactions`)

### Checkpoint: Wrap gaps empty

- [ ] **Remaining wrap gaps** table in `coverage.md` has zero rows
- [ ] `pnpm check` (or fmt + lint + typecheck + focused tests)

### Phase 5: Discovery pass (closed rows)

- [ ] **Task 13: HAR/probe pass on closed unknowns**

### Checkpoint: Complete

- [ ] Every in-scope row is Implemented or Closed without a wrap
- [ ] Changeset(s) cover publishable packages
- [ ] Ready for review

---

## Task 1: Custom exercise update

**Description:** Wrap `POST /2.0/coach/exercise/update/{id}` so a coach can rename/retarget
a custom exercise. Same body as create. Live-probe first with a **full** create payload
(the sparse `{title, param_*_type}` body 500'd). Write through `ExerciseIndex` so the
mirror updates.

**Acceptance criteria:**
- [ ] `index.update(id, body)` on `ExerciseLibrary` and D1 `ExerciseStore`
- [ ] MCP `exercise_update` (additive write, no `confirmGate`)
- [ ] CLI `coach exercise update` validates with `exerciseCreateSchema` (plus id)
- [ ] Stubbed tests pin method/path/body and mirror write-through

**Verification:**
- [ ] `cd packages/js && pnpm exec vitest run test/exercise-index.test.ts`
- [ ] `cd packages/core && pnpm exec vitest run test/confirm-gate.test.ts` (not added to destructive table)
- [ ] Live: create throwaway custom exercise → update title → delete

**Dependencies:** None

**Files likely touched:**
- `packages/js/src/exercise-index.ts`, `packages/db/src/stores/exercises.ts`
- `packages/core/src/tools/exercises.ts`, `packages/cli/src/cli.ts`
- tests + eval catalog + website `mcp-tool-catalog.ts`

**Estimated scope:** Medium

## Task 2: Session-template library create + delete

**Description:** Wrap `POST /v5/sessions/template` and `DELETE /v5/sessions/template/{id}`.
List already exists (`list_session_templates`). Create is not `session_save_as_template`
(that copies an existing session). Probe create with `title` / `instructions`; delete is
destructive.

**Acceptance criteria:**
- [ ] SDK create + delete methods; delete uses `confirmGate` on MCP and `--yes` on CLI
- [ ] MCP `session_template_create` / `session_template_delete`
- [ ] Live probe pins create body; if 400, stop and HAR the UI rather than guessing
- [ ] Fake-backend records the write paths

**Verification:**
- [ ] Focused js + core vitest
- [ ] Live: create throwaway template → list includes it → delete → list does not

**Dependencies:** None (parallel with Task 1)

**Files likely touched:**
- `packages/js/src/coach.ts` or `workout-session.ts`
- `packages/core/src/tools/workout.ts`, `packages/cli/src/cli.ts`
- eval + website catalog

**Estimated scope:** Medium

## Task 3: Circuit history

**Description:** Wrap `GET /v5/users/circuits/recent` and `GET /v5/users/circuits/history`
for the logged-in athlete. Test account returned `[]`. Circuit *blocks* in `workout_build`
are already type 1.

**Acceptance criteria:**
- [ ] SDK getters + MCP read tool(s) + CLI
- [ ] Empty list is a valid success
- [ ] Schema tolerates the exercise-history-like shape from the api-reference note

**Verification:**
- [ ] Unit tests with `[]` and one fixture row
- [ ] `athlete` CLI command prints JSON array

**Dependencies:** None

**Files likely touched:** `packages/js/src/athlete.ts`, `packages/core/src/tools/athlete-training.ts`, CLI, eval, website

**Estimated scope:** Medium

## Task 4: Subscribed programs

**Description:** Wrap `GET /1.0/athlete/programming/programs` (probed 200 `[]`).

**Acceptance criteria:**
- [ ] MCP + CLI read; empty list is success
- [ ] Description tells the model this is the athlete's subscribed programs, not `list_programs`

**Verification:** focused vitest + CLI

**Dependencies:** None (parallel with Tasks 3 and 5)

**Files likely touched:** athlete.ts, athlete-training.ts, CLI, eval, website

**Estimated scope:** Small–Medium

## Task 5: Recent exercises

**Description:** Wrap `GET /v5/users/exercises/recent`. Distinct from per-exercise history.

**Acceptance criteria:**
- [ ] MCP + CLI read; empty list is success
- [ ] Does not replace `athlete_exercise_history`

**Verification:** focused vitest + CLI

**Dependencies:** None

**Files likely touched:** athlete.ts, athlete-training.ts, CLI, eval, website

**Estimated scope:** Small–Medium

## Task 6: Notifications list

**Description:** Wrap `GET /v5/notifications`. Keep existing `notifications` tool on
`/v5/notifications/counts` (cheap unread poll). New tool is the full list.

**Acceptance criteria:**
- [ ] New tool name (e.g. `list_notifications`) — do not overload `notifications`
- [ ] Probed 200 `[]`; empty is success

**Verification:** core reads test if present; CLI `coach notifications-list` or similar

**Dependencies:** None

**Files likely touched:** `packages/core/src/tools/reads.ts`, CLI, eval, website

**Estimated scope:** Small

## Task 7: Program subscriptions

**Description:** Wrap `GET /1.0/coach/subscriptions` (probed 200 `{subscriptions,teams}`).

**Acceptance criteria:**
- [ ] SDK or SIMPLE_GET + MCP + CLI
- [ ] dto loose object for `{subscriptions, teams}`

**Verification:** stubbed response test

**Dependencies:** None (parallel with 6/8/9)

**Files likely touched:** reads.ts or coach.ts, CLI, dto, eval, website

**Estimated scope:** Small–Medium

## Task 8: Prescription templates

**Description:** Wrap `GET /2.0/coach/workoutSetExercise/template`. Live account had 18
rows; shape is documented in api-reference. GET only in this task (create/update/delete
of prescription templates is unknown — do not invent).

**Acceptance criteria:**
- [ ] MCP + CLI list
- [ ] Fixture matches the documented `{id,title,type,param_1_type,…}` row

**Verification:** dto parse of the api-reference example + MCP tool

**Dependencies:** None

**Files likely touched:** reads.ts or coach.ts, dto, CLI, eval, website

**Estimated scope:** Medium

## Task 9: Coach-athlete-team calendar

**Description:** Wrap `GET /v5/calendars/athletes/{id}/coachAthleteTeam` as a companion
to the existing type-5 calendar fetch.

**Acceptance criteria:**
- [ ] Takes athlete id; documented as companion to `fetchCoachAthleteCalendar`
- [ ] MCP + CLI

**Verification:** stubbed GET path includes the athlete id

**Dependencies:** None

**Files likely touched:** `packages/js/src/coach-athlete-calendar.ts`, core calendar/reads tools, CLI

**Estimated scope:** Medium

## Task 10: Team auto-publish

**Description:** Wrap `POST /1.0/coach/team/updatePublishSettings`. Docs say it takes the
full program object with `pub_*` fields. Athlete-facing — `confirmGate`. Live-probe by
GETting a team program then POSTing with a no-op (same settings) on a throwaway team.

**Acceptance criteria:**
- [ ] SDK method; MCP gated; CLI `--yes`
- [ ] Probe pins required fields; do not guess `pub_*` names
- [ ] Throwaway team cleaned up

**Verification:** js request body test + core confirm-gate table row

**Dependencies:** None, but probe before coding the body

**Files likely touched:** coach.ts, teams tools, CLI, eval fake-backend write route

**Estimated scope:** Medium

## Task 11: Feature flags + orgs

**Description:** Wrap `GET /v5/users/{id}/features` and `GET /v5/coaches/orgs`.

**Acceptance criteria:**
- [ ] Features uses the logged-in user id (or explicit id)
- [ ] Orgs is a SIMPLE_GET
- [ ] MCP + CLI for both

**Verification:** stubbed tests

**Dependencies:** Phase 3 checkpoint (human review of P3 value is fine to skip these if
product-useless — then move to Closed as out of scope rather than wrapping)

**Files likely touched:** reads.ts, athlete/coach CLI, eval, website

**Estimated scope:** Medium (two thin GETs)

## Task 12: Activity feed + reaction catalog

**Description:** Wrap `GET /v5/coaches/activityFeed` (paginated) and
`GET /v5/messaging/reactions` (7 reactions on test account).

**Acceptance criteria:**
- [ ] Activity feed accepts page/pageSize
- [ ] Reactions is a catalog read (not sending a reaction)
- [ ] MCP + CLI

**Verification:** stubbed tests; reactions fixture length 7 optional

**Dependencies:** Same P3 skip option as Task 11

**Files likely touched:** reads.ts, messaging.ts maybe, CLI, eval, website

**Estimated scope:** Medium

## Task 13: HAR/probe pass on closed unknowns

**Description:** One live-probe + optional HAR session against the official UI for rows
currently **Closed without a wrap**. Wrap only if a real method/path/body is captured;
otherwise leave closed.

Hunt list: working-max write, program title/settings update, per-team athlete remove,
workout set reorder / move exercises, coach prefs write, notification mark-read/dismiss.
Do not chase marketplace or `apis…/user`.

**Acceptance criteria:**
- [ ] Each hunt item has a dated probe note in `coverage.md` (still closed, or moved to wrap)
- [ ] Any newly found path starts a new vertical slice rather than expanding this task

**Verification:** probe script deleted; no secrets committed

**Dependencies:** Tasks 1–12 preferred first so wrap gaps are empty

**Files likely touched:** `coverage.md` only, unless a path is found

**Estimated scope:** Medium (probe-only) / then new tasks if something is found

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Exercise create 500s on sparse body, blocking update probe | High | Use the full `exerciseCreateSchema` payload; delete throwaway after |
| Session template create body is richer than `title`/`instructions` | High | Fail closed on 400; HAR the UI; do not invent block JSON |
| Athlete GETs always `[]` on the test account | Med | Wrap anyway; loose schemas; fixture from api-reference |
| `updatePublishSettings` wants a full program blob | High | GET-then-POST no-op on a throwaway team; pin `pub_*` from the live GET |
| P3 tools add noise to the MCP surface | Med | Human checkpoint after Phase 3; may close features/orgs/feed/reactions as out of scope |
| Closed writes actually exist in the mobile app only | Low | Phase 6 HAR; if mobile-only, stay closed |

## Open Questions

- Keep P3 dashboard reads (features, orgs, activity feed, reactions) in scope for 100%, or
  close them as out of scope after Phase 3?
- File one GitHub issue per task (tracker convention) or one tracking issue with this checklist?
- Start Phase 1 on this branch, or land the current commit as a PR first?
