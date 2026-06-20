import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/**
 * Per-grant data attached at authorization time. Stored end-to-end encrypted by
 * workers-oauth-provider (the issued OAuth token is the key material), so it is the
 * correct place for the TrainHeroic credential. Never logged, never forwarded to the
 * TrainHeroic API as-is, never placed in `userId`/`metadata` (those are not encrypted).
 */
export type Props = {
  thUserId: number;
  email: string;
  password: string;
  role: string;
  scope: string;
};

declare global {
  // Secrets/vars from .dev.vars (and `wrangler secret put`) that wrangler types does
  // not enumerate, plus OAUTH_PROVIDER which the OAuth library injects into the env it
  // passes to the default and API handlers. Merged into the generated global Env.
  interface Env {
    COOKIE_ENCRYPTION_KEY: string;
    ALLOWED_EMAILS?: string;
    // Sentry DSN. A secret (`wrangler secret put SENTRY_DSN`, or `.dev.vars` locally), never a
    // committed var; absent locally, which leaves Sentry disabled and every call a no-op.
    SENTRY_DSN?: string;
    // Release id, injected as a plaintext var by `scripts/deploy.sh` (`--var SENTRY_RELEASE:...`)
    // so events match the source maps uploaded under the same release. Unset outside deploys.
    SENTRY_RELEASE?: string;
    OAUTH_PROVIDER: OAuthHelpers;
  }
}
