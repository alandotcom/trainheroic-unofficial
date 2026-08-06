---
"@trainheroic-unofficial/core": minor
"@trainheroic-unofficial/cloudflare": minor
"@trainheroic-unofficial/coach-mcp": minor
"@trainheroic-unofficial/athlete-mcp": minor
---

Migrate MCP servers to SDK v2 (`@modelcontextprotocol/server@2.0.0`).

Hosted worker replaces deprecated `McpAgent` Durable Objects with stateless `createMcpHandler` factories. `confirmGate` uses multi-round-trip `input_required` (with `confirm:true` fallback). OAuth enables Client ID Metadata Documents and pins protected-resource metadata; DCR `/register` remains for the deprecation window. Local stdio servers use `serveStdio`. See ADR 0001 and #73.
