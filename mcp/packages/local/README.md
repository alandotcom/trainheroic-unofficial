# @trainheroic-unofficial/coach-mcp

A local, single-user MCP server for a TrainHeroic coach. It speaks MCP over stdio, takes its
credentials from the environment, and caches the exercise library on disk. There is no
OAuth and no database, so it needs nothing beyond Node.

Part of the [trainheroic-unofficial](../../../README.md) workspace. For the hosted,
multi-tenant version, see the `cloudflare` package.

## What it does

On launch it reads `TRAINHEROIC_EMAIL` and `TRAINHEROIC_PASSWORD`, builds a client and a
file-backed exercise library, registers the shared tool set from
`@trainheroic-unofficial/core`, and connects over stdio. An MCP client launches the process
and talks to it; the server calls the live TrainHeroic API directly. The tool surface is the
shared core set (coach reads, exercises, the workout lifecycle, and messaging). The
D1-backed warehouse sync tools are hosted-only and are not present here.

The exercise library is cached at `~/.trainheroic/library.json`, overridable with
`TRAINHEROIC_CACHE_FILE`.

## Run it

From a checkout (development):

```bash
TRAINHEROIC_EMAIL="coach@example.com" TRAINHEROIC_PASSWORD="..." pnpm start
```

Register it with an MCP client such as Claude Desktop by command, args, and env. During
development you can point it at the source through `tsx`:

```jsonc
{
  "mcpServers": {
    "trainheroic": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/mcp/packages/local/src/server.ts"],
      "env": { "TRAINHEROIC_EMAIL": "coach@example.com", "TRAINHEROIC_PASSWORD": "..." }
    }
  }
}
```

After `pnpm build`, the package also exposes a `trainheroic-coach-mcp` binary
(`dist/server.mjs`) you can run with `node` or via the installed bin instead.

## Develop

```bash
pnpm start       # tsx src/server.ts
pnpm build       # tsdown -> dist/server.mjs
pnpm typecheck
pnpm test
```
