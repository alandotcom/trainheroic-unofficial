# @trainheroic-unofficial/core

The shared [MCP](https://modelcontextprotocol.io) (Model Context Protocol) tool layer for
TrainHeroic. Each tool — a function an AI assistant can call — is defined once here and reused
by both servers: the local stdio server (`@trainheroic-unofficial/coach-mcp`) and the hosted
Cloudflare worker (`@trainheroic-unofficial/cloudflare`). You only need this package if you
are building your own MCP server; to _use_ the tools, run one of those servers.

Part of the [trainheroic-unofficial](../../README.md) workspace.

## Contents

- [How a server uses it](#how-a-server-uses-it)
- [What the tools cover](#what-the-tools-cover)
- [Develop](#develop)

## How a server uses it

A server builds a `ToolContext` and passes it, along with its MCP server instance, to the
`registerXxxTools(server, ctx)` functions (the `register*` names below are the real exports;
`registerXxxTools` is shorthand for all of them). `ToolContext` is `{ client, index }`: an
authenticated `TrainHeroicClient` (from `@trainheroic-unofficial/js`) and anything implementing
the `ExerciseIndex` interface — the in-memory `ExerciseLibrary` here, or the hosted worker's
D1-backed store.

Install it alongside the MCP SDK and the `js` client (both peers you construct from):

```bash
npm install @trainheroic-unofficial/core @trainheroic-unofficial/js @modelcontextprotocol/sdk
```

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TrainHeroicClient, ExerciseLibrary } from "@trainheroic-unofficial/js";
import {
  registerReadTools,
  registerExerciseTools,
  registerWorkoutTools,
  // registerAthleteTools, registerTeamTools, registerAnalyticsTools, registerMessagingTools
  type ToolContext,
} from "@trainheroic-unofficial/core";

const client = new TrainHeroicClient(
  process.env.TRAINHEROIC_EMAIL!,
  process.env.TRAINHEROIC_PASSWORD!,
);
const index = new ExerciseLibrary(client);
const server = new McpServer({ name: "trainheroic", version: "1.0.0" });

const ctx: ToolContext = { client, index };
registerReadTools(server, ctx);
registerExerciseTools(server, ctx);
registerWorkoutTools(server, ctx);
// ...register the rest, then connect the server to a transport:
await server.connect(new StdioServerTransport());
```

Because the context depends on the `ExerciseIndex` interface rather than a concrete store, the
same tools run against the local in-memory library and the hosted [D1](https://developers.cloudflare.com/d1/)
(Cloudflare's SQLite database) mirror without change.

## What the tools cover

Each `register*` function registers a group of tools, and the individual tool names the model
sees are snake_case (e.g. `analytics_query`, `exercise_resolve`). The groups:

- coach reads (profile, athletes, teams, programs, notifications, analytics catalog)
- athlete management (`registerAthleteTools` — the coach's _roster_ view: invite, archive, restore)
- team management (create, rename, delete, join codes)
- analytics report pulls (`analytics_query`: readiness, 1RM (one-rep max) and working-max history, training summary, compliance, lift progress)
- exercise library operations (resolve, search, get, sync, create, forget, stats)
- the workout/session lifecycle (build a draft, read it back, publish, unpublish, copy, save as template, remove)
- messaging (list, read, draft, send, delete)

There is no raw-request escape hatch; every endpoint reaches the model through a typed tool.
(`registerAthleteTools` here is the coach's roster view, distinct from the athlete's own
training tools that the athlete server registers.)

Tools return their result in-band. A failure comes back as an error result the model can read
and correct, not a thrown exception. Reads are annotated read-only. Athlete-facing or
destructive actions (publish, unpublish, remove, send, delete, archive, team/code delete) pass
through a confirmation gate: it asks the client to confirm via MCP elicitation, falls back to
an explicit `confirm: true` argument when the client cannot prompt, and fails closed if neither
is satisfied.

The D1-backed warehouse sync tools are not here; they live in the `cloudflare` package
because they depend on its storage.

## Develop

Run `pnpm install` once at the repo root (Node >= 24, pnpm 10), then from this package:

```bash
pnpm build       # tsdown
pnpm typecheck
pnpm test
pnpm exec vitest run test/confirm.test.ts   # one file
```
