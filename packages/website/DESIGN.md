---
name: TrainHeroic Unofficial
description: One unofficial toolkit for using TrainHeroic with AI, code, and your own data.
colors:
  cobalt: "#2457d6"
  cobalt-deep: "#1945b8"
  paper: "#f3f1e9"
  paper-raised: "#faf9f4"
  ink: "#171714"
  graphite: "#55554f"
  graphite-faint: "#6a6962"
  rule: "#aaa89f"
  rule-soft: "#d3d0c6"
  code-paper: "#e9e6dc"
  white: "#ffffff"
  success: "#25672c"
typography:
  display:
    fontFamily: "Archivo Variable, Arial Narrow, sans-serif"
    fontSize: "clamp(4rem, 7.25vw, 6rem)"
    fontWeight: 790
    lineHeight: 0.87
    letterSpacing: "-0.04em"
    fontVariation: "wdth 66, wght 790"
  headline:
    fontFamily: "Archivo Variable, Arial Narrow, sans-serif"
    fontSize: "clamp(1.65rem, 2.8vw, 2.6rem)"
    fontWeight: 740
    lineHeight: 0.95
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Archivo Variable, Arial Narrow, sans-serif"
    fontSize: "1rem"
    fontWeight: 430
    lineHeight: 1.5
  label:
    fontFamily: "Archivo Variable, Arial Narrow, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 620
    lineHeight: 1.5
    letterSpacing: "0.06em"
  code:
    fontFamily: "ui-monospace, SF Mono, Cascadia Code, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  square: "0"
spacing:
  touch: "44px"
  control: "56px"
  lane: "82px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.white}"
    rounded: "{rounded.square}"
    padding: "0 24px"
    height: "56px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-deep}"
    textColor: "{colors.white}"
    rounded: "{rounded.square}"
  tab-active:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.cobalt}"
    rounded: "{rounded.square}"
    height: "80px"
  goal-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    height: "82px"
---

# Design System: TrainHeroic Unofficial

## Overview

**Creative North Star: "The Shared Training Log"**

The site should feel like a precise training record opened across several working surfaces: one
toolkit, parallel ways in. It is direct, technical, and candid, with enough editorial scale to make
the product thesis unmistakable. Warm paper, program rules, compressed type, and one cobalt lane
give it a world of its own without borrowing the chrome of any AI client.

The homepage uses the approved **Parallel Lanes** composition: product thesis on the left, proof on
the right, and a full-width goal index immediately below. The Blume documentation shell continues
the same tokens and custom header, but keeps documentation conventions where they aid reading,
search, and navigation.

**Key Characteristics:**

- Warm, flat paper surfaces divided by graphite program rules
- Compressed Archivo typography with deliberately large editorial headlines
- One cobalt accent reserved for actions, selected states, and full-row interaction
- Square controls and structural borders instead of ornamental cards or shadows
- Mono reserved for commands, endpoints, imports, and other literal code

## Colors

The palette is a warm neutral field with near-black ink and a single, decisive cobalt accent.

### Primary

- **Lane Cobalt** (`#2457d6`): Primary calls to action, selected tabs, focus rings, and goal-row
  interaction.
- **Deep Cobalt** (`#1945b8`): Hover state for solid cobalt actions.

### Neutral

- **Warm Paper** (`#f3f1e9`): Default page background and the defining material of the site.
- **Raised Paper** (`#faf9f4`): Subtle selected and hover surfaces; never a floating card.
- **Training Ink** (`#171714`): Headlines, body emphasis, navigation, and structural foreground.
- **Graphite** (`#55554f`): Body copy and secondary information.
- **Faint Graphite** (`#6a6962`): Labels, disclosures, and tertiary text.
- **Program Rule** (`#aaa89f`) and **Soft Rule** (`#d3d0c6`): Major and minor dividers.
- **Code Paper** (`#e9e6dc`): Inline and block code surfaces in documentation.
- **Success Green** (`#25672c`): Confirmation text after a completed utility action.

### Named Rules

**The One Lane Rule.** Cobalt is the only expressive accent. Do not introduce audience colors,
client colors, decorative gradients, or rainbow code-adjacent treatments.

## Typography

**Display Font:** Archivo Variable (with Arial Narrow and sans-serif fallback)

**Body Font:** Archivo Variable (with Arial Narrow and sans-serif fallback)

**Label/Mono Font:** UI monospace stack for literal code only

**Character:** Archivo's width axis supplies the compressed, utilitarian rhythm of a training log
without sacrificing readability. Weight and width establish hierarchy; unrelated font families do
not.

### Hierarchy

