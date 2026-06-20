#!/usr/bin/env sh
#
# Deploy the hosted Worker and make its errors debuggable in Sentry.
#
# What it does:
#   1. `wrangler deploy` builds and ships the Worker. With `upload_source_maps: true` in
#      wrangler.jsonc it emits .js.map files (to --outdir) and uploads them to Cloudflare's
#      own observability. SENTRY_RELEASE is injected as a Worker var so the Sentry SDK tags
#      every event with this release id.
#   2. If SENTRY_AUTH_TOKEN is set, sentry-cli uploads the same source maps to Sentry under
#      that release, so Sentry stack traces resolve to original TypeScript. Without the token
#      this step is skipped and the deploy still succeeds.
#
# Env:
#   SENTRY_AUTH_TOKEN  required only for the Sentry upload step. Use an organization auth
#                      token (org:ci scope) from https://sentry.io/settings/auth-tokens/.
#                      Read from .env automatically (see loader below).
#   SENTRY_ORG         default: alan-zy
#   SENTRY_PROJECT     default: trainheroic-mcp
#   SENTRY_RELEASE     default: short git sha (or "dev" outside a git tree)
set -eu

cd "$(dirname "$0")/.." # packages/cloudflare

# Load .env (workspace root, then this package) if present, so SENTRY_AUTH_TOKEN and friends
# don't have to be exported by hand. Both paths are gitignored. A plain `sh` script does not
# read .env on its own, hence this.
for envfile in "../../.env" ".env"; do
  if [ -f "$envfile" ]; then
    echo "▶ Loading env from $envfile"
    set -a
    . "$envfile"
    set +a
  fi
done

SENTRY_ORG="${SENTRY_ORG:-alan-zy}"
SENTRY_PROJECT="${SENTRY_PROJECT:-trainheroic-mcp}"
RELEASE="${SENTRY_RELEASE:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
OUTDIR="dist"

echo "▶ Deploying ${SENTRY_PROJECT} (release ${RELEASE})…"
pnpm exec wrangler deploy --outdir "$OUTDIR" --var "SENTRY_RELEASE:${RELEASE}"

if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
  echo "▶ Uploading source maps to Sentry (${SENTRY_ORG}/${SENTRY_PROJECT} @ ${RELEASE})…"
  pnpm dlx @sentry/cli@2 releases new "$RELEASE" --org "$SENTRY_ORG" --project "$SENTRY_PROJECT"
  pnpm dlx @sentry/cli@2 sourcemaps upload "$OUTDIR" \
    --release "$RELEASE" --org "$SENTRY_ORG" --project "$SENTRY_PROJECT"
  pnpm dlx @sentry/cli@2 releases finalize "$RELEASE" --org "$SENTRY_ORG" --project "$SENTRY_PROJECT"
  echo "✔ Deployed and source maps uploaded to Sentry."
else
  echo "⚠ SENTRY_AUTH_TOKEN not set — deployed, but did not upload source maps to Sentry."
  echo "  Cloudflare-side source maps were still uploaded (observability dashboard)."
  echo "  Set SENTRY_AUTH_TOKEN and re-run to get readable Sentry stack traces."
fi
