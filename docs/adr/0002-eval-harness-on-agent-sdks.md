# ADR 0002: Drive evals with agent SDKs, and own the tool layer

## Status

Proposed

## Context

`packages/eval` measures whether an agent can drive the TrainHeroic surfaces. The
subject under test is the **surface** — tool names, descriptions, parameter
shapes, result presentation, and whether a capability exists at all. The model is
the instrument, which is why varying it is a method rather than a goal.

Three problems with the current harness motivated this.

**We drive vendor CLIs as subprocesses.** `src/stream.ts` owns line buffering,
per-vendor JSONL parsing, detached process groups, kill-tree, a SIGINT reaper,
closing stdin so the agent does not hang on a pipe, a stderr tail, and SIGKILL on
timeout. Nearly every defect found while adding the second runner came from that
layer rather than from the thing under test: a hung run because opencode read a
piped stdin, orphaned agents on Ctrl-C, buffered output that hid results, and an
unexplained "did the MCP server boot" state.

**Each vendor's own context is an uncontrolled variable.** Claude Code and
opencode wrap our tools in different system prompts and different built-in tool
sets. A difference measured between them is partly ours and partly theirs, and
nothing separates the two. That undermines the comparison the runner axis exists
to provide.

**Tool-call observation is lossy and vendor-shaped.** We read tool calls out of
each vendor's event stream and normalize them: MCP ids by stripping a
runner-specific prefix, CLI commands by re-parsing a shell string through
`src/canonical.ts`. The shell path loses information — two different
`exercise search` queries both normalize to `exercise_search({})` because no
positional is captured — so the same behaviour scores differently on MCP and CLI.
Surface comparability is the reason this package exists.

Verified against the registry on 2026-08-09:

| Package | Version | Shape |
| --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | 0.3.226 | `query({prompt, options})`; `options` carries `mcpServers`, `allowedTools`, `disallowedTools`, `canUseTool`, `systemPrompt`, `model`, `effort`. `createSdkMcpServer` registers **in-process** tools (`McpServerConfig` = stdio \| SSE \| http \| sdk-instance). The `result` message carries `total_cost_usd` and `num_turns`. |
| `@mariozechner/pi-agent` | 0.9.0 | `new Agent({transport})` with `setSystemPrompt`, `setModel`, `setThinkingLevel`, `setTools`, `prompt()`, `subscribe()`, `abort()`. Fully in-process. Tools are `AgentTool` (name, description, typebox `parameters`, execute). No MCP client. |
| `@opencode-ai/sdk` | 1.18.15 | `createOpencode({config})` boots a managed opencode server (child process, via `cross-spawn`) and returns an HTTP client; sessions are driven with `prompt` / `promptAsync`. `Config` carries `mcp`, `agent`, `tools`, and `model` **programmatically**, so no `opencode.json` on disk and no XDG isolation trick. Tool *implementations* cannot be injected: the agent runs opencode's own tools plus whatever MCP servers the config names. |

Three facts from that table drive the decision. All three SDKs let us choose the
tool set. Only one speaks MCP, and only two accept tool implementations directly —
so the tool set must be deliverable by more than one transport.

`flue` on npm is an unrelated 2022 Firebase utility, and `eve` is Vercel's durable
agent framework; neither is in scope here.

## Decision

1. **Drive agents through their SDKs, not their CLIs.** Delete the subprocess
   layer (`src/stream.ts`) along with process-group handling, stdout parsing,
   reaping, and the stdin workaround. Cancellation becomes an `AbortSignal`.
   Note that "SDK" does not mean in-process: the Claude Agent SDK still manages a
   Claude Code child process, and the opencode SDK boots and manages an opencode
   server. Only `pi` runs wholly in ours. What we stop owning in every case is the
   child's lifecycle and its wire format, which is where the defects were.

2. **The harness owns the tool set; transport is an adapter detail.** The harness
   decides which tools exist and implements every handler. How a given agent
   *receives* them varies, and that variation is confined to the adapter:
   - **In-process** for `claude-agent-sdk` (`createSdkMcpServer`) and `pi`
     (`setTools`).
   - **Over MCP** for `opencode`, which cannot take implementations. We already
     own an MCP server, so we serve the same tool set over stdio and name it in
     `Config.mcp`, with opencode's own built-ins switched off through the
     `agent.tools` map.

   Consequences:
   - "Surface" becomes *which tool set we hand over* — the TrainHeroic tools, or
     the single command-running tool of the CLI surface. It stops being an agent
     capability, so `pi`'s lack of an MCP client costs nothing.
   - Every tool call is dispatched by our handler whatever the transport, so every
     call is observed with real structured arguments on both surfaces and under
     every agent. `mcpToolId`, `shellTool`, `Normalize`, `ParseContext`, and the
     shell re-parsing in `canonical.ts` all disappear, and with them the MCP/CLI
     scoring asymmetry.
   - Scoping the CLI surface is ours. Every agent gets one tool that runs the
     `trainheroic` CLI with our env and refuses anything else — including
     opencode, which receives it over MCP and is given no shell at all. This
     replaces `Bash(trainheroic:*)` for Claude, opencode's `tools` map as a
     scoping mechanism, and the unscoped-shell caveat that mechanism forced.

