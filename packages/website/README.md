## Deploy

Two hosts, two builds:

| Host                                                   | Builder                                                                                    | Build env                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| `https://alandotcom.github.io/trainheroic-unofficial/` | GitHub Actions (`.github/workflows/website.yml`)                                           | `ASTRO_BASE=/trainheroic-unofficial/` |
| `https://trainheroic-unofficial.com`                   | [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) (connected repo) | none (defaults to `/`)                |

### GitHub Pages

Pushes to `main` build with the project subpath and deploy via GitHub Pages. Enable Pages in repo **Settings → Pages** with source **GitHub Actions**.

### Cloudflare Worker (static assets)

The site is a static-assets Worker (`trainheroic-website`) — no Worker script, just `assets.directory` in `wrangler.jsonc`. Connect this repository via **Workers & Pages → Create → Import from Git** and enable [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

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
