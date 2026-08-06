---
"@trainheroic-unofficial/js": major
"@trainheroic-unofficial/core": major
"@trainheroic-unofficial/cli": major
"@trainheroic-unofficial/cloudflare": major
"@trainheroic-unofficial/coach-mcp": major
"@trainheroic-unofficial/athlete-mcp": major
---

Migrate MCP servers to SDK v2 (`@modelcontextprotocol/server@2.0.0`).

Hosted worker replaces deprecated `McpAgent` Durable Objects with stateless `createMcpHandler` factories. `confirmGate` uses multi-round-trip `input_required` (with `confirm:true` fallback). OAuth enables Client ID Metadata Documents, backed by the `global_fetch_strictly_public` compatibility flag; protected-resource metadata stays request-derived so all three mount paths and every origin advertise a correct RFC 9728 identifier. DCR `/register` remains for the deprecation window. Local stdio servers use `serveStdio`. See ADR 0001 and #73.

`TrainHeroicClient` gains an `onSession` callback so a caller can hold the session token across short-lived clients; the hosted worker uses it to avoid re-authenticating on every stateless MCP request.

**Breaking (CLI):** removes the `trainheroic request <METHOD> <path>` raw-request command. Every endpoint is reached through a typed command, matching the MCP surface, which never had a raw tool.
