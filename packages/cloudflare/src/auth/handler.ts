import {
  AuthorizationError,
  CimdFetchError,
  type AuthRequest,
  type ClientInfo,
} from "@cloudflare/workers-oauth-provider";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { sql } from "drizzle-orm";
import { loginTrainHeroic, type TrainHeroicSession } from "@trainheroic-unofficial/js";
import { account } from "@trainheroic-unofficial/db";
import { makeD1Warehouse } from "@trainheroic-unofficial/db/d1";
import type { Props } from "../types";
import { toAccountRole } from "../types";
import { randomToken, safeEqual, signPayload, verifyPayload } from "./crypto";
import { renderLoginPage } from "./login-page";
import { completeTrainHeroicAuthorization } from "./oauth-provider-compat";
import { reportOAuthInternalError, trainHeroicLoginErrorReporter } from "../sentry";

const CSRF_COOKIE = "th_csrf";
const CSRF_TTL_SECONDS = 600;

type AppContext = Context<{ Bindings: Env }>;

function isSecure(c: AppContext): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function setSecurityHeaders(c: AppContext, formActionOrigin?: string): void {
  // The consent POST completes by 302-ing to the client's registered callback (e.g.
  // https://claude.ai/...). `form-action` is enforced across a form submission's redirect
  // chain, so that cross-origin hop must be allowlisted or the browser blocks the flow.
  // We add only this request's own redirect origin, keeping the directive otherwise tight.
  const formAction = formActionOrigin ? `'self' ${formActionOrigin}` : "'self'";
  c.header(
    "Content-Security-Policy",
    `default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action ${formAction}; base-uri 'none'`,
  );
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
}

function redirectOrigin(redirectUri: string): string | undefined {
  try {
    return new URL(redirectUri).origin;
  } catch {
    return undefined;
  }
}

function localAuthorizationErrorResponse(c: AppContext, error: unknown): Response {
  setSecurityHeaders(c);
  if (error instanceof AuthorizationError) {
    return c.text(error.description, 400);
  }
  if (error instanceof CimdFetchError) {
    reportOAuthInternalError({
      code: "server_error",
      status: 502,
      category: "client-id-metadata-document",
      reason: "metadata_resolution_failed",
    });
    return c.text("OAuth client metadata is temporarily unavailable", 502);
  }
  Sentry.captureException(error, { tags: { "oauth.operation": "authorization" } });
  return c.text("Authorization service unavailable", 500);
}

function authorizationRequestErrorResponse(c: AppContext, error: unknown): Response {
  if (!(error instanceof AuthorizationError) || !error.redirectUri) {
    return localAuthorizationErrorResponse(c, error);
  }

  setSecurityHeaders(c);
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return c.redirect(redirect.toString(), 302);
}

async function recordAccount(
  c: AppContext,
  session: TrainHeroicSession,
  email: string,
): Promise<boolean> {
  // Best-effort tenant registry (last_seen); never blocks login. RETURNING created_at
  // distinguishes a first-time signup from a returning login.
  const now = Date.now();
  try {
    const row = await makeD1Warehouse(c.env.TH_DB, { instrument: Sentry.instrumentD1WithSentry })
      .db.insert(account)
      .values({
        thUserId: session.thUserId,
        orgId: null,
        email,
        role: session.role,
        createdAt: now,
        lastSeen: now,
      })
      .onConflictDoUpdate({
        target: account.thUserId,
        set: {
          email: sql`excluded.email`,
          role: sql`excluded.role`,
          lastSeen: sql`excluded.last_seen`,
        },
      })
      .returning({ createdAt: account.createdAt })
      .get();
    return row?.createdAt === now;
  } catch (err) {
    // No credentials here — thUserId only.
    console.warn("account registry upsert failed (non-fatal)", { thUserId: session.thUserId, err });
    return false;
  }
}

function setCsrfCookie(c: AppContext, value: string): void {
  setCookie(c, CSRF_COOKIE, value, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Strict",
    path: "/",
    maxAge: CSRF_TTL_SECONDS,
  });
}

