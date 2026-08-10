# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who want to do more with an existing TrainHeroic account:

- Coaches working with rosters, programming, analytics, and athlete communication.
- Athletes working with their own training, progress, and history.
- Developers building applications, automations, or agent workflows around TrainHeroic data.

No audience is treated as the universal default. Most visitors will probably arrive for the hosted MCP server, but the product must make its other surfaces understandable and reachable.

## Product Purpose

Provide one unofficial toolkit for using TrainHeroic with AI, code, and a person's own data. Success means someone can understand what the toolkit makes possible, choose the surface that fits their goal, and complete a real TrainHeroic task.

## Positioning

The same TrainHeroic capabilities are available through a hosted MCP server, local MCP servers, a CLI, a TypeScript SDK, a Claude Code skill, and a browser-based data export. These are not unrelated integrations; they share the toolkit's client, typed data shapes, and role-aware understanding of TrainHeroic.

## Operating Context

Users bring an existing TrainHeroic coach or athlete account. They may work from an AI client, a terminal, application code, or a browser. The hosted MCP server is the likely entry point for most visitors and provides OAuth-based access without requiring a local server. Local and developer surfaces support workflows that need direct control, scripting, or integration.

## Capabilities and Constraints

- The toolkit supports coach and athlete roles, with capabilities selected from the role on the TrainHeroic account.
- It can expose roster, programming, training, analytics, messaging, and history workflows where the underlying account permits them.
- It includes hosted and local MCP servers, a CLI, a TypeScript SDK, a Claude Code skill, and browser export.
- It requires an existing TrainHeroic account; it does not create an account or replace the TrainHeroic app.
- It uses undocumented TrainHeroic APIs, so upstream behavior can change.
- Destructive and athlete-facing actions require confirmation on the MCP and CLI surfaces.

## Brand Commitments

The product name is **trainheroic unofficial**. It is not affiliated with or endorsed by TrainHeroic.

Its voice is capable, direct, and quietly opinionated: expert confidence without gym-bro energy or SaaS cheerleading. It should feel like documentation written by someone who ships the code.

## Evidence on Hand

- Working hosted MCP endpoint: `https://mcp.trainheroic-unofficial.com/mcp`.
- Installable packages and commands documented under `src/content/docs/developers/`.
- A browser-based training-history export at `src/pages/export.astro`.
- A generated MCP tool catalog sourced from the implemented tool definitions.
- Real authentication, privacy, role, and confirmation behavior documented under `src/content/docs/`.
- No testimonials, customer logos, adoption metrics, or benchmark claims are on hand; future work must not fabricate them.

## Product Principles

1. Start from the visitor's goal, not from a presumed client or level of technical knowledge.
2. Explain the toolkit as one product before presenting its individual surfaces.
3. Make the hosted MCP server easy to find without allowing it to erase the CLI, SDK, local MCP, skill, or export paths.
4. Use real endpoints, commands, workflows, and implemented behavior as proof.
5. Be candid about account requirements, unofficial status, privacy boundaries, and undocumented upstream APIs.

## Accessibility & Inclusion

Meet WCAG 2.1 AA contrast for body text, provide visible focus states, respect `prefers-reduced-motion`, keep code blocks usable at narrow widths, and never convey information through color alone.
