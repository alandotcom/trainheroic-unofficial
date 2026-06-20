# @trainheroic-unofficial/coach-mcp

Local single-user MCP server for a TrainHeroic coach. Runs on your machine over stdio; credentials come from the environment.

For the hosted version (no install, OAuth login), see the [root README](../../README.md).

---

## Install

### Claude Code

```bash
claude mcp add trainheroic \
  -e TRAINHEROIC_EMAIL=coach@example.com \
  -e TRAINHEROIC_PASSWORD=yourpassword \
  -- npx -y @trainheroic-unofficial/coach-mcp
```

### Claude Desktop / `.mcp.json` / other stdio clients

```jsonc
{
  "mcpServers": {
    "trainheroic": {
      "command": "npx",
      "args": ["-y", "@trainheroic-unofficial/coach-mcp"],
      "env": {
        "TRAINHEROIC_EMAIL": "coach@example.com",
        "TRAINHEROIC_PASSWORD": "yourpassword",
      },
    },
  },
}
```

---

## Develop

```bash
pnpm start       # run from source (needs TRAINHEROIC_EMAIL and TRAINHEROIC_PASSWORD)
pnpm inspect     # MCP Inspector UI against the source server
pnpm build       # tsdown → dist/server.mjs
pnpm typecheck
pnpm test
```
