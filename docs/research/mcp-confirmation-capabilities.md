# MCP confirmation and elicitation capabilities

Research date: 2026-09-20

This note evaluates the confirmation patch in `packages/core/src/confirm.ts` against
the MCP 2026-07-28 specification and the TypeScript SDK used by this repository.

## Scope and version

The repository pins `@modelcontextprotocol/server` to `2.0.0` in `packages/core`,
`packages/cloudflare`, `packages/coach-mcp`, and `packages/athlete-mcp`; the lockfile
also resolves the SDK v2 client and server packages to `2.0.0`. SDK v2 is the release
line that implements the 2026-07-28 MCP revision. The sources below are the current
official specification and SDK documentation; the SDK `main` documentation may include
later 2.x clarifications, so behavior that is version-sensitive should be checked again
when upgrading the pinned package.

Relevant local facts:

- The hosted server uses the stateless `createMcpHandler` factory in
  `packages/cloudflare/src/mcp.ts`.
- The local coach and athlete servers use `serveStdio`.
- The patch leaves the hard server-side gate in place, and only changes the first-round
  behavior for a modern client that did not declare form elicitation.

## Conclusion

The patch's overall shape is sound, with one important qualification:

1. For a modern request that declares form elicitation, returning
   `inputRequired({ inputRequests: { confirm: inputRequired.elicit(...) } })` is the
   canonical MCP 2026 confirmation flow.
2. A server MUST NOT return that form request to a modern client that did not declare
   `elicitation.form`. The SDK correctly rejects such an `input_required` result with
   `-32021` (`Missing Required Client Capability`) before the result reaches the wire.
3. Detecting the missing capability and returning a complete tool result with
   `isError: true` is protocol-correct and consistent with MCP's model-facing tool-error
   guidance. It is not a special MCP confirmation fallback, however. The message,
   asking the model to obtain user approval, and the `confirm:true` argument are all
   application policy.
4. `confirm:true` is not proof that a human approved the operation. It is meaningful only
   as the application's explicit fallback contract. If the requirement is a
   protocol-enforced or independently verifiable human approval, a model-controlled
   boolean cannot provide that guarantee.
5. Tool annotations are useful client-side hints, not an enforcement mechanism. The
   existing destructive annotations should remain, while `confirmGate` remains the
   authoritative server-side check.
6. Tasks are an optional extension for durable or long-running workflows. They are not
   a more canonical replacement for this immediate confirmation round trip.

## 2026-07-28: per-request capabilities and `input_required`