- **Display** (`wdth 66`, `wght 790`, `clamp(4rem, 7.25vw, 6rem)`, `0.87`): Homepage thesis only.
- **Headline** (`wdth 70–82`, `wght 650–740`, responsive, `0.95–1.05`): Goal rows and proof task.
- **Body** (`wdth 92`, `wght 430`, `1rem`, `1.5`): Explanations and documentation copy.
- **Label** (`wdth 86`, `wght 620`, `0.75rem`, `0.06em`): Uppercase fact labels and metadata.
- **Code** (`0.875rem`, `1.45`): Endpoints, commands, imports, and query examples.

### Named Rules

**The Literal Mono Rule.** Use monospace only when the content is typed, pasted, run, or parsed.
Product labels and navigation stay in Archivo.

## Layout

The homepage is a full-width program sheet. Desktop uses a five/seven hero split and a subtle
12-column rule field. The goal index spans the viewport beneath it so the first screen moves from
thesis, to proof, to four explicit destinations. At `64rem`, the hero stacks and the rule field
reduces to six columns. At `44rem`, the field becomes four columns, the goal index moves directly
after the thesis, and the technical proof follows it. Goal rows collapse to a single-column reading
order. The custom header is 4rem tall and can grow to two rows when narrow or text-enlarged content
needs more room.

The content rhythm uses 1px rules and broad lanes rather than boxed sections. Touch targets are at
least 44px. Long code wraps instead of forcing horizontal page overflow. Documentation pages may
use Blume's responsive sidebar, local search, page actions, and reading measure, but must inherit
the same palette, type, header, shape, and focus treatment.

## Elevation & Depth

The system is flat. It uses no shadows. Hierarchy comes from warm tonal shifts, 1px rules, cobalt
state changes, and the responsive program-rule field. A surface may change from Warm Paper to
Raised Paper on selection, but it must not appear to float.

**The Flat Record Rule.** Do not add drop shadows, glass effects, blur, or faux physical depth.

## Shapes

Controls, panels, tabs, code containers, navigation, and rows use square corners (`0`). Dividers
and the program grid are straight and restrained. Directional arrows use square caps and mitered
joins. The system avoids pills, icon bubbles, badges, and rounded card clusters.

## Components

### Buttons

- **Shape:** Square, with a minimum 44px target; the primary action is 56px tall.
- **Primary:** Lane Cobalt with white text, 24px horizontal padding, and no shadow.
- **Hover / Focus:** Deep Cobalt on hover; a 3px Cobalt outline with 3px offset on keyboard focus.
- **Text action:** Transparent surface, Cobalt text, and an underline on hover.

### Cards / Containers

- **Corner Style:** Square (`0`).
- **Background:** Warm Paper by default; Raised Paper only for selected or hovered utility states.
- **Shadow Strategy:** None.
- **Border:** 1px Program Rule for major seams and Soft Rule for internal rows.
- **Internal Padding:** Responsive, generally 16–48px depending on lane scale.

### Navigation

The custom 4rem sticky header uses a plain wordmark, quiet text links, and one solid “Connect MCP”
action. Desktop documentation adds Blume search and theme controls without adopting a template
identity. Mobile hides secondary links and exposes an explicit menu; every interactive element
keeps a 44px target.

### Proof Tabs

Four equal square tabs switch one fixed training-history task across Hosted MCP, CLI, SDK, and
Export. The selected tab uses Raised Paper, Cobalt type, and a 4px Cobalt bottom rule. Tabs implement
the ARIA tab pattern, including arrow, Home, and End keyboard navigation.

### Goal Rows

The goal index is the homepage's signature navigation. Each row presents a large goal, one-sentence
explanation, and direct action. Hover and focus invert the entire row to Cobalt with white content;
the arrow moves horizontally by `0.35rem`.

## Do's and Don'ts

### Do:

- **Do** lead with the user's goal and show a real TrainHeroic task as proof.
- **Do** keep the hosted MCP route prominent without treating one AI client as the whole product.
- **Do** use rules, alignment, and type scale to establish hierarchy.
- **Do** preserve semantic HTML, visible focus, 44px targets, reduced-motion behavior, and wrapping
  code.
- **Do** let Blume provide documentation behavior while this design system owns the visual world.

### Don't:

- **Don't** copy another product's navigation, visual identity, or client-specific hero.
- **Don't** use generic card grids, ornamental icon bubbles, pills, gradients, or shadows.
- **Don't** assign every audience or product surface a different accent color.
- **Don't** flatten the approved composition into a screenshot; keep text, controls, rules, and
  arrows semantic.
- **Don't** add backward-compatibility structure from the previous Starlight site.
