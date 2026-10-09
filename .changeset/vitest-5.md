---
"@trainheroic-unofficial/dto": patch
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/core": patch
"@trainheroic-unofficial/cli": patch
"@trainheroic-unofficial/coach-mcp": patch
"@trainheroic-unofficial/athlete-mcp": patch
"@trainheroic-unofficial/cloudflare": patch
"@trainheroic-unofficial/db": patch
---

Run the test suites on vitest 5.0.3. The hosted Worker's tests move to `@cloudflare/vitest-plugin` 1.4.0, the first release with vitest 5 support, and wrangler moves to 4.149.0 to match the plugin. These are development dependencies, so published package contents are unchanged.
