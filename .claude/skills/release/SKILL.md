---
name: release
description: Cut a release of the trainheroic-unofficial packages. Use when the user wants to version, publish, or ship the packages, bump versions, run a release, or deploy the worker. Encodes the changeset → version → commit → push → migrate → deploy → publish flow and its footguns (one shared version, `run deploy`, apply remote D1 migrations first, deploy-before-publish, Sentry source-map upload).
---

# Releasing trainheroic-unofficial

All packages ship as one unit. The `fixed` group in `.changeset/config.json` lists every
package, so a single changeset bumps the **whole suite** to the same version. You never pick
packages individually, and you never hand-edit a version. `scripts/check-versions.mjs` (run
by `pnpm check`) fails if versions ever drift.

Publishable packages: `dto`, `js`, `core`, `cli`, `coach-mcp`. The `cloudflare` worker is
`private: true` — it versions with the group but deploys instead of publishing.

## Preconditions

- On `main`, working tree clean.
- `pnpm check` is green (this also runs the version-parity guard).
- If new TrainHeroic endpoints were added, verify them against the live test account first
  (`.env` has coach + athlete creds). Run an ad-hoc script with
  `pnpm --filter @trainheroic-unofficial/cli exec tsx <script>` importing
  `./packages/js/src/index.ts`; confirm the request shapes return 200 before shipping.

## Steps

1. **Author a changeset** if none is pending: `pnpm changeset`. Because of the fixed group,
   which package you tag is immaterial — the whole suite bumps. Pick the bump type by the
   biggest change in the release (a removed/changed tool export is breaking; under 0.x use
   `minor` for breaking, `patch` for additive). Write a summary that reads as a changelog
   line.

2. **Apply it:** `pnpm version-packages`. This bumps every package to the same new version,
   writes CHANGELOGs, rewrites internal ranges (they stay `workspace:*`), and deletes the
   consumed changeset.

3. **Verify:** `pnpm run check:versions` shows one version across all packages, and
   `pnpm check` is green.

4. **Commit** the bump: `chore(release): version packages to <x.y.z>`.

5. **Push:** `git push` to `main`.

5b. **Tag the release and cut GitHub release notes.** Every version bump gets an annotated
   `vX.Y.Z` tag on the bump commit and a matching GitHub release. The release body is the
   version's section from `packages/core/CHANGELOG.md`.

   ```bash
   git tag -a "v<x.y.z>" -m "v<x.y.z>" && git push origin "v<x.y.z>"
   # body = the "## <x.y.z>" section of packages/core/CHANGELOG.md
   awk -v v="## <x.y.z>" '$0==v{f=1;next} /^## /{if(f)exit} f{print}' \
     packages/core/CHANGELOG.md > /tmp/relnotes.md
   gh release create "v<x.y.z>" --title "v<x.y.z>" --notes-file /tmp/relnotes.md --latest
   ```

   Tags use the `v` prefix and point at the bump commit. If older releases are ever missing
   tags, backfill them by mapping each version to the commit whose diff set that version in
   `packages/core/package.json` (`git log -p -- packages/core/package.json`), tagging that
   commit, and creating its release with `--latest=false`.

6. **CI takes over — migrate, deploy, and publish are automated.** Pushing the bump commit
   and the tag is all you do; two workflows finish the release:

   - **`.github/workflows/deploy.yml`** runs after the `CI` workflow goes green on `main`. It
     applies remote D1 migrations (`pnpm --filter …/cloudflare run db:migrate`, idempotent) and
     then deploys the worker (`pnpm run deploy` → `scripts/deploy.sh`, incl. Sentry source maps
     when `SENTRY_AUTH_TOKEN` is set). So step 5's push to `main` triggers the deploy.
   - **`.github/workflows/publish.yml`** runs on the `v*` tag from step 5b. It builds and runs
     `changeset publish` (idempotent; skips versions already on the registry; excludes the
     private worker). Auth is **npm OIDC trusted publishing** — no `NPM_TOKEN`; the workflow has
     `id-token: write` and npm trusts this repo's `publish.yml`, so pnpm exchanges the OIDC token
     itself. No interactive 2FA.

   Watch both: `gh run watch` (or `gh run list --workflow=deploy.yml` / `--workflow=publish.yml`).
   Confirm the worker is live (`curl -s -o /dev/null -w '%{http_code}' .../mcp` → 401) and that
   `npm view @trainheroic-unofficial/core version` shows the new version once publish finishes.

   Required repo config (one-time): secrets `CLOUDFLARE_API_TOKEN` (Workers + D1 edit),
   `CLOUDFLARE_ACCOUNT_ID`, and optional `SENTRY_AUTH_TOKEN`; and an npm trusted publisher per
   package pointing at `alandotcom/trainheroic-unofficial` workflow `publish.yml`.

### Manual fallback (only if CI is unavailable)

The exact commands the workflows run, for an emergency local release. Order matters: migrate
before deploy (so new code never queries a missing table), and deploy before publish (so the
hosted MCP and the published SDK/CLI match). Never publish a version not pushed to `main`.

```bash
cd packages/cloudflare && pnpm run db:migrate && cd ../..   # remote D1 (idempotent)
pnpm run deploy                                             # worker + Sentry source maps
pnpm release                                               # build + changeset publish
```

`pnpm run deploy` must use `run deploy` — bare `pnpm deploy` is a pnpm builtin that errors with
`ERR_PNPM_NOTHING_TO_DEPLOY`. A manual `pnpm release` needs `npm whoami` logged in with publish
rights on the `@trainheroic-unofficial` scope, and its 2FA OTP prompt is interactive (CI avoids
this via OIDC).
