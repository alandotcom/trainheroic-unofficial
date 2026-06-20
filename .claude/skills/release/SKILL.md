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

6. **Apply remote D1 migrations** before the new worker code goes live, so any new tables the
   code queries already exist. `migrations/` is append-only and every file is idempotent
   (`CREATE TABLE/INDEX IF NOT EXISTS`), so this is safe to run even when nothing is pending.

   ```bash
   cd packages/cloudflare
   pnpm exec wrangler d1 migrations list trainheroic --remote   # what's pending
   pnpm run db:migrate                                          # apply to remote (--remote)
   ```

   `pnpm run db:migrate` runs `wrangler d1 migrations apply trainheroic --remote`. In a
   non-interactive shell wrangler auto-answers "yes" to the apply prompt. Verify it ends with
   "No migrations to apply!" on a re-list. If a release adds no migration files, this is a
   no-op — skip only when you are sure `migrations/` is unchanged since the last deploy.

7. **Deploy the worker** so the hosted server matches the libraries you're about to publish:

   ```bash
   pnpm run deploy        # from repo root; or: pnpm --filter @trainheroic-unofficial/cloudflare run deploy
   ```

   Use `run deploy`. Bare `pnpm deploy` is a pnpm builtin (deploy a pruned package to a
   directory) and errors with `ERR_PNPM_NOTHING_TO_DEPLOY` / `ERR_PNPM_INVALID_DEPLOY_TARGET`
   — this bites at **both** levels, so the root script itself must be
   `pnpm --filter … run deploy`, not `pnpm --filter … deploy`.

   `run deploy` runs `packages/cloudflare/scripts/deploy.sh`, not a bare `wrangler deploy`. The
   script: (a) `wrangler deploy` with `--outdir dist` and `--var SENTRY_RELEASE:<short-sha>`,
   emitting source maps (`upload_source_maps: true` in `wrangler.jsonc`); (b) if
   `SENTRY_AUTH_TOKEN` is set, creates + finalizes a Sentry release named for the git short sha
   and uploads the source maps to it via `@sentry/cli`. The token is read from a gitignored
   `.env` (repo root or `packages/cloudflare/`); with no token the deploy still succeeds and
   only skips the Sentry upload. `pnpm --filter @trainheroic-unofficial/cloudflare run deploy:plain`
   is the bare `wrangler deploy` escape hatch.

   Deploy needs Cloudflare auth (wrangler login or `CLOUDFLARE_API_TOKEN`). On success it
   prints the worker URL and a Version ID, then (with the token) a "source maps uploaded to
   Sentry" report ending in a Bundle ID. To confirm the source maps landed, check the worker is
   live (`curl -s -o /dev/null -w '%{http_code}' .../mcp` → 401) and that the release's artifact
   bundle exists:

   ```bash
   set -a; . ./.env; set +a
   curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
     "https://sentry.io/api/0/projects/${SENTRY_ORG:-alan-zy}/${SENTRY_PROJECT:-trainheroic-mcp}/files/artifact-bundles/?query=<short-sha>"
   ```

   It should return a bundle whose `associations[].release` is the short sha with `fileCount: 2`
   (`index.js` + `index.js.map`). `sentry-cli releases files … list` is deprecated for these
   debug-id bundles and shows nothing — use the artifact-bundles endpoint above.

8. **Publish** the public packages: `pnpm release` (runs `pnpm build` then
   `changeset publish`). Needs `npm whoami` logged in with publish rights on the
   `@trainheroic-unofficial` scope; the npm 2FA OTP prompt is interactive. `changeset
   publish` skips packages already on the registry and excludes the private worker, so it is
   safe to re-run. Publishing is human-run — do not publish on the user's behalf unless they
   ask.

## Order matters

Apply remote D1 migrations before deploying, so the new worker code never queries a table that
does not exist yet. Deploy the worker before publishing, so the live hosted MCP and the
published SDK/CLI are the same version. Never publish a version you have not pushed to `main`.
