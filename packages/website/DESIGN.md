# Design system

## Reference

Early Stripe docs, agent-browser.dev — code-forward, no marketing chrome. Pure ink on white.

## Color strategy

Neutral monochrome only. No warm tints, no accent color — links are underlined black text.

```css
--color-bg: oklch(1 0 0);
--color-ink: oklch(0.13 0 0);
--color-muted: oklch(0.45 0 0);
--color-faint: oklch(0.55 0 0);
--color-line: oklch(0.88 0 0);
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
- **Inline code**: monospace font only — no background, no border
- **Snippet**: 1px border, white fill, copy button
- **Section rule**: 1px `--color-line` only — no cards, callouts, or pills

## Motion

None on page load. 120ms color transitions on links only. `prefers-reduced-motion` respected.
