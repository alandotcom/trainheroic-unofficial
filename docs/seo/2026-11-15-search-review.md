# TrainHeroic search review

The [marketing-skills second pass](2026-11-15-marketing-review.md) records subsequent content
corrections, crawler diagnosis, sample-export proof, and existing telemetry measurements.

## Baseline

The supplied Search Console archive covers August 14 through November 13, 2026, with the
filter `Web (text-based)`. `Chart.csv` contains 92 daily rows: **108 clicks, 1,311 impressions,
and 8.24% CTR**. The impression-weighted position calculated from the rounded daily positions
is approximately 7.60.

| Metric | September 19–October 16 | October 17–November 13 | Change |
| --- | ---: | ---: | ---: |
| Clicks | 34 | 46 | +35.3% |
| Impressions | 387 | 508 | +31.3% |
| CTR | 8.79% | 9.06% | +0.27 percentage points |
| Approximate average position | 6.39 | 5.82 | Improved by 0.57 |

Both comparison periods contain 28 days. The sample is small, so these changes describe the
baseline rather than a reliable growth forecast.

Sources supplied with the request:

- `trainheroic-unofficial.com-Performance-on-Search-2026-11-15.zip`: `Chart.csv`, `Pages.csv`,
  `Queries.csv`, and `Filters.csv` supply the baseline and opportunities below.
- `trainheroic-unofficial.com_KeywordReport_11_16_2026.csv`: 70 rows, 107 impressions, and five
  clicks. The file contains no reporting-period field. Treat it as a separate keyword snapshot,
  not an extension of the archive. One query has malformed CSV quoting around a Windows path;
  that query is excluded from content decisions.

Search Console query rows omit some queries. Page impressions can overlap when several URLs
appear in one result set. Do not reconcile either breakdown to site totals by adding missing
traffic or treating page impressions as unique searches.

## Priorities and changes

| Priority | Search evidence | Destination and implementation |
| --- | --- | --- |
| 1. Explain workout exports before sign-in | `/export` has six clicks / 293 impressions; `/export/` has nine / 273. Combined page-row CTR is 2.65%. The keyword snapshot asks about CSV columns, spreadsheets, data downloads, and account exports. | Expanded `/export` with instructions, format choices, all 14 CSV headers, blank-value and unit behavior, and limits on program/account exports. Added links to printing, import, CLI, and connector workflows. |
| 2. Make API intent explicit | `trainheroic api` has 11 clicks / 69 impressions at position 4.59. `train heroic api` has five / 33 at position 5.15. `/developers` already receives 21 clicks. | Retained `/developers` as the API destination. Updated its title, description, opening answer, authentication explanation, and role/access summary. Preserved the existing quickstarts. |
| 3. Clarify the MCP offering | `trainheroic mcp` has five clicks / 36 impressions. Snapshot queries ask whether Claude can connect and how trainers can set up programming. | Improved homepage and MCP titles/descriptions, connected the MCP overview to Claude setup, and linked setup to the import and printing guides. |
| 4. Cover specific adjacent tasks | Snapshot queries ask about printing, PDFs, Excel/CSV imports, and exporting programs. These are low-volume observations, not proven large markets. | Added `/guides/print-workouts`, `/guides/import-workouts`, and a `/guides` index. Instructions distinguish available workflows from unsupported automatic conversions. |
| 5. Explain integrations | `trainheroic integrations` has 16 impressions, no clicks, and position 26.88. | Added `/integrations`, comparing AI clients, manual spreadsheet transfers, CLI automation, and the SDK. Linked guides and integrations from both site footers and the homepage. |
| 6. Answer common questions | The keyword snapshot includes direct questions about Claude connections, exports, printing, spreadsheet imports, and browser access. A follow-up request asked for an FAQ page. | Added `/faq` with 12 concise answers and links to the detailed guides. Linked it from both site footers and the support and integrations pages. |

The changes use existing pages where the intent already has a destination. They do not create
duplicate API or export landing pages. Login and official support queries remain outside the
site's acquisition focus because this project provides an unofficial toolkit.

## Technical SEO

- The repository already uses Cloudflare static assets with `html_handling:
  "drop-trailing-slash"`. Live checks confirmed that `/export/` redirects to `/export` with a
  temporary 307. Added explicit permanent 301 redirects for the trailing-slash variants present
  in the supplied report: `/export/`, `/developers/`, and `/developers/skill/`. Other routes retain
  Cloudflare's automatic normalization.
