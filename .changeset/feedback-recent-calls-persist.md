---
"@trainheroic-unofficial/cloudflare": patch
---

Fix `report_feedback` always attaching "(none recorded)" for recent tool calls.

The recent-call ring buffer lived only in the Durable Object's memory. The `McpAgent` hibernates and evicts the DO between MCP messages and re-runs `init()` on each cold start (persisting only the session's initialize state), so every cold start rebuilt an empty buffer. Because `report_feedback` almost always fires in a later message than the calls it should describe, the DO had usually hibernated in between and the buffer read empty.

The buffer is now persisted to the DO's storage under a per-session key: `instrumentToolMetrics` takes an optional store, seeds the in-memory buffer from it via `hydrate()` in `init()`, and write-through-saves after each recorded call (kept alive past the call with `ctx.waitUntil`). A bug report now carries the real recent-call trail across the session's messages. The persisted fields stay non-PII (tool name, surface, ok/error, duration), matching what the metrics and spans already hold.
