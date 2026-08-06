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
4. OAuth enables Client ID Metadata Documents (CIMD), which requires the
   `global_fetch_strictly_public` compatibility flag; keep DCR (`/register`)
   until the 2027 sunset. `resourceMetadata.resource` stays unset so the library
   derives it per request — a pinned value is wrong for `/mcp/coach` and
   `/mcp/athlete` and binds every token's audience to one origin.
5. Sentry correlation uses `user:<thUserId>` (`mcp.session` tag, kept under that
   name so existing queries survive) instead of `mcp-session-id`. Feedback reports
   the same correlation id; there is no recent-call ring buffer — Sentry tool
   spans already carry the non-PII trail. Errors raised inside an MCP request are
   reported through `createMcpHandler`'s `onerror`, because the SDK catches them
   and answers 500 rather than letting `withSentry` see them.
6. Module-level MCP handlers read Worker bindings via
   `import { env } from "cloudflare:workers"` (no `AsyncLocalStorage`, no
   per-request handler rebuild). `allowedHostnames` is left unset: supplying it
   replaces the SDK's localhost and `workers.dev` defaults rather than extending
   them, and a custom domain's Host is already guaranteed by Cloudflare routing.

## Consequences

- Deploying this change deletes the three MCP DO classes (wrangler migration `v3`).
  What they stored was per-session and reconstructible — the grant props, the SSE
  replay buffer, and the recent-call trail — so the deletion is intentional disposal
  of session state. Note it also makes this deploy one-way: a rollback to an earlier
  tag hits a `wrangler.jsonc` whose migration list ends at `v2`, and wrangler responds
  by re-issuing `new_sqlite_classes` for the classes just deleted. If a two-way
  release is wanted, ship the binding removal now and the `v3` deletion in a follow-up.
- Clients that relied solely on pushed elicitation without `confirm: true` need
  MRTR-capable clients or must pass `confirm: true`. The fallback instruction is
  embedded in the elicitation prompt text, since a client that cannot elicit is
  rejected by the SDK before `confirmGate`'s own denial is reachable.
- D1 warehouse and OAuth KV state are unchanged. Grant props are read more strictly,
  so `parseProps` normalizes `role` rather than validating it — grants issued before
  `AccountRole` existed are encrypted per token and can never be migrated, so
  rejecting them would strand those users permanently.
- Statelessness rebuilds the `TrainHeroicClient` per request, which would mean a fresh
  `POST /auth` on every tool call. A module-level `sessionCache` keyed by the grant's
  `thUserId` (memory only — the token is credential-equivalent) restores what the
  Durable Object's lifetime used to provide implicitly.
- Coach tool registration is centralized in `registerCoachTools` (`core`);
  `confirmGate` returns `ToolHandlerResult | undefined` (`undefined` = proceed) and
  must be called before any read or write, since MRTR re-runs the handler from the top.
