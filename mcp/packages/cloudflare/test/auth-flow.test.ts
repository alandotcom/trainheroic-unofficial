import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

// SELF.fetch dispatches to the worker; the worker's own outbound fetch (TrainHeroic
// login) goes through the global fetch, which we stub here.
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubTrainHeroicAuth(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/auth")) {
        return new Response(
          JSON.stringify({
            id: 200003,
            session_id: "s".repeat(48),
            scope: "athlete",
            role: "coach",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

function field(html: string, name: string): string {
  const m = html.match(new RegExp(`name="${name}"[^>]*?value="([^"]*)"`, "u"));
  return m?.[1] ?? "";
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
