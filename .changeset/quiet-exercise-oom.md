---
"@trainheroic-unofficial/db": patch
"@trainheroic-unofficial/cloudflare": patch
---

Fix Durable Object OOM during full exercise-library refresh: upsert in bounded batches instead of materializing every Drizzle statement at once (Sentry TRAINHEROIC-MCP-K).
