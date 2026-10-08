---
"@trainheroic-unofficial/cloudflare": patch
---

Upgrade the hosted Worker to `@cloudflare/workers-oauth-provider` 1.2.3. Tokens are bound to `<origin>/mcp`, which is the resource existing grants already carry, so connected users stay signed in. A user whose connector was added with a `/mcp/coach` or `/mcp/athlete` URL is asked to reconnect once. The daily OAuth purge now resumes where the previous run stopped, and Sentry receives only server errors and resource or client-metadata failures from the OAuth provider.
