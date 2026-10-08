## Deploy

The site is served from `https://trainheroic-unofficial.com` by
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), built at the root path
with no `ASTRO_BASE`.

### Old GitHub Pages address

`https://alandotcom.github.io/trainheroic-unofficial/` only redirects.
`.github/workflows/website.yml` publishes `pages-redirect/index.html` to GitHub Pages as both
`index.html` and `404.html`, so every old path loads it and the page sends the reader to the same
path on the custom domain. The workflow runs when that file or the workflow changes. Pages stays
enabled in repo **Settings → Pages** with source **GitHub Actions**.

### Cloudflare Worker (static assets)

The site is a static-assets Worker (`trainheroic-unofficial`) — no Worker script, just `assets.directory` in `wrangler.jsonc`. Connect this repository via **Workers & Pages → Create → Import from Git** and enable [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Use the **repository root** as the project root:

| Setting              | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| Build command        | `pnpm install && pnpm website:build`                                 |
| Deploy command       | `pnpm --filter @trainheroic-unofficial/website exec wrangler deploy` |
| Environment variable | `NODE_VERSION=24`                                                    |

Custom domains (`trainheroic-unofficial.com`, `www`) are declared in `wrangler.jsonc` and attached on deploy. Do not add a GitHub Actions deploy step for Cloudflare — Workers Builds runs on push.

Local preview after `pnpm build`:

```bash
pnpm --filter @trainheroic-unofficial/website exec wrangler dev
```
