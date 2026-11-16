# Product marketing context

**Document version:** v2
**Last updated:** 2026-11-15

## Product and audience

Use [the website product brief](../packages/website/PRODUCT.md) for the product's purpose,
audiences, positioning, operating constraints, and voice. That brief remains authoritative.
This document adds search intent, conversion definitions, and evidence for marketing work.

TrainHeroic Unofficial is an independent toolkit for people with an existing TrainHeroic
account. Hosted and local MCP servers, the CLI, SDK, skill, and browser exporter share the
same toolkit. An athlete, coach, or developer chooses the interface that fits the task.

| Audience | Job to complete | Relevant destination | Successful outcome |
| --- | --- | --- | --- |
| Athlete | Keep or analyze personal training history | `/export` | Generate a non-empty CSV, JSON, or text download |
| Athlete | Review scheduled workouts and progress with an assistant | `/connect` | Complete authorization and receive a successful training-tool result |
| Coach | Review a roster or prepare programming | `/connect`, `/capabilities` | Receive a useful roster result or create and verify an intended draft |
| Developer | Build a script, application, or agent integration | `/developers` | Run an authenticated first request through the chosen interface |

The website does not establish a paid business model, revenue, or customer lifetime value.
Measure task completion before making acquisition-cost or revenue claims.

## Search demand and customer language

The supplied Search Console archive contains 108 clicks and 1,311 impressions from August 14
through November 13, 2026. The keyword CSV is a separate snapshot with an unspecified period.
Use [the search review](../docs/seo/2026-11-15-search-review.md) for calculations and limitations.

The clearest observed intents are API access, MCP/Claude connections, and workout exports.
The snapshot also contains questions about printing, spreadsheet imports, and browser access.
These are search observations, not customer-interview findings or market-size estimates.

Examples of search language:

- `trainheroic api`
- `trainheroic mcp`
- `train heroic export data`
- `trainheroic how to download workout history`
- `can i connect my train heroic account to claude`
- `trainheroic import excel sheets`

## Differentiation and proof

The product supplies executable workflows: an exporter, typed SDK methods, CLI commands,
and role-aware MCP tools. Use those workflows and their actual output as proof in content.
The API's unofficial status, credential handling, and confirmation boundaries must be clear.

Describe alternatives by their actual scope. Official TrainHeroic support answers product and
account questions. An account-data request is different from this toolkit's workout-history
export. Other community SDKs and MCP servers require a current source check before comparison.
Do not invent competitors' limitations, testimonials, adoption figures, or performance gains.

## Objections and boundaries

| Question | Supported answer |
| --- | --- |
| Is this official? | Independent project, unaffiliated with and not endorsed by TrainHeroic |
| Where does my password go? | Explain the selected workflow using the current privacy policy; browser export and hosted OAuth have different storage behavior |
| Will AI change my training? | Distinguish reads, draft creation, and actions that require confirmation; drafts are remote writes |
| Can I export everything? | Workout history available to the account, with format-specific limits; not a complete account export or reusable coach-program backup |
| Can I import an Excel file? | Map spreadsheet rows into a structured workout specification; file parsing depends on the AI client or application |

The product is unsuitable for users expecting an official public API, an upstream compatibility
guarantee, access beyond their account's permissions, or a replacement for the TrainHeroic app.

## Content and conversion strategy

Give each task one primary destination. Supporting guides and FAQs answer their own questions
and link to the relevant tool or reference. Keep API access at `/developers`, exports at
`/export`, connector setup at `/connect`, and client comparisons at `/integrations`.

Every new page needs a concrete contribution, such as a real example, a working tool, or an
answer missing from existing results. Prefer improving those destinations before adding more
pages. Promote the exporter with readable sample output and a path to optional AI analysis.

Search clicks and impressions measure discovery. Connector-link clicks and download-button
clicks measure intent. A generated download is a browser-observed action, not proof that a file
was saved or opened. OAuth completion alone is not proof of a successful MCP task. Keep those
definitions separate when reporting results.

## Measurement decision and open questions

- The user subsequently authorized a new GA4 property and public-site integration on November
  15, 2026. Consent-controlled public page views and fixed intent actions are configured in
  the website source. The export app and backend counters remain outside this GA4 integration.
  Existing hosted Sentry authorization and tool-outcome metrics provide a separate baseline. See the
  [marketing review](../docs/seo/2026-11-15-marketing-review.md) for definitions and limitations.
- No conversion baseline or customer-interview dataset has been supplied.
- Hosted MCP as the likely entry point is an assumption in the product brief, not a measured
  conversion result. Preserve equal access to other interfaces while testing that assumption.

## Learnings

No marketing experiments have completed. Record validated outcomes here after a defined
measurement period; planned changes and search observations belong in the sections above.

## Changelog

- v3 (2026-11-15): Recorded authorization for GA4 and the public-site measurement boundaries.
- v2 (2026-11-15): Recorded the user's audit-only measurement scope; new browser counters and
  telemetry destinations are outside this pass.
- v1 (2026-11-15): Drafted context from the existing product brief, implemented interfaces,
  privacy documentation, and supplied search reports for the marketing-skills review.
