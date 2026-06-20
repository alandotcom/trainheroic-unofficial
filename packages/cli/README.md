# @trainheroic-unofficial/cli

A command-line tool for the TrainHeroic coaching API. Takes credentials from the environment, prints JSON.

Part of the [trainheroic-unofficial](../../README.md) workspace.

## Install

```bash
npm install -g @trainheroic-unofficial/cli
# or: npx @trainheroic-unofficial/cli <command>
```

## Usage

```bash
export TRAINHEROIC_EMAIL="coach@example.com"
export TRAINHEROIC_PASSWORD="..."

trainheroic whoami
trainheroic exercise resolve "Back Squat"
trainheroic workout build --program 12345 --date 2026-6-22 --file day.json
```

During development, run from source with `pnpm start <args>`; after `pnpm build`, the
`trainheroic` binary (`dist/cli.mjs`) does the same.

Run `trainheroic` with no command to print the full help. Commands group into reads
(`whoami`, `athletes`, `programs`, `teams`, `program <id>`, and the rest), a raw `request`
escape hatch, exercise-library operations (`resolve`, `search`, `get`, `sync`, `create`,
`forget`, `stats`), the workout lifecycle (`build`, `read`, `publish`, `remove`), and
messaging (`list`, `read`, `draft`, `send`, `delete`).

## Conventions

- Output is JSON on stdout; errors go to stderr with a non-zero exit code.
- Actions that touch an athlete or delete data require an explicit `--yes`. That covers
  `workout publish`, `workout remove`, `exercise forget`, `message send`, `message delete`,
  and `workout build --publish`.
- JSON input can be passed inline, with `--file <path>`, or piped on stdin. Inputs are
  validated against the shared schemas from `@trainheroic-unofficial/dto`.
- The session token and the exercise library are cached under `~/.trainheroic/`. The library
  file is the same shape the local server uses, so the two share a cache.

## Develop

```bash
pnpm start whoami   # tsx src/cli.ts
pnpm build          # tsdown -> dist/cli.mjs
pnpm typecheck
pnpm test
pnpm exec vitest run test/parse.test.ts
```