3. **`(agent, model, variant)` is the run identity.** An agent hosts many models,
   and several host reasoning variants (`effort` in the Claude SDK,
   `ThinkingLevel` in pi). `EVAL_MODEL` becomes a spec rather than a bare string,
   and every result is labelled with the triple. The comparison across triples is
   the product: a wrong turn that every model family makes is our description
   defect; one only the weakest makes is a model limit.

4. **The same system prompt for every agent.** Since we supply the prompt and the
   tools, the only deliberate difference between two runs is the model. That is
   what makes the comparison a controlled one.

5. **In-process MCP by default; a spawned server as a packaging smoke test.**
   Attaching `core`'s tools in-process removes boot failures, the `tsx` spawn, and
   the temp cache file. It also skips the shipped `server.ts` entry point, so one
   separate test keeps that path honest.

6. **Modules are organised by knowledge ownership**, replacing the current
   execution-order layout:

   ```
   src/
     backend/    the fake TrainHeroic API — routes, shapes, and the capability log
     fixtures/   datasets, demo accounts, the history corpus
     surface/    what an agent may reach: the MCP tool set or the CLI tool
     agent/      one adapter per SDK, plus the shared contract test
     eval/       scenario, config, K-loop, scoring, report
   ```

7. **The backend names the capability it served.** Graders assert on
   `BackendCall { capability, method, params, body? }` rather than matching URL
   regexes, so a route format stays a backend decision. This replaces the parallel
   `requests` / `requestKeys` / `writes` arrays with one log.

8. **A trajectory decides pass or fail, not a score.** Every run is segmented at
   the *answering call* — the first non-errored call to a capability the scenario
   declares as answering it. Where waste falls names the defect:

   | Waste | Diagnosis | Owner |
   | --- | --- | --- |
   | Before the answering call | Discoverability | tool name/description in `core` |
   | Same capability, different args | Affordance — signature or unobtainable id | tool signature, or a resolver |
   | Same capability, same args | Loop, no progress | usually noise |
   | After the answering call | Presentation — got the data, could not use it | presenter in `js` |
   | No answering call | Gap or dead end | build the tool |

   Findings are categorical, with three global default budgets rather than a tuned
   number per scenario. An attempt passes when the outcome grader passes **and**
   no blocking finding fired; a scenario passes on the existing K-run pass-rate,
   which absorbs noise. This deletes `pathScore`'s 0–1 composite, `pathThreshold`,
   `pathRate`, `par`, and the second assertion added in the same change.

   **A run that never ran is never scored.** This rule is explicit because the
   first attempt at path scoring got it exactly backwards: the volume term divided
   the budget by the observed request count, so a run with zero requests — an MCP
   server that failed to boot, a run killed at the deadline — scored a *perfect*
   1.00, and the mean over K attempts moved up when a surface broke. Any metric
   with work in the denominator can reproduce that. An attempt is scorable only
   when the agent launched, was not cut short, and made at least one call;
   anything else is reported as unscored and excluded from every aggregate rather
   than being scored zero, because a boot failure is not agent behaviour.

9. **Correctness is asserted against fixture truth.** Of roughly ninety grader
   assertions today, exactly one checks a fact from the data; the rest check
   routing, the model's self-report, or give-up phrases. Because fixtures are
   generated, ground truth is computable — a scenario declares
   `expect: (truth) => truth.programCount` instead of a hand-typed string that
   silently rots when the fixture changes.

10. **One presenter.** `vitest-evals` is dropped. It supplies neither the K-loop
    nor the concurrency cap, and keeping it means two modules that know how to
    display a run. This also removes `src/transcript.ts` and the artifact
    round-trip that exists only to satisfy the framework's execution order.

## Consequences

Deleted: the subprocess layer, per-vendor stream parsing, MCP tool-id arithmetic,
shell-command re-parsing for tool observation, the `vitest-evals` dependency and
its transcript round-trip, the path-score composite and its per-scenario tuning.

Added: a tool-set layer in `surface/` that can be delivered either in-process or
over MCP, one adapter per SDK in `agent/`, and a shared contract test each adapter
must pass. Each SDK becomes a dependency of `packages/eval`, so their release
churn lands in our install. Two of the three ship fast — `@anthropic-ai/claude-agent-sdk`
is 0.x, and `@opencode-ai/sdk` tracks an opencode that published a release during
this work — so the contract test doubles as the drift alarm: a changed event or
config shape fails deterministically in `pnpm check` instead of surfacing as every
eval quietly reporting zero calls.

Fidelity trades. We stop testing any particular client's MCP plumbing — that
becomes the job of the spawned-server smoke test, not the usability suite. We also
stop measuring what a Claude Code user literally experiences, since the vendor's
own system prompt is deliberately excluded; that exclusion is the point, but it
means a result is a statement about our tool descriptions rather than about the
end-to-end product.

Migration is not incremental. Points 1, 2, and 6 move the same code, and the
scenarios must each declare their answering capabilities (point 8) and their
expected facts (point 9). The 16 scenario files and both docs change with it.

Open: whether a Claude Code CLI smoke path is kept at all; whether `pi`'s
transport should be `ProviderTransport` (straight to the provider) or
`AppTransport` (through a proxy) for eval runs; and whether serving the tool set
over MCP for opencode should reuse the in-process server instance or a separate
stdio process, given that `Config.mcp` names a transport rather than an object.
