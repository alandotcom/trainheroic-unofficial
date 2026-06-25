---
"@trainheroic-unofficial/cloudflare": patch
---

fix(cloudflare): tighten report_feedback guidance so reports are actionable

A test report surfaced that the `report_feedback` tool's instructions let the assistant file vague,
filler reports (one came through with meta commentary about the tool and a fabricated
`expected`/`actual`). The tool description now tells the assistant to get a concrete problem before
filing: when the user only says something like "report a bug", it first asks what happened, what
they were doing, and what they expected, then files with those answers. It holds to what the user
actually reported instead of inventing detail, and labels a pure test plainly in `message` while
leaving `expected`/`actual` empty rather than making up a bug. The `message` field now asks for a
specific summary line first, which Sentry uses as the report title.
