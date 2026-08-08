---
"@trainheroic-unofficial/js": patch
---

Add a sanitized HTTP-error callback to the TrainHeroic client and login helper so hosts can report final upstream 4xx/5xx responses without exposing paths, credentials, bodies, query strings, or session tokens.