The 2026 request envelope carries the protocol version and client capabilities on each
request under `_meta`. The schema says that `clientCapabilities` is required, that an
empty object means no optional capabilities, and that servers must not infer capability
support from prior requests. See the official [2026-07-28 schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts#L2339-L2352).

For elicitation, the official specification requires a client to declare support in
`_meta.io.modelcontextprotocol/clientCapabilities.elicitation`. `form` and `url` are
separate modes; an empty `elicitation: {}` is retained as a backwards-compatible
declaration of form support. Servers MUST NOT send a mode the client did not declare.
See [2026-07-28 Elicitation, capabilities](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation#capabilities).

For a tool call, the server can return an `InputRequiredResult` with
`resultType: "input_required"` and embedded requests. The client fulfills those
requests and retries the original `tools/call` with `inputResponses` and a fresh JSON-RPC
request id. See [2026-07-28 Tools, input-required results](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#input-required-tool-results)
and [SEP-2322, Multi Round-Trip Requests](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/seps/2322-MRTR.mdx).

The official TypeScript SDK's `inputRequired` documentation gives the same confirmation
example: return `inputRequired.elicit(...)`, then read the accepted response on handler
re-entry. It explicitly says that each embedded request is checked against the client's
declared capabilities and that a missing capability rejects the call with `-32021` before
anything reaches the wire. See [TypeScript SDK `input_required`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/input-required.md#return-input_required-instead-of-pushing-a-request).

The protocol schema defines `MissingRequiredClientCapabilityError` as the response when
processing requires an undeclared client capability. It assigns code `-32021` and says
that an HTTP transport MUST use `400 Bad Request`; the error data identifies the required
capabilities. See the [2026-07-28 schema error definition](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts#L3075-L3120).

Therefore, the original Sentry behavior was the SDK enforcing the protocol contract:
the handler produced an `input_required` form request, but the client's per-request
capabilities did not include form elicitation. It was not a TrainHeroic API failure.

## What to do when form elicitation is absent

The protocol requirement is negative and clear: do not emit an unsupported form request.
The specification does not define a mandatory alternate confirmation mechanism for this
case. A server has application choices, provided it does not perform the protected
operation without the required approval policy.

The current branch is a reasonable choice for a model-driven tool:

```text
if the explicit application confirmation is true:
    proceed
else if an accepted MCP elicitation response says confirm=true:
    proceed
else if this modern request lacks elicitation.form:
    return a complete tool result with isError=true and an actionable retry message
else:
    return input_required with a form elicitation
```

This avoids asking the SDK to encode an unsupported embedded request. It also gives the
model a recoverable result instead of a host-level capability error. The capability
check must remain before any TrainHeroic read or write.

The fallback should be described accurately: `confirm:true` is an application argument
that tells this server the caller claims approval. It is not a standardized MCP field,
and “ask the user, then retry” is a convention between this server and a model/client.
If stronger approval provenance is required, the server needs a host- or server-controlled
approval mechanism rather than trusting a freely supplied boolean.

One implementation detail is worth preserving: a legacy request must not be treated as a
modern request with no capabilities merely because the modern metadata is absent. The
SDK internally resolves modern capabilities from the per-request envelope and legacy
capabilities from the 2025 initialize state. The patch's `undefined` legacy branch is
appropriate only if `mcpReq.envelope` is reliably modern-only in the pinned SDK. Keep
that assumption covered by a legacy transport test when changing SDK versions.

## Is an ordinary `isError` tool result allowed or recommended?

It is allowed and appropriate as an application fallback, with these precise limits:

- It is a normal, complete `tools/call` result with `isError: true`, not an
  `InputRequiredResult` and not a JSON-RPC protocol error.
- It must not be used after returning an unsupported `input_required` request; the
  capability decision must happen before constructing or returning that result.
- It is not the MCP-defined response for the server having emitted a capability-dependent
  request to an incapable client. In that situation, `-32021` is the protocol error.
- It is useful here because the server deliberately chooses not to issue the form request
  and instead reports an application-level, model-recoverable inability to continue.

The 2025/2026 Tools specification distinguishes protocol errors from tool execution
errors. It places actionable API, input-validation, and business-logic failures in
`isError: true` tool results and says clients SHOULD provide those results to the model
for self-correction. See [2026-07-28 Tools, error handling](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling)
and the equivalent [2025-06-18 guidance](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling).
The TypeScript SDK makes the same audience distinction: a recoverable `tools/call`
failure belongs in a tool error, while the host application handles protocol errors.
See [SDK error handling](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/errors.md#choose-between-tool-error-and-protocol-error).

So the classification is: protocol-correct, consistent with general SDK guidance, and
recommended for this application's recovery UX; not an MCP-prescribed confirmation
fallback. The exact text and `confirm:true` convention remain application-specific.

## Legacy 2025 behavior

The 2025-06-18 protocol used an `initialize` handshake. A client declared
`capabilities.elicitation: {}`, and a server sent a standalone server-to-client
`elicitation/create` JSON-RPC request, receiving an `ElicitResult` directly. See
[2025-06-18 Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation#capabilities)
and [2025-06-18 Elicitation requests](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation#creating-elicitation-requests).

The 2026-07-28 revision removes that push channel for modern requests. The server
returns `input_required` from `tools/call`, and the client performs the next round by
retrying the original call. The SDK migration guide summarizes the mapping: modern
handlers use `inputRequired(...)`; on a pre-2026 connection, the SDK's default legacy
shim can fulfill that result by sending real `elicitation/create` requests and re-entering
the handler. See [SDK migration support for 2026-07-28](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md#legacy-shim-for-input_required).

The modes also changed over time. Form elicitation was the 2025-06-18 surface; URL mode
was introduced in 2025-11-25 and is intended for sensitive out-of-band interactions,
such as third-party authorization or payment. URL mode is not a generic substitute for
a boolean confirmation form. See [2026 Elicitation, URL mode](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation#url-mode-elicitation-requests).

## Tool annotations, elicitation, and tasks

Tool annotations such as `readOnlyHint`, `destructiveHint`, and `idempotentHint` can help
a trusted client decide whether to show a confirmation UI before invoking a tool. They
are explicitly hints, not guarantees; clients must treat annotations from untrusted
servers as untrusted, and annotations do not enforce the server's safety policy. See the
[official 2025-06-18 schema definition](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-06-18/schema.ts#L3722-L3819)
and the official [Tool Annotations guidance](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/#what-annotations-can-do).
The repository's destructive annotations are therefore useful discovery and UX metadata,
but `confirmGate` must remain the hard gate.

The Tasks extension is a separate, optional capability (`io.modelcontextprotocol/tasks`)
for durable or long-running execution. Its task lifecycle includes `input_required`, and
the task can surface elicitation requests while it is paused. This can support a human
approval workflow, but it requires extension negotiation, task storage/lifecycle, and
polling or task-update handling. It is unnecessary for the immediate TrainHeroic tool
confirmation round and does not replace the core MRTR elicitation flow. See [SEP-2663,
Tasks Extension](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2663-tasks-extension.md)
and the [official Tasks overview](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/extensions/tasks/overview.mdx).

## Assessment of the current patch

The patch correctly:

- treats an empty modern `clientCapabilities` object as incapable of form elicitation;
- treats `elicitation: {}` as the backwards-compatible form declaration;
- rejects URL-only capability for this form confirmation;
- returns an `isError` result before any API operation when form elicitation is unavailable;
- keeps the explicit `confirm:true` fallback and the existing declined/cancelled behavior.

The tests cover the important modern capability permutations and the HTTP regression. Add
or retain a legacy transport test if the helper continues to infer the protocol era from
`mcpReq.envelope`; that is the one place where application code duplicates an SDK-internal
era distinction. Also keep the security intent explicit in tool descriptions and reviews:
`confirm:true` means “the application accepts this caller's confirmation claim,” not
“the MCP protocol independently verified a human approval.”

## Unresolved compatibility risks

- The repository pins SDK `2.0.0`, while the linked SDK `main` documentation can receive
  later 2.x changes. The 2026 specification and the SDK 2.0.0 release agree on the
  `input_required`/capability model, but recheck exact helper exports and transport defaults
  on an SDK upgrade.
- Claude Code's user-facing handling of a tool-level `isError` result is client policy;
  MCP specifies the wire shape and recovery intent, not the exact UI wording.
- MCP has no standard `confirm:true` argument or server-verifiable “human approved” token.
  Any stronger assurance requires an application-specific host integration or a
  server-controlled approval state.
