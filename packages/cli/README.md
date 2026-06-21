# @trainheroic-unofficial/cli

A command-line tool for the TrainHeroic coaching API. Takes credentials from the environment, prints JSON.

Part of the [trainheroic-unofficial](../../README.md) workspace.

## Contents

- [Install](#install)
- [Usage](#usage)
- [Conventions](#conventions)
- [Develop](#develop)

## Install

```bash
npm install -g @trainheroic-unofficial/cli
# or: npx @trainheroic-unofficial/cli <command>
```

Needs Node >= 18 and an existing TrainHeroic account.

## Usage

Set your TrainHeroic login in the environment (stored in plaintext and shell history — treat
it as a secret), then run a command. Every command prints JSON to stdout.

```bash
export TRAINHEROIC_EMAIL="coach@example.com"
export TRAINHEROIC_PASSWORD="..."

trainheroic whoami                                # confirm auth; prints your account
trainheroic coach exercise resolve "Back Squat"   # name -> exercise (id, units)
```

**Driving this from an AI agent?** Run `trainheroic skill` first — it prints the full
workflow guide (with copy-paste workout-spec examples) to stdout, version-matched to the
binary; `trainheroic skill --full` adds the API and workout-creation reference docs. It's the
fastest way to get the spec shapes right instead of guessing from flags.

Commands split into three groups. `whoami` and `request` are **shared** (role-agnostic).
Everything for managing a roster lives under **`coach`** — reads (`coach athletes`,
`coach programs`, `coach teams`, `coach program <id>`, …), the exercise library
(`coach exercise resolve|search|get|sync|create|forget|stats`), the workout lifecycle
(`coach workout build|read|publish|remove`), and messaging
(`coach message list|read|draft|send|delete`). Your own training lives under **`athlete`**.
Run `trainheroic` with no command for the full reference. Dates are `Y-M-D` with a 1-based
month, e.g. `2026-6-22` or `2026-06-22` for 22 June 2026.

### Building a workout

`coach workout build` reads a workout spec — a JSON file (`--file`), an inline argument, or
stdin — and writes it into a program on a date. `--program` is a program id (find it in the
program's URL in the TrainHeroic web app, or run `trainheroic coach programs`). The spec is
`{ blocks, instruction? }` (a bare blocks array is also accepted). Each exercise's `id` is a
library id; get one with `coach exercise resolve`. `reps` and `weight` take a scalar or a
per-set array (`"reps": [5, 5, 3]`); loads use the exercise's configured unit. The full schema
is `WorkoutSpec` in [`@trainheroic-unofficial/dto`](../dto).

```jsonc
// day.json — one block with one exercise (id 41822 is a library exercise id)
{
  "instruction": "Warm up first.",
  "blocks": [
    {
      "title": "Strength",
      "exercises": [{ "id": 41822, "sets": 5, "reps": 5, "weight": 225, "rpe": 8 }],
    },
  ],
}
```

```bash
# Build as a draft (988 is the program id):
trainheroic coach workout build --program 988 --date 2026-6-22 --file day.json

# Build and publish to athletes (publishing is athlete-facing, so it needs --yes):
trainheroic coach workout build --program 988 --date 2026-6-22 --file day.json --publish --yes
```

### Raw requests

For an endpoint with no dedicated command, call it directly:

```bash
trainheroic request GET /user/simple
trainheroic request POST /some/path '{"key":"value"}' --base apis
```

`--base` selects the host: `coach` (the default, `api.trainheroic.com`) or `apis`
(`apis.trainheroic.com`). The body can be inline JSON (as above) or `--file <path>`.

## Conventions

- Output is JSON on stdout; errors go to stderr with a non-zero exit code and a readable
  validation path on bad input.
- Actions that touch an athlete or delete data require an explicit `--yes`:
  `coach workout publish`, `coach workout remove`, `coach exercise forget`,
  `coach message send`, `coach message delete`, `athlete log-set`, and
  `coach workout build --publish`. (`coach workout build` alone creates a draft; `--publish`
  makes it visible to athletes, which is why that combination needs `--yes`.)
- JSON input can be passed inline, with `--file <path>`, or piped on stdin. Inputs are
  validated against the shared schemas from `@trainheroic-unofficial/dto` before sending.
- The session token and the exercise library are cached under `~/.trainheroic/`. The library
  file matches the shape the local coach server (`@trainheroic-unofficial/coach-mcp`) writes,
  so the CLI and that server share one cache.

## Develop

Run `pnpm install` once at the repo root (Node >= 24, pnpm 10), then from this package. During
development, run from source with `pnpm start <args>`; after `pnpm build`, the `trainheroic`
binary (`dist/cli.mjs`) does the same.

```bash
pnpm start whoami   # tsx src/cli.ts
pnpm build          # tsdown -> dist/cli.mjs
pnpm typecheck
pnpm test
pnpm exec vitest run test/parse.test.ts
```
