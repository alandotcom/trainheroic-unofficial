# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This package is `@trainheroic-unofficial/dto`. For the workspace dependency graph and the
shared conventions, read [../../CLAUDE.md](../../CLAUDE.md) first.

## Role

The bottom of the dependency graph and the single source of truth for TrainHeroic shapes:
zod schemas plus the TypeScript types inferred from them. Everything upstream (`js`, `core`,
`cli`) imports shapes from here rather than defining its own. Nothing here depends on any
other workspace package.

`src/` is split by domain and re-exported through `index.ts`. When you add a shape, put it
in the matching domain module (or a new one) and export it from `index.ts`.

## Invariants

- Runtime-agnostic. No `node:*` imports, no filesystem, no environment access. These
  schemas have to run unchanged in Cloudflare workerd, so keep the package pure.
- Input schemas validate; response schemas tolerate. Response/payload schemas use loose
  objects and id coercion (number or numeric string) so a new field from the undocumented
  API does not break a parse. Do not tighten them into strict objects.
- A schema and its inferred type travel together. Export `someSchema` and the
  `z.infer`-derived type so callers can validate and type from one import.
- This is the only place a shape is defined. If you find a duplicated type in `js`, `core`,
  or `cli`, the fix is to move it here and import it, not to add a parallel copy.
- zod is a real dependency (currently v4). Match the existing version when adding schemas.

## Commands

```bash
pnpm build       # tsdown -> dist (ESM + .d.mts); dev resolves the "." export to src
pnpm typecheck
pnpm test
pnpm exec vitest run test/workout.test.ts   # a single file
pnpm exec vitest run -t "<name>"            # a single test by name
```
