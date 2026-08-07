---
name: live-api-probe
description: >-
  Live-probe the undocumented TrainHeroic API with the SDK against a real .env
  account (API archaeology). Use when verifying a request shape, reproducing a
  500/401, checking coach vs athlete / personal_cal vs team calendar behavior,
  dumping raw edit-GET responses, or confirming a fix against production before
  shipping. Not for MCP/CLI usability evals — those are mcp-eval / cli-eval.
---

# Live API probe

Discover what TrainHeroic actually returns. Fixtures and the fake backend cannot
answer undocumented shapes; a **probe** can.

This is **API archaeology**, not agent usability. For model-driven tool/CLI
evals see [mcp-eval](../mcp-eval/SKILL.md) / [cli-eval](../cli-eval/SKILL.md).

## Preconditions

- Repo-root `.env` with `TRAINHEROIC_EMAIL` / `TRAINHEROIC_PASSWORD` (optional
  `TRAINHEROIC_ATHLETE_*`). File is gitignored.
- Prefer a **trial / test** coach account. Writes are real.
- Never print credentials or full `.env`. Redact emails in reports when possible.

## Recipe

Every probe run follows this loop. Done = falsifiable claim answered **and**
cleanup finished **and** temp script gone.

1. **State the claim.** One sentence the live API can confirm or deny
   (e.g. "text-only Circuit block keeps `instruction` and has no real exercises
   on edit-GET").
2. **Pick a disposable calendar.** Create or reuse a throwaway team
   (`coach team-create`) for coach writes. Far-future dates reduce clutter.
3. **Write a one-shot script** under `packages/js/scripts/` (gitignored or
   deleted before commit — never leave probes in the tree). Prefer SDK exports
   from `@trainheroic-unofficial/js` over inventing routes.
4. **Run it** from repo root:
   ```bash
   set -a && source .env && set +a
   CI=true pnpm --filter @trainheroic-unofficial/js exec tsx scripts/<probe>.mts
   ```
   Wrap the body in `async function main` (tsx `-e` is CJS; no top-level await).
5. **When read-back looks wrong, dump raw.** `GET /1.0/coach/programs/edit/{programId}/{y}/{m}/{d}`
   before trusting `readSession`. UI placeholder rows often have `id: null`.
6. **Clean up.** Remove every session/team/personal workout the probe created
   (`removeSession`, `removePersonalWorkout`, `coach team-delete --yes`).
7. **Delete the script.** Report findings; fold durable lessons into code/docs,
   not into a permanent probe file.

## Calendar map

| Target | How to get an id | Coach `createWorkoutForDay` |
|--------|------------------|-----------------------------|
| Team / group program | `team-create` → `programId` / `group_program` | Works |
| Own personal calendar | `createPersonalWorkout` → day's `program_id` | Works (self) |
| Another athlete's Coach Plan / `personal_cal` | Roster athlete with Coach Plan | Typically HTTP 500 — the #75/#76 gap |

`personal.groupId` from `createPersonalWorkout` is **not** the same as the day's
`program_id`. Use `program_id` from `fetchAthleteWorkouts` when probing self.

Demo/seeded athletes are often on a team program (`personal_cal: false`), not
Coach Plan — they will not reproduce other-athlete personal_cal failures.

## Gotchas

- **Hosts.** Athlete range is `/3.0/athlete/programworkout/range` on the default
  coach host via SDK helpers. Guessing `/v5/...` on the wrong host → 404.
- **Phantom exercises.** Coach edit-GET may return a null-id empty exercise on
  text-only Circuit / Conditioning blocks (type 1). Filter phantoms on read-back;
  skip POSTing `[]` to `saveWorkoutSetExercises`.
- **`CI=true`.** pnpm may try to purge `node_modules` without a TTY; set `CI=true`.
- **Smart-mode / secret gates.** Live credentialed commands may need user
  approval in Cursor — retry with the approval flow rather than inventing a
  credential-free path that cannot answer the claim.
- **Leftovers.** If a probe crashes mid-write, re-fetch the date range and
  remove before ending the session.

## Report shape

Keep the user-facing summary short:

- Claim → pass / fail
- Ids used (program, pwId) and whether cleaned
- Raw vs SDK discrepancy, if any
- What to change in code/docs (or "no code change; API gap → issue N")
