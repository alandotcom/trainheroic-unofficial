---
name: release
description: Cut a release of the trainheroic-unofficial packages. Use when the user wants to version, publish, or ship the packages, bump versions, run a release, or deploy the worker. Encodes the changeset → version → commit → push → deploy → publish flow and its footguns (one shared version, `run deploy`, deploy-before-publish).
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

6. **Deploy the worker** so the hosted server matches the libraries you're about to publish:

   ```bash
   pnpm --filter @trainheroic-unofficial/cloudflare run deploy
   ```

   Use `run deploy`. Bare `pnpm deploy` is a pnpm builtin (deploy a pruned package to a
   directory) and errors with `ERR_PNPM_INVALID_DEPLOY_TARGET`. Deploy needs Cloudflare auth
   (wrangler login or `CLOUDFLARE_API_TOKEN`). It prints the worker URL and a Version ID on
   success.

7. **Publish** the public packages: `pnpm release` (runs `pnpm build` then
   `changeset publish`). Needs `npm whoami` logged in with publish rights on the
   `@trainheroic-unofficial` scope; the npm 2FA OTP prompt is interactive. `changeset
   publish` skips packages already on the registry and excludes the private worker, so it is
   safe to re-run. Publishing is human-run — do not publish on the user's behalf unless they
   ask.

## Order matters

Deploy the worker before publishing, so the live hosted MCP and the published SDK/CLI are the
same version. Never publish a version you have not pushed to `main`.
