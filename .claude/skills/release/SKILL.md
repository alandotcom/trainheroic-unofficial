---
name: release
description: Cut a release of the trainheroic-unofficial packages. Use when the user wants to version, publish, or ship the packages, bump versions, run a release, or deploy the worker. The release runs in CI via a manually-triggered release.yml that versions, tags, and dispatches publish.yml; encodes that flow and its footguns (one shared version, OIDC trust bound to publish.yml, worker deploys continuously not on the bump commit, manual fallback).
---

# Releasing trainheroic-unofficial

All packages ship as one unit. The `fixed` group in `.changeset/config.json` lists every
package, so a single changeset bumps the **whole suite** to the same version. You never pick
packages individually, and you never hand-edit a version. `scripts/check-versions.mjs` (run
by `pnpm check`) fails if versions ever drift.

Publishable packages: `dto`, `js`, `core`, `cli`, `coach-mcp`, `athlete-mcp` (six). The
`cloudflare` worker is `private: true`; it versions with the group but deploys instead of
publishing.

## How releases run now

Versioning and publishing happen in CI through two workflows:

- **`.github/workflows/release.yml`** is **manually triggered** and is the only thing you run
  to cut a release. It gates on `pnpm check`, applies the pending changesets
  (`pnpm version-packages`), commits the bump to `main`, tags it `vX.Y.Z`, creates the GitHub
  release from the core changelog, then dispatches `publish.yml` against that tag.
- **`.github/workflows/publish.yml`** does the npm publish (`pnpm run release` = build +
  `changeset publish`). It is dispatched by `release.yml`; you do not push a tag by hand for a
  normal release. Auth is **npm OIDC trusted publishing** (no `NPM_TOKEN`): npm trusts this
  repo's `publish.yml` **file path**, and pnpm (>= 10.12) does the OIDC exchange when
  `id-token: write` is granted. The publish step lives in `publish.yml` precisely to keep that
  trust binding; moving it elsewhere would require reconfiguring the npm trusted publisher for
  all six packages.

Changesets accumulate as normal `.changeset/*.md` files from everyday commits (in this repo,
every commit carries a changeset). They sit on `main` until you choose to release.

## Preconditions

- `main` is CI-green and the work you want to ship is merged.
- At least one changeset is pending (otherwise `release.yml` fails fast with "No changesets
  pending"). Author one with `pnpm changeset` if needed. Because of the fixed group, which
  package you tag is immaterial; the whole suite bumps. Pick the bump type by the biggest
  change (a removed or changed tool export is breaking; under 0.x use `minor` for breaking,
  `patch` for additive). Write a summary that reads as a changelog line.
- If new TrainHeroic endpoints were added, verify them against the live test account first
  (`.env` has coach + athlete creds). Run an ad-hoc script with
  `pnpm --filter @trainheroic-unofficial/cli exec tsx <script>` importing
  `./packages/js/src/index.ts`; confirm the request shapes return 200 before shipping.

## Cutting a release

1. **Trigger `release.yml`.** From the repo: `gh workflow run release.yml` (or the Actions tab,
   "Release" → "Run workflow", on `main`). No inputs.

2. **Watch it.** `gh run watch` (or `gh run list --workflow=release.yml`). The job runs
   `pnpm check`, versions the packages, commits `chore(release): version packages to <x.y.z>`,
   pushes `main`, tags `v<x.y.z>`, creates the GitHub release, and dispatches `publish.yml`.

3. **Watch the publish.** `gh run list --workflow=publish.yml` then `gh run watch <id>`. It
   builds and runs `changeset publish` (idempotent; skips versions already on the registry;
   excludes the private worker).

4. **Verify.** `npm view @trainheroic-unofficial/core version` shows the new version, and the
   worker is live (`curl -s -o /dev/null -w '%{http_code}' https://trainheroic-mcp.alandotcom.workers.dev/mcp`
   → `401`).

## The worker deploy

`deploy.yml` deploys the worker on every push to `main` after CI passes, so the hosted worker
tracks `main` continuously from your feature commits. The release bump commit is pushed by the
Actions bot using `GITHUB_TOKEN`, which by design does **not** trigger CI (and therefore not
`deploy.yml`). That is fine: the bump commit only edits `package.json`/`CHANGELOG.md`, so the
worker's running code already matches the release; only the version string lags. If you ever
need the worker redeployed at the exact release SHA, re-run `deploy.yml` for that commit or push
a trivial follow-up commit.

## One-time repo config

- Secrets: `CLOUDFLARE_API_TOKEN` (Workers + D1 edit), `CLOUDFLARE_ACCOUNT_ID`, optional
  `SENTRY_AUTH_TOKEN` (Sentry source-map upload).
- An npm trusted publisher per package, pointing at repo `alandotcom/trainheroic-unofficial`,
  workflow **`publish.yml`**. If publishing is ever moved to a different workflow file, every
  package's trusted publisher must be re-pointed in the npmjs.com UI or the publish 403s.
- `release.yml` needs `actions: write` (to dispatch `publish.yml`) and `contents: write` (to
  push the bump and tag); both are declared in the workflow. `main` must remain pushable by the
  Actions bot (the branch is currently unprotected).

### Manual fallback (only if CI is unavailable)

The full local sequence `release.yml` automates, for an emergency release when CI is down. Run
it from a clean, CI-green `main`. Order matters: version and push first, then migrate before
deploy (so new code never queries a missing table), and deploy before publish (so the hosted
MCP and the published SDK/CLI match). Never publish a version not pushed to `main`.

```bash
pnpm check                                                  # gate before bumping
pnpm version-packages                                       # apply changesets: bump + changelogs
v=$(node -p "require('./packages/core/package.json').version")
git add -A && git commit -m "chore(release): version packages to $v"
git push origin main
git tag -a "v$v" -m "v$v" && git push origin "v$v"          # GITHUB_TOKEN-pushed tags don't fire
                                                            #   publish.yml; a human-pushed tag does
cd packages/cloudflare && pnpm run db:migrate && cd ../..   # remote D1 (idempotent)
pnpm run deploy                                             # worker + Sentry source maps
pnpm release                                               # build + changeset publish
# GitHub release notes:
awk -v v="## $v" '$0==v{f=1;next} /^## /{if(f)exit} f{print}' packages/core/CHANGELOG.md \
  > /tmp/relnotes.md
gh release create "v$v" --title "v$v" --notes-file /tmp/relnotes.md --latest
```

`pnpm run deploy` must use `run deploy` — bare `pnpm deploy` is a pnpm builtin that errors with
`ERR_PNPM_NOTHING_TO_DEPLOY`. A manual `pnpm release` needs `npm whoami` logged in with publish
rights on the `@trainheroic-unofficial` scope, and its 2FA OTP prompt is interactive (CI avoids
this via OIDC). Pushing the `v$v` tag from your laptop (not the Actions bot) does fire
`publish.yml`, so you can skip the local `pnpm release` and let CI publish instead.
