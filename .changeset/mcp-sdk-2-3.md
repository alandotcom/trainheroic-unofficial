---
"@trainheroic-unofficial/core": patch
"@trainheroic-unofficial/coach-mcp": patch
"@trainheroic-unofficial/athlete-mcp": patch
"@trainheroic-unofficial/cloudflare": patch
---

Upgrade the MCP TypeScript SDK to 2.3.1 and the hosted Worker's `agents` package to 0.27.0. Servers convert tool schemas only when tools are listed, which cuts the work the hosted Worker does on every request, and a closed connection no longer raises an unhandled rejection on Cloudflare Workers.
