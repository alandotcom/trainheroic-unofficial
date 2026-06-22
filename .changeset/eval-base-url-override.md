---
"@trainheroic-unofficial/js": patch
---

feat(js): allow overriding the API hosts via env vars

The SDK client now reads optional `TH_COACH_BASE`, `TH_APIS_BASE`, and `TH_AUTH_URL` environment
variables to override the hardcoded TrainHeroic hosts. With none set, behavior is unchanged (the
real `api`/`apis.trainheroic.com` hosts). The override is read per request through
`globalThis.process?.env`, so the runtime-agnostic entry stays free of `node:*` and unchanged on
workerd.

This is the seam the new in-code MCP eval harness (`packages/eval`) uses to point a spawned MCP
server at a local fixture-backed fake backend, letting evals simulate large orgs (hundreds of
athletes, dozens of teams) instead of the sparse real test accounts.
