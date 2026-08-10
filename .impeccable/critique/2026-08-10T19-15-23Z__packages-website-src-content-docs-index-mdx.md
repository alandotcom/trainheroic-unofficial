---
target: the main page
total_score: 24
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
timestamp: 2026-08-10T19-15-23Z
slug: packages-website-src-content-docs-index-mdx
---
Method: dual-agent (A: homepage_design_review · B: homepage_detector)

## Design Health Score

| # | Heuristic | Score | Key issue |
| --- | --- | --- | --- |
| 1 | Visibility of system status | 2/4 | Copy actions confirm, but the page never defines the connected state. |
| 2 | Match with the real world | 3/4 | TrainHeroic language is clear; connector terminology is mostly explained through action. |
| 3 | User control and freedom | 2/4 | The first setup action leaves the page before the user has the URL needed next. |
| 4 | Consistency and standards | 4/4 | The Blume shell and content patterns are cohesive and predictable. |
| 5 | Error prevention | 2/4 | The page creates an avoidable cross-tab failure and gives little reassurance at sign-in. |
| 6 | Recognition rather than recall | 2/4 | Users must remember to return for the URL; prompt cards hide the exact copied question. |
| 7 | Flexibility and efficiency | 2/4 | Direct links and copy controls help, but the primary sequence remains fragile. |
| 8 | Aesthetic and minimalist design | 3/4 | The page is restrained, but docs chrome and equal-weight next steps dilute the main task. |
| 9 | Error recognition and recovery | 1/4 | No failure states or troubleshooting route are presented. |
| 10 | Help and documentation | 3/4 | The content is concise and searchable, but help is absent at authentication and connection failure. |
| **Total** |  | **24/40** | **Acceptable; significant activation improvements needed.** |

## Design Specificity Verdict

The content is product-specific; the composition is not. Exact TrainHeroic concepts—rosters, programming, PRs, working maxes, and destructive actions—make the copy credible. Structurally, however, this is still a generic documentation index: three-column docs shell, numbered steps, tabbed examples, and a four-card next-step grid. Another connector could use the same page after swapping nouns.

The deterministic scan found zero rule violations in `packages/website/src/content/docs/index.mdx`. That confirms the implementation is mechanically clean, not that the experience is clear. Browser inspection confirmed one H1, three H2s, no horizontal overflow at 1280×720, and a sound semantic foundation. Mutable overlay injection was unavailable, so there is no reliable user-visible overlay; the fallback was a read-only DOM snapshot, full-page screenshot, and browser measurements.

## Overall Impression

The page looks calm and competent, but it behaves like a place to browse documentation rather than a focused activation surface. The main opportunity is to turn it into one continuous journey: copy the URL, open Claude, sign in with confidence, recognize success, and ask the first question.

## What’s Working

1. The primary task begins immediately, without a marketing preamble.
2. Coach and athlete value are established economically and reinforced with role-specific examples.
3. Typography, spacing, semantic structure, responsive reflow, search, skip navigation, and copy feedback are solid.

## Priority Issues

### [P1] The setup sequence creates its own failure mode

The first step sends users to Claude before showing the connector URL required by the next step. A literal first-timer loses the instructions and must navigate back or remember what to recover.

**Fix:** Make the order: copy the connector URL; open Claude connector settings in a new tab; name it TrainHeroic, paste, and sign in. Keep the URL visually present throughout the sequence.

**Suggested command:** `$impeccable onboard`

### [P1] The highest-trust moment lacks local reassurance

An unofficial connector asking for a TrainHeroic password is the page’s biggest abandonment risk. The privacy link arrives after the request instead of resolving concern at the point of action.

**Fix:** Put a short factual explanation under sign-in: where credentials are stored, what Claude receives, and a direct link to the full privacy explanation. Move the destructive-action confirmation reassurance into this trust block.

**Suggested command:** `$impeccable clarify`

### [P2] The strongest product proof is hidden

Prompt cards foreground generic descriptions such as “See who has trained recently” while concealing the exact TrainHeroic question they copy. Users cannot inspect what the action will place on the clipboard.

**Fix:** Show the full question as primary text, use the description as a small secondary label if needed, and give copy buttons specific accessible names. Increase mobile hit areas to at least 44×44 CSS pixels.

**Suggested command:** `$impeccable clarify`

### [P2] Success and recovery are undefined

The instructions end after authentication. Users are not told what a successful connection looks like, what to ask first, or where to go when credentials or connection fail.

**Fix:** End with a compact “You’re connected when…” state and one exact first question. Add a small “Trouble connecting?” path for rejected credentials, missing account access, and connection errors.

**Suggested command:** `$impeccable harden`

### [P2] The homepage ends in four equal destinations

Capabilities, privacy, export, and developer tooling receive the same visual weight. This reintroduces the audience split the navigation already solved and weakens the activation endpoint.

**Fix:** Replace the card grid with one recommended continuation, “See what Claude can do,” plus quieter text links for privacy and export. Leave developer routing in the top-level Developers tab or a quiet footer link.

**Suggested command:** `$impeccable distill`

## Persona Red Flags

### Jordan — confused first-timer

- Follows step one literally and loses the URL required by step two.
- Hesitates when an unofficial project requests the same password used in TrainHeroic.
- Cannot inspect the exact prompt before copying it.
- Has no visible recovery path when Claude rejects the connection.

### Casey — distracted mobile user

- A tab switch or interruption breaks the setup sequence.
- The connector URL is visually truncated in the narrow code block.
- Several copy and header controls measure roughly 30–36 pixels, below the preferred 44-pixel touch target.
- The long card stack pushes the meaningful endpoint below the fold without a completion cue.

### TrainHeroic coach or athlete

- Domain-specific payoff is muted because exact questions are hidden behind generic labels.
- Athletes see Coach selected by default and must notice the role switch.
- Credential and destructive-action reassurance arrives too late.
- Equal emphasis on developer tooling can imply that technical knowledge is required.

## Minor Observations

- The desktop sidebar, right rail, page actions, feedback controls, and pagination are individually subdued but collectively heavy for a single-purpose homepage.
- Heading-link accessible names include a trailing hash character.
- Mobile navigation is semantically sound and has an explicit close control.
- A neutral first prompt could avoid making Coach feel like the assumed primary role.

## Questions to Consider

- Why is the connector URL introduced only after the action that removes it from view?
- What proof does an unofficial connector need to earn a password at the exact moment it asks?
- If the real TrainHeroic questions are the strongest evidence of value, why hide them?
- Should the homepage end in four more reading choices, or one unmistakable “you’re connected—ask this” moment?
