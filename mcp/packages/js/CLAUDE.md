# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This package is `@trainheroic-unofficial/js`, the SDK. For the workspace dependency graph
and shared conventions, read [../../../CLAUDE.md](../../../CLAUDE.md) first.

## Role

The runtime-agnostic SDK that everything above it uses to reach TrainHeroic: the HTTP
client and auth, the exercise library, the workout encoder and session lifecycle, and
messaging. It depends only on `@trainheroic-unofficial/dto` for shapes.

## The export split (most important invariant)

There are two entry points, and the boundary between them matters:

- `.` (`src/index.ts`) must stay runtime-agnostic. It imports no `node:*` modules so it can
  run on Cloudflare workerd. If you add code here, use Web-standard APIs (`fetch`,
  `crypto.subtle`, `TextEncoder`).
- `./node` (`src/node.ts`) is where Node-only helpers live (filesystem-backed cache, path
  resolution). Anything reaching for `node:fs`, `node:os`, `node:path`, or `node:process`
  belongs here.

Putting a `node:*` import into the `.` graph breaks the worker build. When unsure where a
new helper goes, ask whether it must work on workerd; if yes, it cannot touch `node:*`.

## Other things to preserve

- `ExerciseIndex` (in the exercise modules) is the seam shared with the hosted server. The
  in-memory `ExerciseLibrary` here and the D1 `ExerciseStore` in the `cloudflare` package
  both implement it, and the `core` tools depend only on the interface. Changing the
  interface means changing both implementations and the tools that consume it.
- Session renewal lives in the client: lazy login, re-login once on 401/403, and a shared
  in-flight login so concurrent cold requests do not each authenticate. Preserve that
  behavior when touching request code.
- Two hosts, selected by `RequestOptions.base`. Default is the coach host.
- The workout encoder has non-obvious rules driven by the real API: fill every parameter
  slot (the HTTP 500 guard), broadcast scalars across sets, route RPE into the instruction,
  and emit advisories on unit mismatch rather than dropping data. The encoder tests pin
  this behavior; keep them green.
- Shapes come from `dto`. Do not redefine a type here that already exists there.

## Commands

```bash
pnpm build       # tsdown; emits separate "." and "./node" bundles
pnpm typecheck
pnpm test
pnpm exec vitest run test/<file>.test.ts
pnpm exec vitest run -t "<name>"
```