function allowlist(c: AppContext): string[] {
  return (c.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

async function renderLogin(
  c: AppContext,
  oauthReq: AuthRequest,
  client: ClientInfo,
  status: ContentfulStatusCode,
  error?: string,
): Promise<Response> {
  const csrf = randomToken(16);
  // Bind the signed request to this CSRF token and an expiry so it cannot be replayed
  // indefinitely or paired with a different CSRF cookie.
  const oauthToken = await signPayload(
    { req: oauthReq, csrf, exp: Date.now() + CSRF_TTL_SECONDS * 1000 },
    c.env.COOKIE_ENCRYPTION_KEY,
  );
  setCsrfCookie(c, csrf);
  setSecurityHeaders(c, redirectOrigin(oauthReq.redirectUri));
  return c.html(
    renderLoginPage({
      clientName: client.clientName ?? oauthReq.clientId,
      redirectUri: oauthReq.redirectUri,
      oauthToken,
      csrf,
      ...(error === undefined ? {} : { error }),
    }),
    status,
  );
}

const app = new Hono<{ Bindings: Env }>();

// GET /authorize — render the TrainHeroic login + consent page.
app.get("/authorize", async (c) => {
  let oauthReq: AuthRequest;
  try {
    oauthReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (error) {
    return authorizationRequestErrorResponse(c, error);
  }
  let client: ClientInfo | null;
  try {
    client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  } catch (error) {
    return localAuthorizationErrorResponse(c, error);
  }
  if (!client) return c.text("Unknown client", 400);
  return renderLogin(c, oauthReq, client, 200);
});

// POST /authorize — validate credentials and complete the grant.
app.post("/authorize", async (c) => {
  const body = await c.req.parseBody();
  const field = (name: string): string => (typeof body[name] === "string" ? body[name] : "");

  const csrfCookie = getCookie(c, CSRF_COOKIE) ?? "";
  const csrfField = field("csrf");
  if (csrfCookie.length === 0 || !(await safeEqual(csrfCookie, csrfField))) {
    return c.text("Invalid CSRF token", 403);
  }

  const signed = await verifyPayload<{ req: AuthRequest; csrf: string; exp: number }>(
    field("oauth_req"),
    c.env.COOKIE_ENCRYPTION_KEY,
  );
  if (!signed) return c.text("Invalid or expired authorization request", 400);
  if (Date.now() > signed.exp) return c.text("Authorization request expired; please retry.", 400);
  if (!(await safeEqual(signed.csrf, csrfField))) return c.text("Invalid CSRF token", 403);
  const oauthReq = signed.req;

  let client: ClientInfo | null;
  try {
    client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  } catch (error) {
    return localAuthorizationErrorResponse(c, error);
  }
  if (!client) return c.text("Unknown client", 400);

  const email = field("email").trim();
  const password = field("password");

  const allowed = allowlist(c);
  if (allowed.length === 0) {
    // Open-registration default: an unset/empty ALLOWED_EMAILS lets any TrainHeroic account
    // (coach or athlete) authorize this server. Log it loudly so a private deploy notices the
    // door is open.
    console.warn(
      "ALLOWED_EMAILS is empty: open registration in effect — any TrainHeroic account can authorize this server.",
    );
  }
  if (allowed.length > 0 && !allowed.includes(email.toLowerCase())) {
    // Aggregate counter only; no email/PII in attributes (see sentry.ts privacy invariant).
    Sentry.metrics.count("auth.login.denied", 1);
    return renderLogin(
      c,
      oauthReq,
      client,
      403,
      "This TrainHeroic account is not permitted to use this server.",
    );
  }

  const session = await loginTrainHeroic(email, password, {
    onHttpError: trainHeroicLoginErrorReporter(email),
  });
  if (!session) {
    Sentry.metrics.count("auth.login.failed", 1);
    return renderLogin(c, oauthReq, client, 401, "Invalid TrainHeroic email or password.");
  }

  const props: Props = {
    thUserId: session.thUserId,
    email,
    password,
    role: toAccountRole(session.role),
    scope: session.scope,
  };

  let redirectTo: string;
  try {
    redirectTo = await completeTrainHeroicAuthorization(c.env.OAUTH_PROVIDER, oauthReq, props);
  } catch (error) {
    return localAuthorizationErrorResponse(c, error);
  }

  const isNewAccount = await recordAccount(c, session, email);

  // Aggregate usage metrics. Role is the only attribute — no email/PII (see sentry.ts privacy
  // invariant). No-op when SENTRY_DSN is unset, so local dev and tests are untouched.
  Sentry.metrics.count("auth.login.success", 1, { attributes: { role: session.role } });
  if (isNewAccount) {
    Sentry.metrics.count("auth.signup", 1, { attributes: { role: session.role } });
  }

  deleteCookie(c, CSRF_COOKIE, { path: "/" });
  return c.redirect(redirectTo, 302);
});

export const authHandler = app;
