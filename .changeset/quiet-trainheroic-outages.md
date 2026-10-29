---
"@trainheroic-unofficial/js": minor
"@trainheroic-unofficial/cloudflare": patch
---

Treat a TrainHeroic outage as an outage. `loginTrainHeroic` now throws `TrainHeroicUnavailableError`
when the login endpoint answers 502, 503, 504, or a Cloudflare 520-530 status (such as 522, when
Cloudflare cannot reach TrainHeroic's origin), instead of returning `null` as if the credentials
were wrong. Tools relay "TrainHeroic is not responding right now, try again in a few minutes", and
the hosted login form shows that message with a 503. The hosted Worker counts these statuses as
the `trainheroic.upstream.unavailable` metric and no longer opens a Sentry issue for them.
