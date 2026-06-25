---
"@trainheroic-unofficial/cloudflare": minor
---

feat(cloudflare): user feedback / bug-report tool for the hosted MCP

Adds a `report_feedback` MCP tool to every variant of the hosted Worker (`/mcp`, `/mcp/coach`,
`/mcp/athlete`) so a user can ask the assistant to file a bug report or send feedback about the
integration itself. When `SENTRY_DSN` is configured it routes to Sentry's user-feedback channel
(`Sentry.captureFeedback`) and returns a reference id; with no DSN it falls back to a structured
`console.log`, so a report is never silently dropped in local dev or an unconfigured deploy.

The report is self-contained: the user's message plus auto-captured, non-PII context — session id,
role, app version/release, and the last few tool calls. That activity trail comes from a small
per-session ring buffer now kept by the `tool-metrics.ts` instrumentation (tool name, surface,
ok/error, duration — never arguments or results). The privacy invariant holds: the only PII sent is
the reporter's own email, attached as the feedback contact, and it correlates with that session's
existing error events and traces via the shared `mcp.session` tag.
