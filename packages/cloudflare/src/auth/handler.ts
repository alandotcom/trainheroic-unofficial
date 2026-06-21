import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { loginTrainHeroic } from "@trainheroic-unofficial/js";
import type { Props } from "../types";
import { randomToken, safeEqual, signPayload, verifyPayload } from "./crypto";
import { renderLoginPage } from "./login-page";

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
  } catch {
    return c.text("Invalid authorization request", 400);
  }
  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
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

  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  if (!client) return c.text("Unknown client", 400);

  const email = field("email").trim();
  const password = field("password");

  const allowed = allowlist(c);
  if (allowed.length === 0) {
    // Open-registration default: an unset/empty ALLOWED_EMAILS lets any TrainHeroic coach
    // authorize this server. Log it loudly so a private deploy notices the door is open.
    console.warn(
      "ALLOWED_EMAILS is empty: open registration in effect — any TrainHeroic coach can authorize this server.",
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

  const session = await loginTrainHeroic(email, password);
  if (!session) {
    Sentry.metrics.count("auth.login.failed", 1);
    return renderLogin(c, oauthReq, client, 401, "Invalid TrainHeroic email or password.");
  }

  const props: Props = {
    thUserId: session.thUserId,
    email,
    password,
    role: session.role,
    scope: session.scope,
  };

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: String(session.thUserId),
    metadata: { label: email },
    scope: oauthReq.scope,
    props,
  });

  // Best-effort tenant registry (last_seen); never blocks login. No credentials here.
  // RETURNING created_at distinguishes a first-time signup (row's created_at == the now we
  // just bound) from a returning login (created_at is older, since it's never updated on
  // conflict), so we can emit the two metrics separately below.
  const now = Date.now();
  let isNewAccount = false;
  try {
    const row = await c.env.TH_DB.prepare(
      "INSERT INTO account (th_user_id, org_id, email, role, created_at, last_seen) VALUES (?,?,?,?,?,?) " +
        "ON CONFLICT(th_user_id) DO UPDATE SET email=excluded.email, role=excluded.role, last_seen=excluded.last_seen " +
        "RETURNING created_at",
    )
      .bind(session.thUserId, null, email, session.role, now, now)
      .first<{ created_at: number }>();
    isNewAccount = row?.created_at === now;
  } catch (err) {
    // Best-effort: never block login, but log so a persistently-failing registry write
    // (e.g. schema drift) is diagnosable. No credentials here — thUserId only.
    console.warn("account registry upsert failed (non-fatal)", { thUserId: session.thUserId, err });
  }

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
