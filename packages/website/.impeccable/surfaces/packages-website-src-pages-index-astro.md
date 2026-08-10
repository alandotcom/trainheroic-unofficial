---
version: 1
slug: "packages-website-src-pages-index-astro"
primary_target: "packages/website/src/pages/index.astro"
related_targets: ["packages/website/src/components/Header.astro"]
---

# Homepage surface brief

## Scope and visitor mode

- Target: `src/pages/index.astro` and the shared top-level header it uses.
- Persuade a scanning visitor who already uses TrainHeroic to understand one toolkit and choose a path by goal.
- The hosted MCP server is the likely primary entry, but coaches, athletes, and developers must not be collapsed into a Claude-only journey.

## Action, proof, and constraints

- Primary action: connect the hosted MCP server at `https://mcp.trainheroic-unofficial.com/mcp`.
- Proof task: get training history through MCP, CLI, SDK, or browser export using verified prompts, commands, methods, and links.
- Preserve the working Blume documentation migration and existing content. Replace the rejected homepage composition and header rather than adapting them.
- Approved comp: `.impeccable/mocks/homepage-parallel-lanes.png`.
- Do not literalize generated placeholder commands, generated section numbers, or desktop-only proportions.

## Direction and memorable moment

The shared training log: a bright paper field organized by program rules, one cobalt active lane, decisive condensed typography, and technical detail aligned like a training prescription. The first viewport splits the product thesis from an interactive proof; switching surfaces keeps the task fixed while the way into the toolkit changes.

## System inventory

| Ingredient       | Commitment                                                                                        | Medium                                    |
| ---------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Shared header    | Lowercase wordmark, Docs and GitHub links, cobalt Connect MCP action                              | Semantic HTML and CSS                     |
| Display type     | Very large compressed grotesk, near-black, tight but no tighter than `-0.04em`                    | Self-hosted variable webfont              |
| Page field       | Warm white with graphite one-pixel program rules; no texture, shadow, or rounded shell            | CSS                                       |
| Hero composition | Five-column thesis beside seven-column proof at desktop; stacked thesis-first on narrow screens   | Semantic HTML and CSS Grid                |
| Surface selector | Four keyboard-accessible tabs with a cobalt active rule and named selection                       | Buttons, ARIA tabs, minimal client script |
| Proof content    | One task; verified MCP prompt/endpoint, CLI command, SDK call, and browser export action          | Semantic HTML and code text               |
| Primary action   | Solid cobalt rectangular control, visually connected to the active proof lane                     | Anchor and CSS                            |
| Goal index       | Four full-width ruled rows with title, explanation, and directional affordance                    | Anchors and CSS Grid                      |
| Motion           | One lane-change transition in the proof content; content remains visible without script or motion | CSS and minimal client script             |

## Responsive and state requirements

- At desktop, the thesis and proof share the opening viewport and goal rows begin immediately after.
- At tablet and mobile, the proof stacks below the thesis; tabs scroll horizontally when necessary; actions remain at least 44px.
- Support hover, focus-visible, selected tab, copied endpoint confirmation, and reduced motion.
- The page must remain legible and navigable when JavaScript is unavailable; hosted MCP is the initial proof.

## Open decisions

None. The approved comp governs composition; verified repository behavior governs copy.
