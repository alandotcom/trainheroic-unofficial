## Deploy

Two hosts, two builds:

| Host | Builder | Build env |
|------|---------|-----------|
| `https://alandotcom.github.io/trainheroic-unofficial/` | GitHub Actions (`.github/workflows/website.yml`) | `ASTRO_BASE=/trainheroic-unofficial/` |
| `https://trainheroic-unofficial.com` | [Cloudflare Pages](https://developers.cloudflare.com/pages/) (connected repo) | none (defaults to `/`) |

### GitHub Pages

Pushes to `main` build with the project subpath and deploy via GitHub Pages. Enable Pages in repo **Settings → Pages** with source **GitHub Actions**.

### Cloudflare Pages

Connect this repository in the Cloudflare dashboard (**Workers & Pages → Create → Pages → Connect to Git**). Use the **repository root** as the project root:

| Setting | Value |
|---------|-------|
| Framework preset | None |
| Build command | `pnpm install && pnpm website:build` |
| Build output directory | `packages/website/dist` |
| Environment variable | `NODE_VERSION=24` |

Add custom domains (`trainheroic-unofficial.com`, `www`) in the Pages project settings. Do not add a GitHub Actions deploy step for Cloudflare — Pages builds on its own when you push.

`wrangler.jsonc` documents the static output layout for local `wrangler dev` in `packages/website` after `pnpm build`.
