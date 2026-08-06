import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/** TrainHeroic account role carried in the OAuth grant props. */
export type AccountRole = "coach" | "athlete";

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
  role: AccountRole;
  scope: string;
};

/** Narrow a TrainHeroic login role string to the two roles this server cares about. */
export function toAccountRole(role: string): AccountRole {
  return role === "coach" ? "coach" : "athlete";
}

/**
 * Secrets and vars from `.dev.vars` (and `wrangler secret put`) that `wrangler types` does not
 * enumerate. Declared once here, then attached to both env interfaces below.
 */
interface WorkerSecrets {
  COOKIE_ENCRYPTION_KEY: string;
  ALLOWED_EMAILS?: string;
  // Sentry DSN. A secret (`wrangler secret put SENTRY_DSN`, or `.dev.vars` locally), never a
  // committed var; absent locally, which leaves Sentry disabled and every call a no-op.
  SENTRY_DSN?: string;
  // Release id, injected as a plaintext var by `scripts/deploy.sh` (`--var SENTRY_RELEASE:...`)
  // so events match the source maps uploaded under the same release. Unset outside deploys.
  SENTRY_RELEASE?: string;
}

/**
 * Both `Cloudflare.Env` (`import { env } from "cloudflare:workers"`) and the global `Env`
 * (`ExportedHandler<Env>` / fetch params) need the secrets — wrangler generates them as sibling
 * interfaces, not aliases. Extending from one shared declaration keeps them from drifting.
 * Both go under `declare global` because this file is a module.
 *
 * `OAUTH_PROVIDER` is declared only on the global `Env`, because the OAuth library injects it
 * onto the request-scoped env object it hands the default and API handlers. It is absent from
 * the module-level `cloudflare:workers` env, so declaring it on `Cloudflare.Env` too would
 * typecheck a read that is `undefined` at runtime.
 */
declare global {
  namespace Cloudflare {
    interface Env extends WorkerSecrets {}
  }
  interface Env extends WorkerSecrets {
    OAUTH_PROVIDER: OAuthHelpers;
  }
}
