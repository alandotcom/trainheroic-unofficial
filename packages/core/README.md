# @trainheroic-unofficial/core

The shared MCP tool layer for TrainHeroic. Each tool is defined once here and reused by both
servers: the local stdio server (`@trainheroic-unofficial/coach-mcp`) and the hosted
Cloudflare worker (`@trainheroic-unofficial/cloudflare`).

Part of the [trainheroic-unofficial](../../README.md) workspace.

## How a server uses it

A server builds a `ToolContext` (an authenticated `TrainHeroicClient` plus something that
implements the `ExerciseIndex` interface) and calls the `registerXxxTools(server, ctx)`
functions:

```ts
import {
  registerReadTools,
  registerAthleteTools,
  registerTeamTools,
  registerAnalyticsTools,
  registerExerciseTools,
  registerWorkoutTools,
  registerMessagingTools,
  type ToolContext,
} from "@trainheroic-unofficial/core";

const ctx: ToolContext = { client, index };
registerReadTools(server, ctx);
registerExerciseTools(server, ctx);
// ...and the rest
```

Because the context depends on the `ExerciseIndex` interface rather than a concrete store,
the same tools run against the local in-memory library and the hosted D1 mirror without
change.

## What the tools cover

The tools group into coach reads (profile, athletes, teams, programs, notifications,
analytics catalog), athlete management (invite, archive, restore), team management (create,
rename, delete, join codes), analytics report pulls (`analytics_query`: readiness, 1RM and
working-max history, training summary, compliance, lift progress), exercise library
operations (resolve, search, get, sync, create,
forget, stats), the workout/session lifecycle (build a draft, read it back, publish,
unpublish, copy, save as template, remove), and messaging (list, read, draft, send, delete).
There is no raw-request escape hatch; every endpoint reaches the model through a typed tool.

Tools return their result in-band. A failure comes back as an error result the model can
read and correct, not a thrown exception. Reads are marked read-only. Athlete-facing or
destructive actions (publish, unpublish, remove, send, delete, archive, team/code delete)
pass through a confirmation gate before they run.

The D1-backed warehouse sync tools are not here; they live in the `cloudflare` package
because they depend on its storage.

## Develop

```bash
pnpm build       # tsdown
pnpm typecheck
pnpm test
pnpm exec vitest run test/confirm.test.ts   # one file
```
