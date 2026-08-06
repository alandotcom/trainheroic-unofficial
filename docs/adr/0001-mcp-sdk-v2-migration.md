# ADR 0001: Migrate hosted MCP off McpAgent to MCP SDK v2

## Status

Accepted (tracked by GitHub [#73](https://github.com/alandotcom/trainheroic-unofficial/issues/73))

## Context

MCP 2026-07-28 and Agents SDK v0.20 deprecate `McpAgent` in favor of stateless
`createMcpHandler` + `@modelcontextprotocol/server@2.0.0`. Protocol sessions,
pushed server→client elicitation, and Dynamic Client Registration (DCR) are
deprecated (DCR removal after summer 2027).

This suite used `McpAgent` (one DO per MCP session), `@modelcontextprotocol/sdk`
v1, and pushed `elicitInput` inside `confirmGate`.

## Decision

1. Hosted Worker serves `/mcp`, `/mcp/coach`, and `/mcp/athlete` via
   `createMcpHandler` factories (no MCP Durable Objects).
2. Shared tools and local stdio servers use `@modelcontextprotocol/server@2.0.0`.
3. `confirmGate` returns MRTR `inputRequired(...)` (legacy shim covers 2025-era
   sessionful clients; `confirm: true` remains the non-interactive fallback).
4. OAuth enables Client ID Metadata Documents (CIMD) and pins
   `resourceMetadata.resource` to the canonical hosted `/mcp` URL; keep DCR
   (`/register`) until the 2027 sunset.
5. Sentry correlation uses `user:<thUserId>` (`mcp.session` tag) instead of
   `mcp-session-id`. Feedback reports the same correlation id; there is no
   recent-call ring buffer — Sentry tool spans already carry the non-PII trail.
6. Module-level MCP handlers read Worker bindings via
   `import { env } from "cloudflare:workers"` (no `AsyncLocalStorage`, no
   per-request handler rebuild). Host checks include the production MCP
   hostname via `allowedHostnames`.

## Consequences

- Deploying this change deletes the three MCP DO classes (wrangler migration `v3`).
- Clients that relied solely on pushed elicitation without `confirm: true` need
  MRTR-capable clients or must pass `confirm: true`.
- Application state (D1 warehouse, OAuth grant props) is unchanged.
- Coach tool registration is centralized in `registerCoachTools` (`core`);
  `confirmGate` returns `ToolHandlerResult | undefined` (`undefined` = proceed).
