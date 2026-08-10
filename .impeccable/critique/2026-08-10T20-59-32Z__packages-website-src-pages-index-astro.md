---
target: homepage
total_score: 27
max_score: 36
na_heuristics: 7
p0_count: 0
p1_count: 4
timestamp: 2026-08-10T20-59-32Z
slug: packages-website-src-pages-index-astro
---
# Homepage Audit and Critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3/4 | Tabs show selection and copy reports a result, but transient copy status is not announced. |
| 2 | Match System / Real World | 3/4 | Goal language is plain; MCP, CLI, and SDK are unexplained for non-developers. |
| 3 | User Control and Freedom | 3/4 | Tabs, links, and mobile navigation are reversible and conventional. |
| 4 | Consistency and Standards | 4/4 | Visual, semantic, interaction, and responsive patterns are unusually cohesive. |
| 5 | Error Prevention | 3/4 | Labels are clear, but fixed-date CLI proof becomes misleading as time passes. |
| 6 | Recognition Rather Than Recall | 3/4 | Both taxonomies are visible, but users must map technical surfaces to goals. |
| 7 | Flexibility and Efficiency | n/a | Not meaningful for this Persuade surface. |
| 8 | Aesthetic and Minimalist Design | 3/4 | Strong restraint; duplicated surface and goal choices weaken focus. |
| 9 | Error Recovery | 2/4 | Clipboard failure identifies failure without explaining recovery. |
| 10 | Help and Documentation | 3/4 | Help routes are visible, but Docs and Connect MCP currently share a destination. |
| **Total** |  | **27/36** | **Good — 75%** |

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|---|---:|---|
| 1 | Accessibility | 2/4 | Faint proof labels fall to 4.33:1 over program-rule stripes. |
| 2 | Performance | 4/4 | Static Astro, one variable font, minimal scripts; local FCP/LCP 76ms and CLS 0. |
| 3 | Responsive Design | 2/4 | Default mobile works, but 200% text scaling expands the page to 604px at a 390px viewport. |
| 4 | Theming | 3/4 | Strong tokens with a few repeated hard-coded colors. |
| 5 | Implementation Integrity | 3/4 | Coherent system; fixed dates and Claude-specific social metadata will drift. |
| **Total** |  | **14/20** | **Good — address accessibility and reflow before release** |

## Design Specificity Verdict

**Pass: authored and product-specific, not category-interchangeable.** The program-grid field,
compressed Archivo, warm paper, cobalt lane, fixed-task proof, and full-width goal rows form a
coherent Shared Training Log world. It avoids generic SaaS cards, AI-client chrome, and copied
Blume or Sentry aesthetics.

The missed opportunity is product truth rather than visual identity. The proof is strongly oriented
toward athlete history and developer tooling; TrainHeroic's coach-and-athlete breadth is barely
visible.

### Deterministic scan

The CLI detector ran exactly once and returned exit 0 with `[]`: zero findings, rule names, or file
locations. The injected browser detector reported six instances across five families:

- `low-contrast` x2 on visible proof labels: verified true.
- `text-overflow` on the H1: false positive at normal desktop and mobile, though the separate 200%
  scaling test found a genuine page-level reflow defect.
- `tight-leading` on supporting display copy: intentional and legible.
- `cream-palette`: intentional; Warm Paper is normative in DESIGN.md.
- `repeating-stripes-gradient`: intentional; the program-rule field is the approved signature form.

The detector overlays remain visible in the **[Human] TrainHeroic homepage audit** browser tab.

## Overall Impression

This is a successful visual replacement with a real point of view. The single biggest opportunity
is to make the page's decision sequence as clear as its visual system: on mobile especially, people
should choose their goal before they are asked to understand the toolkit's technical surfaces.

## What's Working

- **The visual world is genuinely specific.** The composition, type, rules, palette, and square
  controls reinforce one coherent product idea instead of decorating a template.
- **The proof is credible.** Holding one training-history task constant across Hosted MCP, CLI,
  SDK, and Export makes the multi-surface thesis tangible.
- **The technical foundation is lean.** Semantic landmarks, ARIA tabs, keyboard navigation, visible
  focus, reduced motion, wrapping code, zero axe violations, no failed assets, and near-zero local
  layout shift are strong foundations.

## Cognitive Load

Desktop is **moderate** with three checklist failures; mobile is **high** with four.

- **Single focus fails:** the surface selector and goal selector compete.
- **One thing at a time fails:** visitors answer both “which technology?” and “what do I want?” in
  the opening sequence.
- **Minimal choices fails:** four tabs, two proof links, and four goal rows create ten actions before
  header navigation.
- **Working memory fails on mobile:** goal-first navigation arrives after the thesis and tall proof,
  requiring visitors to remember technical surfaces while evaluating later goals.

Chunking, grouping, visual hierarchy, and progressive disclosure inside the active proof all pass.

## Emotional Journey

- **Arrival:** confident, distinctive, and serious.
- **Comprehension peak:** the real prompt, endpoint, and command examples turn a claim into proof.
- **Valley:** nontechnical visitors meet MCP, CLI, and SDK before they meet goal-oriented guidance.
- **High-stakes moment:** Connect hosted MCP asks for trust without nearby credential or role context.
- **Ending:** the candid unofficial-API disclaimer is responsible, but the page ends on caveats
  rather than reassurance or forward momentum.

## Priority Issues

### [P1] Mobile buries the goal-first path beneath technical proof

