# Design system

## Reference

Early Stripe docs, agent-browser.dev — code-forward, no marketing chrome. Ink on paper, not purple SaaS.

## Color strategy

Restrained monochrome. Warm iron accent for links and emphasis only. OKLCH. No violet.

```css
--color-bg: oklch(1 0 0);
--color-ink: oklch(0.13 0 0);
--color-muted: oklch(0.42 0.012 50);
--color-faint: oklch(0.58 0.008 50);
--color-line: oklch(0.86 0.006 50);
--color-link: oklch(0.45 0.1 42);
--color-link-hover: oklch(0.32 0.09 42);
--color-code-bg: oklch(0.97 0.004 50);
--color-code-ink: oklch(0.2 0.01 50);
```

## Typography

| Role | Family |
|------|--------|
| Headlines | Archivo (700) |
| Body | Hanken Grotesk (400/500) |
| Code | Source Code Pro |

- Body: 1.0625rem / 1.7 line-height
- h1: `clamp(2.5rem, 6vw, 4.25rem)` / weight 700 / tracking -0.035em / max 11ch
- h2: 1.375rem / weight 600 / tracking -0.02em
- Prose max: 36rem · Code max: 52rem

## Components

- **Nav**: text links, current page underlined
- **Snippet**: light code block, 1px border, no traffic-light chrome, no uppercase labels
- **Section rule**: 1px `--color-line` only — no cards, callouts, or pills

## Motion

None on page load. 120ms color transitions on links only. `prefers-reduced-motion` respected.
