---
"@trainheroic-unofficial/dto": patch
"@trainheroic-unofficial/js": patch
"@trainheroic-unofficial/core": patch
"@trainheroic-unofficial/cli": patch
"@trainheroic-unofficial/coach-mcp": patch
"@trainheroic-unofficial/athlete-mcp": patch
---

fix(cloudflare): make hosted login and open-registration copy role-neutral

Athletes authenticate through the same OAuth flow as coaches, but the consent page, the
DEPLOY.md open-registration note, and the open-registration warning all framed it as
coach-only. They now say "account" (coach or athlete) instead.