- Custom-page canonical URLs now normalize trailing slashes and include `ASTRO_BASE`. Open
  Graph URLs and WebPage structured data use the same canonical. The public metadata contains
  no signed-in user's training data.
- Custom pages now emit WebPage JSON-LD. Blume supplies metadata and structured data for MDX
  pages. This change does not claim eligibility for special search-result features.
- Blume generates the sitemap, robots file, local search records, and AI-readable documentation.
  The new guide, integration, and FAQ pages use that pipeline rather than introducing parallel feeds.
- The FAQ is an ordinary searchable content page. Google retired FAQ rich results in May 2026,
  so the page's purpose is to answer relevant questions and route readers to the right workflow.
  See [Google's documentation update](https://developers.google.com/search/updates#june-2026).
- Live curl requests confirmed HTTP 200 for the homepage, developer page, export page, sitemap,
  and robots file. The deployed sitemap contains 18 URLs before this change, and robots allows
  crawling. The www export page serves HTTP 200 with an apex-domain canonical. Python urllib
  and the web-fetch client received HTTP 403, so automated-client treatment differs. Search
  Console URL Inspection is still needed to verify Google's actual access and selected canonical.

Google recommends consistent canonical signals and links to canonical URLs. Its SEO starter
guide also recommends descriptive titles and useful content aligned with readers' needs:

- [Google: canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Blume: metadata](https://useblume.dev/docs/discoverability/metadata)
- [Blume: sitemap and robots](https://useblume.dev/docs/discoverability/sitemap-and-robots)
- [Cloudflare: static-asset redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)

## Validation

- `pnpm check` passed: version consistency, formatting, lint, all workspace typechecks, 691
  Vitest tests, and two Node script tests. The fresh checkout first needed the ignored
  Cloudflare type declarations generated with the package's `cf-typegen` command.
- The strict website build and link validation passed. The final sitemap has 23 pages.
- Parsed the built HTML for all sitemap pages and checked unique titles, descriptions,
  self-referencing canonicals, one H1 per page, Open Graph URLs, valid JSON-LD, and 1,733 local
  links and anchors. Checked the export's CSV headers, robots file, and new MDX pages' presence
  in `llms.txt`.
- Built with `ASTRO_BASE=/seo-check` and repeated the metadata/link checks. The check caught
  a base-homepage trailing-slash discrepancy, which was fixed before the successful rerun.
- Ran the built site in local Wrangler. Verified the three explicit 301 redirects with and
  without query strings, their final HTTP 200 destinations, the four guide and integration pages, the sitemap,
  robots file, and an unknown route's HTTP 404. Stopped the verification server afterward.
- Checked the FAQ's static HTML answers, sitemap entry, local search record, `llms.txt` entry,
  and incoming links from the homepage, export, support, and integrations pages.
- No authenticated export, account mutation, production deployment, or Search Console write
  was performed.

## Measurement after deployment

1. Inspect `/export`, `/developers`, `/integrations`, `/faq`, and the two task guides in Search Console.
   Check the fetched response, indexing permission, rendered content, and selected canonical.
   Confirm `/export/` redirects to `/export` and that the www host selects the apex canonical.
2. Check the deployed `/sitemap.xml`, then submit it in Search Console if it is not already
   submitted. Request indexing for the new pages after their URLs are reachable.
3. After 28 complete days, compare with the preceding 28 days using the same search type.
   Track site clicks/impressions and export-page CTR. Group export URL variants consistently
   and keep page and site metrics separate.
4. Track the API, MCP/Claude, export, print/PDF, import/spreadsheet, and integrations query groups.
   Separate newly indexed pages from existing pages when interpreting changes. Avoid attributing
   every ranking change to these edits.
5. Revisit titles where impressions rise without clicks, using query intent and position
   together. Consider another guide when repeated queries reveal a question the current pages
   cannot answer accurately. Add account-connection or download completion analytics only as a
   separate product decision; this change adds no credential or training-data tracking.

Deployment and Search Console submissions are not part of this local change. The repository's
existing Workers Builds integration publishes the website when the changes reach its connected
branch.
