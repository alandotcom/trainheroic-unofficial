---
"@trainheroic-unofficial/cloudflare": patch
---

Stop opening Sentry issues for OAuth resource rejections at `/token` that match no live grant.
These come from a client retrying a refresh token for a grant the server no longer holds, which
no user action on this side can fix; they are now counted as the
`oauth.resource.rejected_unattributed` metric. Rejections that match a live grant still report a
warning with the account email. Attribution now also reads the client ID from HTTP Basic client
credentials, so a `client_secret_basic` client is matched to its grant.
