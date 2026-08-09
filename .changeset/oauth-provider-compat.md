---
"@trainheroic-unofficial/cloudflare": patch
---

Harden the hosted OAuth flow for workers-oauth-provider 0.10: return safe authorization error redirects, report CIMD resolution failures without leaking request details, and preserve concurrent device grants for CIMD clients.
