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
      "env": { "TRAINHEROIC_EMAIL": "coach@example.com", "TRAINHEROIC_PASSWORD": "..." },
    },
  },
}
```

After `pnpm build`, the package also exposes a `trainheroic-coach-mcp` binary
(`dist/server.mjs`) you can run with `node` or via the installed bin instead.

## Debug it

[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) is an interactive web UI
for listing this server's tools, inspecting their schemas, and calling them by hand. `pnpm
inspect` runs it against the source through `tsx`:

```bash
TRAINHEROIC_EMAIL="coach@example.com" TRAINHEROIC_PASSWORD="..." pnpm inspect
```

The script forwards those two variables to the spawned server with the Inspector's `-e` flag
(the spawned process does not inherit your shell's custom env, so they must be passed
explicitly). It prints a `http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=...` URL with a session
token pre-filled; open it, click **Connect**, then use the **Tools** tab. You can also leave
the credentials out of the command and type them into the Inspector's environment fields
before connecting.

For a non-interactive smoke test, the Inspector's CLI mode lists the tools without the UI:

```bash
TRAINHEROIC_EMAIL="coach@example.com" TRAINHEROIC_PASSWORD="..." \
  npx @modelcontextprotocol/inspector --cli \
  -e TRAINHEROIC_EMAIL="$TRAINHEROIC_EMAIL" -e TRAINHEROIC_PASSWORD="$TRAINHEROIC_PASSWORD" \
  tsx src/server.ts --method tools/list
```

## Develop

```bash
pnpm start       # tsx src/server.ts (needs the two env vars)
pnpm inspect     # MCP Inspector against the source over stdio
pnpm build       # tsdown -> dist/server.mjs
pnpm typecheck
pnpm test
```
