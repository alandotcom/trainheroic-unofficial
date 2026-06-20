# @trainheroic-unofficial/coach-mcp

Local single-user MCP server for a TrainHeroic coach. Runs on your machine over stdio; credentials come from the environment.

For the hosted version (no install, OAuth login), see the [root README](../../README.md).

---

## Install

### Claude Desktop extension (easiest)

Download `trainheroic-coach-mcp.mcpb` from the [Releases page](https://github.com/alandotcom/trainheroic-skill/releases), drag it onto Claude Desktop, and enter your TrainHeroic email and password. Credentials are stored in the OS keychain. No Node toolchain needed.

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
pnpm build:mcpb  # bundle + pack the Desktop extension → dist/trainheroic-coach-mcp.mcpb
pnpm typecheck
pnpm test
```

### Cut a release (maintainers)

Push a `coach-mcp-v*` tag. The `Release Coach MCPB` GitHub Actions workflow builds, signs, and attaches the `.mcpb` to the Release. Set `MCPB_CERT` / `MCPB_KEY` repo secrets to sign with a real certificate; omitting them produces a self-signed build.
