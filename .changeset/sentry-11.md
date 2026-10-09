---
"@trainheroic-unofficial/cloudflare": patch
"@trainheroic-unofficial/db": minor
---

Upgrade the hosted Worker to Sentry 11.5 with every data-collection category switched off, so request headers, bodies, cookies, query strings, and database query parameters stay out of Sentry. `makeD1Warehouse` in `@trainheroic-unofficial/db/d1` no longer takes an `instrument` option; pass a binding that is already instrumented.
