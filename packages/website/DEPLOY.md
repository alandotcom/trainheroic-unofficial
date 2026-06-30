# Deploying the website

CI builds the Astro site and publishes it to GitHub Pages on pushes to `main`
(`.github/workflows/website.yml`). The build job succeeded on first merge; the
deploy job needs a one-time repository setting before it can publish.

## One-time setup (repository admin)

GitHub Pages must be enabled with **GitHub Actions** as the build source. The
workflow cannot turn this on by itself.

1. Open [repository Settings → Pages](https://github.com/alandotcom/trainheroic-unofficial/settings/pages).
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Re-run the failed workflow (Actions → **Deploy website** → **Re-run all jobs**)
   or push any commit to `main`.

Equivalent API call (requires admin or Pages settings permission):

```bash
gh api -X POST repos/alandotcom/trainheroic-unofficial/pages -f build_type=workflow
```

## Custom domain (optional)

When `trainheroic-unofficial.com` is ready, add it under **Custom domain** on
the same Pages settings page. `astro.config.mjs` already sets
`site: "https://trainheroic-unofficial.com"` for canonical URLs.

Until the domain is configured, the site is served from
`https://alandotcom.github.io/trainheroic-unofficial/`.

## Verify

After Pages is enabled and the workflow is green:

- Default URL: `https://alandotcom.github.io/trainheroic-unofficial/`
- Custom domain (when set): `https://trainheroic-unofficial.com`

Check status:

```bash
gh api repos/alandotcom/trainheroic-unofficial/pages --jq '{status, html_url, build_type}'
```
