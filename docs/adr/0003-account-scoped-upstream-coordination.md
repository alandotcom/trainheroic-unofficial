# ADR 0003: Coordinate TrainHeroic requests per account

## Status

Accepted

## Context

The hosted MCP server creates a new `TrainHeroicClient` for every HTTP request. A module-level
limiter would therefore coordinate only one client in one Worker isolate. Cloudflare may run the
same account's MCP requests in several isolates and locations, so those limiters cannot enforce an
account-wide concurrency bound.

Production traces showed two related HTTP 504 patterns from TrainHeroic:

- `roster_main_lift_prs` fanned out workout-range and exercise-history requests. The nested pools
  could place up to twenty requests in flight, and an eleven-month workout-range read timed out.
- repeated `analytics_query` calls sent large training-summary requests that each timed out after
  roughly sixty seconds.

TrainHeroic returned gateway timeouts rather than HTTP 429 rate-limit responses. Automatic retries
would increase load and are unsafe for the SDK's write methods.

## Decision

1. Add one SQLite-backed `TrainHeroicUpstream` Durable Object per verified TrainHeroic `thUserId`.
   Every hosted SDK request after authorization, including session renewal, uses that object's RPC
   method. The object holds a four-slot in-memory FIFO limiter until the upstream response stream
   finishes or is cancelled.
2. Keep MCP protocol handling stateless. The Durable Object coordinates outbound HTTP traffic only;
   it does not hold an MCP session.
3. Keep a four-request limiter inside each `TrainHeroicClient` as a bound for the CLI, local MCP
   servers, and any SDK consumer. The hosted Durable Object remains the authoritative account-wide
   bound across clients and isolates.
4. Add an optional `ClientOptions.transport` / `LoginOptions.transport` seam. The default is global
   `fetch`, so existing consumers retain the same API behavior. The hosted Worker injects a
   transport backed by the account Durable Object.
5. Split coach workout-range reads into sequential windows of at most 180 days. Split
   `training-summary-athlete` reads into sequential batches of at most five users and 90 inclusive
   days, then merge the report rows.
6. Do not retry HTTP 504 responses automatically. Callers receive the existing error result and may
   choose a smaller scope or a later retry.
7. Record only request field names, array lengths, and a derived date-span count in HTTP failure
   diagnostics. Raw URLs, identifiers, dates, request bodies, credentials, and session tokens remain
   excluded.

## Alternatives considered

### A limiter in `TrainHeroicClient` only

This bounds one client instance. It cannot coordinate separate MCP requests because the hosted
server creates a client per request, and it cannot coordinate Worker isolates.

### Cloudflare Rate Limiting bindings

The existing bindings are useful for best-effort per-IP edge protection. Their counters are
per-location and eventually consistent, so they cannot provide a strict global concurrency limit
for one TrainHeroic account.

### Lower the nested tool concurrency only

Lower pools reduce one tool call's burst. Concurrent tool calls and separate isolates can still
exceed the intended account limit, and oversized single requests can still time out.

### Retry 504 responses

A 504 does not prove that a write failed before TrainHeroic applied it. Retrying every method would
risk duplicate effects, and retrying the failing reads would add load during an upstream slowdown.

## Consequences

- All hosted traffic for one TrainHeroic account passes through one globally named coordinator,
  while different accounts remain independent.
- The coordinator adds one Worker RPC hop to each upstream request and can queue requests when an
  account is busy.
- Response bodies stream through RPC, avoiding the 32 MiB limit for serialized RPC values while
  preserving backpressure and the concurrency permit for the stream lifetime.
- Queue state is intentionally ephemeral. Ordinary requests for one object identity reach one
  active instance. Cloudflare may briefly replace an instance during a network partition or
  software update, so this limiter is not a lease-backed distributed lock through those failure
  events.
- The SQLite namespace stores no application rows. Credentials, request bodies, response bodies,
  and session tokens exist only for the lifetime of each RPC call.
- Long reads make more upstream calls, but each call carries less work and the calls run under the
  shared concurrency bound.
- Wrangler migration `v4` creates the `TrainHeroicUpstream` namespace. The generated Worker binding
  types must remain synchronized with `wrangler.jsonc`.
