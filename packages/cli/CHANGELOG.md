# @trainheroic-unofficial/cli

## 0.5.0

### Minor Changes

- CLI: move all coaching commands under a `coach` namespace (`coach athletes`, `coach programs`, `coach teams`, `coach exercise …`, `coach workout …`, `coach message …`), mirroring the existing `athlete` group; `whoami` and `request` stay top-level. This is a breaking change to the command surface. Add a `trainheroic skill` command that prints the bundled usage guide and copy-paste workout-spec examples to stdout (`--full` also prints the API and workout-creation reference docs), surfaced from a "Start here" pointer in `--help` and from the `coach workout build` validation error. Documentation: rewrite the SDK and workspace READMEs (install/usage examples, MCP and credential context, prerequisites) and update the coach skill to the `coach` namespace.

### Patch Changes

- @trainheroic-unofficial/dto@0.5.0
- @trainheroic-unofficial/js@0.5.0

## 0.4.2

### Patch Changes

- @trainheroic-unofficial/dto@0.4.2
- @trainheroic-unofficial/js@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies
  - @trainheroic-unofficial/js@0.4.1
  - @trainheroic-unofficial/dto@0.4.1

## 0.4.0

### Minor Changes

- 92a422f: Add first-class athlete API support, mirroring the coach offering.

  - `dto`/`js`: schemas, fetchers, and presenters for the athlete surface (profile/summary,
    scheduled + completed workouts, per-exercise history, PRs, working maxes), plus a
    set-logging write (reverse-engineered two-step PUT, verified against the live API).
  - `core`: `registerAthleteTrainingTools` — live athlete read tools and a gated
    `athlete_log_set`. (Distinct from the coach's roster `registerAthleteTools`.)
  - `athlete-mcp`: a new local stdio MCP server for an athlete account.
  - `cloudflare`: role-aware registration — every account gets the athlete surface plus a D1
    athlete history warehouse (`athlete_workouts_sync`/`_stored`,
    `athlete_training_sync`/`_stored`); coach accounts also keep the coaching surface.
  - `cli`: an `athlete` command group and `athlete export` for dumping historicals to JSON.
  - A new `trainheroic-athlete` skill.

### Patch Changes

- Updated dependencies [92a422f]
  - @trainheroic-unofficial/js@0.4.0
  - @trainheroic-unofficial/dto@0.4.0

## 0.3.0

### Patch Changes

- @trainheroic-unofficial/dto@0.3.0
- @trainheroic-unofficial/js@0.3.0
