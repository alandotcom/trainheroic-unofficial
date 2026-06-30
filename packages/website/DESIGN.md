# Design system

## Color strategy

Restrained: pure white surface, deep violet primary, cool accent for links and status. OKLCH throughout.

```css
--color-bg: oklch(1 0 0);
--color-surface: oklch(0.97 0.008 270);
--color-ink: oklch(0.22 0.04 270);
--color-muted: oklch(0.48 0.02 270);
--color-faint: oklch(0.62 0.015 270);
--color-primary: oklch(0.4 0.15 270);
--color-primary-hover: oklch(0.34 0.14 270);
--color-accent: oklch(0.55 0.12 250);
--color-border: oklch(0.9 0.01 270);
--color-code-bg: oklch(0.16 0.02 270);
--color-code-ink: oklch(0.92 0.01 270);
--color-success: oklch(0.55 0.14 155);
```

## Typography

| Role | Family | Usage |
|------|--------|--------|
| Display | Bricolage Grotesque | h1–h2, brand wordmark |
| Body | Source Sans 3 | prose, nav, buttons |
| Code | JetBrains Mono | pre, inline code, endpoints |

- Body size: 1.0625rem / line-height 1.65
- h1: `clamp(2.25rem, 4.5vw, 3.75rem)` / weight 600 / letter-spacing -0.03em / `text-wrap: balance`
- h2: `clamp(1.5rem, 2.5vw, 2rem)` / weight 600 / letter-spacing -0.02em
- Max prose width: 38rem (≈65ch)

## Spacing

Base unit 4px. Section padding `clamp(3rem, 8vw, 6rem)`. Container max 68rem.

## Components

- **Button primary**: filled `--color-primary`, white text, 6px radius
- **Button ghost**: transparent, ink border
- **Code block**: dark code panel, light page — no nested card chrome
- **Tool chips**: mono labels on surface background, 1px border
- **Callout**: surface fill + full 1px border — no side accent stripe

## Motion

- Page fade-in 400ms ease-out-quart
- Hover transitions 150ms on buttons and links
- `@media (prefers-reduced-motion: reduce)`: instant transitions

## Layout

- Hero: 2-column grid on wide screens (copy + terminal)
- Features: single-column definition list with rules, not card grid
- Docs pages: prose column + code column