- **Why it matters:** At 390x844, no goal row appears in the first viewport. A first-timer must
  traverse the thesis, a horizontally scrolling technology selector, and a tall proof panel before
  reaching the plain-language choices the homepage exists to provide.
- **Fix:** On narrow screens, place the goal index directly after the thesis, or add a compact
  Choose by goal jump before the proof. Keep Hosted MCP as the initial proof, not the compulsory
  first taxonomy.
- **Locations:** `src/pages/index.astro:127`, `src/pages/index.astro:192`,
  `src/styles/global.css:590`.
- **Suggested command:** `$impeccable layout`

### [P1] The layout fails 200% text reflow

- **Why it matters:** At a 390px viewport with root text scaled to 32px, document width becomes
  604px; low-vision users must pan horizontally and can lose navigation and content.
- **Fix:** Add `min-width: 0` at expanding grid/flex seams, constrain the display heading to the
  viewport, review rem-based breakpoints under text enlargement, and add a 200% scaling regression
  case.
- **Standard:** WCAG 1.4.4 Resize Text and 1.4.10 Reflow.
- **Locations:** `src/styles/global.css:202`, `:555`, `:590`; `src/components/Header.astro:294`.
- **Suggested command:** `$impeccable adapt`

### [P1] The connect decision lacks adjacent trust and role context

- **Why it matters:** The primary action asks people to connect an unofficial integration using
  undocumented APIs, while OAuth/privacy context is below the entire goal index. At the same time,
  the proof shows only athlete history, so coaches cannot see that roster, programming, analytics,
  and communication workflows exist.
- **Fix:** Add one compact line below the MCP action: existing account required, OAuth-based access,
  privacy link, and a role-aware capability sentence. Preserve unofficial in the mobile identity.
  Do not add cards or another selector.
- **Locations:** `src/pages/index.astro:25`, `:85`, `:175`, `:209`;
  `src/components/Header.astro:318`.
- **Suggested command:** `$impeccable clarify`

### [P1] Proof labels fail minimum contrast over program rules

- **Why it matters:** The 12px uppercase labels are 4.33:1 where glyphs cross a rule stripe, below
  the 4.5:1 AA requirement. This affects the exact utility text users need to interpret the proof.
- **Fix:** Use the darker muted token for proof labels or prevent program rules from passing beneath
  small faint text.
- **Standard:** WCAG 2.1 1.4.3 Contrast (Minimum).
- **Locations:** `src/styles/global.css:191`, `:341`; `src/pages/index.astro:161`.
- **Suggested command:** `$impeccable colorize`

### [P2] Navigation and feedback information scent is inconsistent

- **Why it matters:** Docs and Connect MCP lead to the same page; clipboard failure provides no
  recovery; the mobile brand and footer links miss the project's 44px touch-target standard. These
  are individually recoverable but collectively make the quiet utility layer less trustworthy than
  the primary composition.
- **Fix:** Give Docs a real overview destination or relabel it, announce copy status with `aria-live`
  and an actionable fallback, and expand brand/footer hit areas without changing their visual size.
- **Locations:** `src/components/Header.astro:24`, `:43`; `src/pages/index.astro:165`, `:267`;
  `src/styles/global.css:169`.
- **Suggested command:** `$impeccable harden`

## Additional Audit Findings

- **[P2] Date-bound proof drift:** `--start 2026-07-13 --end 2026-08-10` stops representing the last
  four weeks after the audit date. Generate current values, support a relative form, or label it as
  an example. (`src/pages/index.astro:43`)
- **[P2] Client-specific social metadata:** the default OG alt says Connect TrainHeroic to Claude
  via MCP, contradicting the multi-surface homepage. Replace image and alt with the client-neutral
  proposition. (`src/layouts/Layout.astro:15`)
- **[P3] Token duplication:** hard-coded cobalt and white remain in the shared header and homepage.
  Route them through the existing token layer before adding another theme. (`Header.astro:218`,
  `global.css:55`, `:408`, `:498`)

## Persona Red Flags

- **Jordan, first-timer:** MCP, CLI, and SDK arrive before explanation; the mobile goal path is
  below a long technical proof; Docs and Connect MCP then go to the same place.
- **Riley, stress tester:** the supposedly current four-week command is date-bound, clipboard
  failure disappears without recovery guidance, and the default social preview contradicts the
  page's positioning.
- **Casey, distracted mobile user:** the first goal is below the fold, Export starts outside the
  tab-strip viewport, and several quiet navigation targets are shorter than 44px.
- **Coach or athlete visitor:** athletes see a relevant task but must decode developer terms;
  coaches see no concrete roster, programming, analytics, or messaging proof.

## Minor Observations

- The proof tab strip's partial fourth tab is a usable but weak horizontal-scroll cue.
- Claude Code appears once in the terminal goal. It does not dominate, but slightly reinforces the
  developer skew.
- No-script behavior correctly retains Hosted MCP as the essential fallback.
- At default 390px sizing there is no page-level horizontal overflow; the tab strip's internal
  480px scroll is intentional.
- Performance is not a current concern: local TTFB was 1.8ms, FCP/LCP 76ms, and CLS effectively 0.

## Questions to Consider

- If a coach lands here, what single sentence proves this toolkit understands coaching rather than
  only workout history?
- Should mobile visitors choose their goal before choosing MCP, CLI, SDK, or Export?
- What minimum privacy reassurance belongs beside Connect hosted MCP?
- If Docs and Connect MCP are different intents, why do they open the same page?
