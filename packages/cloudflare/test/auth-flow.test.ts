import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

const PKCE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const PKCE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

// SELF.fetch dispatches to the worker; the worker's own outbound fetch (TrainHeroic
// login) goes through the global fetch, which we stub here.
afterEach(() => {
  vi.unstubAllGlobals();
});

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function stubOAuthDependencies(cimd?: { metadataUrl: string; redirectUri: string }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (cimd && url === cimd.metadataUrl) {
        return Response.json({
          client_id: cimd.metadataUrl,
          client_name: "CIMD Test Client",
          redirect_uris: [cimd.redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        });
      }
      if (url.endsWith("/auth")) {
        return Response.json({
          id: 200003,
          session_id: "s".repeat(48),
          scope: "athlete",
          role: "coach",
        });
      }
      throw new Error(`Unexpected outbound request: ${url}`);
    }),
  );
}

function stubTrainHeroicAuth(): void {
  stubOAuthDependencies();
}

function stubCimdAndTrainHeroicAuth(metadataUrl: string, redirectUri: string): void {
  stubOAuthDependencies({ metadataUrl, redirectUri });
}

function field(html: string, name: string): string {
  const m = html.match(new RegExp(`name="${name}"[^>]*?value="([^"]*)"`, "u"));
  return m?.[1] ?? "";
}

async function registerClient(): Promise<string> {
  const response = await SELF.fetch("http://localhost/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["http://localhost/cb"],
      token_endpoint_auth_method: "none",
      client_name: "Auth Flow Test",
    }),
  });
  expect(response.status).toBe(201);
  const { client_id: clientId } = (await response.json()) as { client_id: string };
  return clientId;
}

async function authorize(clientId: string, redirectUri: string): Promise<string> {
  const authUrl =
    `http://localhost/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=mcp` +
    `&code_challenge=${PKCE_CHALLENGE}&code_challenge_method=S256&state=xyz`;
  const page = await SELF.fetch(authUrl);
  expect(page.status).toBe(200);
  const html = await page.text();
  const csrf = field(html, "csrf");
  const oauthReq = field(html, "oauth_req");
  const cookie =
    (page.headers.getSetCookie().find((value) => value.startsWith("th_csrf=")) ?? "").split(
      ";",
    )[0] ?? "";

  const response = await SELF.fetch("http://localhost/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({
      email: "coach@example.com",
      password: "pw",
      csrf,
      oauth_req: oauthReq,
    }).toString(),
    redirect: "manual",
  });
  expect(response.status).toBe(302);
  const code = new URL(response.headers.get("location") ?? "").searchParams.get("code");
  expect(code).toBeTruthy();
  return code ?? "";
}

async function exchangeCode(
  clientId: string,
  redirectUri: string,
  code: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const response = await SELF.fetch("http://localhost/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: PKCE_VERIFIER,
    }).toString(),
  });
  expect(response.status).toBe(200);
  return response.json();
}

describe("OAuth authorize flow (end to end in workerd)", () => {
  it("registers a client, renders login, validates creds, and issues a code", async () => {
    stubTrainHeroicAuth();

    // 1. Dynamic client registration.
    const reg = await SELF.fetch("http://localhost/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost/cb"],
        token_endpoint_auth_method: "none",
        client_name: "Auth Flow Test",
      }),
    });
    expect(reg.status).toBe(201);
    const { client_id: clientId } = (await reg.json()) as { client_id: string };
    expect(clientId).toBeTruthy();

    // 2. GET /authorize renders the login page (and sets the CSRF cookie).
    const authUrl =
      `http://localhost/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent("http://localhost/cb")}&scope=mcp` +
      `&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=xyz`;
    const page = await SELF.fetch(authUrl);
    expect(page.status).toBe(200);
    const html = await page.text();
    const csrf = field(html, "csrf");
    const oauthReq = field(html, "oauth_req");
    expect(csrf).toBeTruthy();
    expect(oauthReq).toBeTruthy();
    const cookie =
      (page.headers.getSetCookie().find((c) => c.startsWith("th_csrf=")) ?? "").split(";")[0] ?? "";
    expect(cookie).toContain("th_csrf=");

    // 3. POST /authorize with credentials -> 302 back to the client with a code.
    const post = await SELF.fetch("http://localhost/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: new URLSearchParams({
        email: "coach@example.com",
        password: "pw",
        csrf,
        oauth_req: oauthReq,
      }).toString(),
      redirect: "manual",
    });
    expect(post.status).toBe(302);
    const location = post.headers.get("location") ?? "";
    expect(location).toContain("http://localhost/cb");
    expect(location).toContain("code=");
  });

  it("redirects validated authorization errors back to the client with state and issuer", async () => {
    const clientId = await registerClient();
    const response = await SELF.fetch(
      `http://localhost/authorize?response_type=token&client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent("http://localhost/cb")}&scope=mcp&state=xyz`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    const redirect = new URL(response.headers.get("location") ?? "");
    expect(redirect.origin + redirect.pathname).toBe("http://localhost/cb");
    expect(redirect.searchParams.get("error")).toBe("unsupported_response_type");
    expect(redirect.searchParams.get("state")).toBe("xyz");
    expect(redirect.searchParams.get("iss")).toBe("http://localhost");
  });

  it("renders unknown-client errors locally instead of trusting their redirect URI", async () => {
    const response = await SELF.fetch(
      `http://localhost/authorize?response_type=code&client_id=unknown-client` +
        `&redirect_uri=${encodeURIComponent("https://attacker.example/callback")}&scope=mcp` +
        `&code_challenge=${PKCE_CHALLENGE}&code_challenge_method=S256`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns a temporary failure when a CIMD document cannot be resolved", async () => {
    const metadataUrl = "https://client.example/oauth/client.json";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = requestUrl(input);
        if (url === metadataUrl) throw new Error("metadata fetch timed out");
        throw new Error(`Unexpected outbound request: ${url}`);
      }),
    );

    const response = await SELF.fetch(
      `http://localhost/authorize?response_type=code&client_id=${encodeURIComponent(metadataUrl)}` +
        `&redirect_uri=${encodeURIComponent("https://client.example/callback")}&scope=mcp` +
        `&code_challenge=${PKCE_CHALLENGE}&code_challenge_method=S256`,
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("OAuth client metadata is temporarily unavailable");
  });

  it("keeps an existing CIMD grant valid when the same user authorizes another device", async () => {
    const metadataUrl = "https://client.example/oauth/client.json";
    const redirectUri = "https://client.example/callback";
    stubCimdAndTrainHeroicAuth(metadataUrl, redirectUri);

    const firstCode = await authorize(metadataUrl, redirectUri);
    const firstTokens = await exchangeCode(metadataUrl, redirectUri, firstCode);
    const secondCode = await authorize(metadataUrl, redirectUri);
    await exchangeCode(metadataUrl, redirectUri, secondCode);

    const refresh = await SELF.fetch("http://localhost/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: metadataUrl,
        refresh_token: firstTokens.refresh_token,
      }).toString(),
    });

    expect(refresh.status).toBe(200);
  });

  it("rejects a POST with a mismatched CSRF token", async () => {
    const post = await SELF.fetch("http://localhost/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: "th_csrf=aaa" },
      body: new URLSearchParams({
        email: "x@y.com",
        password: "p",
        csrf: "bbb",
        oauth_req: "z",
      }).toString(),
      redirect: "manual",
    });
    expect(post.status).toBe(403);
  });
});
