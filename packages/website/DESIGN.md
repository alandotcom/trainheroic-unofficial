# Design system

## Reference

Simple documentation layout: system fonts, Shiki-highlighted code blocks.

## Color strategy

Neutral only. White page, gray body text, `#f6f8fa` code blocks (GitHub light).

## Typography

System UI for everything. `ui-monospace` for code.

## Components

- **Code blocks**: Expressive Code (Starlight) with the `github-light` theme, frameless,
  `#f6f8fa` background, 1px `#e5e5e5` border, copy button top-right
- **Lists**: normal bullets, no bordered rows
- **Inline code**: monospace only, no background
- **Docs shell**: Starlight, light-only, remapped to this palette in `src/styles/starlight.css`;
  hierarchy stays typographic (no accent pills, no boxed pagination cards)
