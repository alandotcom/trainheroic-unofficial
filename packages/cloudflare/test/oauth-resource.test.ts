import {
  createExecutionContext,
  createScheduledController,
  env,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const PKCE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const PKCE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT_URI = "http://localhost/cb";

afterEach(() => {
  vi.unstubAllGlobals();
});

function field(html: string, name: string): string {
  const m = html.match(new RegExp(`name="${name}"[^>]*?value="([^"]*)"`, "u"));
  return m?.[1] ?? "";
}

// Register a public client and sign a coach in through the login page, returning the client id
// and an authorization code. The TrainHeroic login call is stubbed.
async function signIn(): Promise<{ clientId: string; code: string }> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ id: 200003, session_id: "s".repeat(48), scope: "athlete", role: "coach" }),
    ),
  );
  const reg = await SELF.fetch("http://localhost/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" }),
  });
  const { client_id: clientId } = (await reg.json()) as { client_id: string };

  const page = await SELF.fetch(
    `http://localhost/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=mcp` +
      `&code_challenge=${PKCE_CHALLENGE}&code_challenge_method=S256&state=xyz`,
  );
  const html = await page.text();
  const cookie =
    (page.headers.getSetCookie().find((c) => c.startsWith("th_csrf=")) ?? "").split(";")[0] ?? "";
  const post = await SELF.fetch("http://localhost/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({
      email: "coach@example.com",
      password: "pw",
      csrf: field(html, "csrf"),
      oauth_req: field(html, "oauth_req"),
    }).toString(),
    redirect: "manual",
  });
  const code = new URL(post.headers.get("location") ?? "").searchParams.get("code") ?? "";
  return { clientId, code };
}

function exchange(clientId: string, code: string, resource: string): Promise<Response> {
  return SELF.fetch("http://localhost/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: PKCE_VERIFIER,
      resource,
    }).toString(),
  });
}

describe("OAuth protected resource", () => {
  it("advertises the request origin's /mcp as the resource", async () => {
    for (const origin of ["http://localhost", "https://mcp.example.com"]) {
      const response = await SELF.fetch(`${origin}/.well-known/oauth-protected-resource/mcp`);
      const metadata = (await response.json()) as { resource: string; scopes_supported: string[] };
      expect(metadata.resource).toBe(`${origin}/mcp`);
      expect(metadata.scopes_supported).toEqual(["mcp"]);
    }
  });

  it("points the challenge on a variant path at the /mcp metadata document", async () => {
    const response = await SELF.fetch("https://mcp.example.com/mcp/coach", { method: "POST" });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("issues tokens for /mcp and refuses a variant path as the resource", async () => {
    const accepted = await signIn();
    const ok = await exchange(accepted.clientId, accepted.code, "http://localhost/mcp");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { resource: string }).resource).toBe("http://localhost/mcp");

    const refused = await signIn();
    const bad = await exchange(refused.clientId, refused.code, "http://localhost/mcp/coach");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_target");
  });
});

// List tools over Streamable HTTP through the Worker's real fetch handler, so the OAuth provider,
// the agents `createMcpHandler` adapter, and the MCP SDK are exercised together.
async function listToolsOverHttp(
  url: string,
  accessToken: string,
  era: "auto" | "legacy",
): Promise<string[]> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    // SELF.fetch sends no Host header, and the MCP handler's DNS-rebinding check requires one.
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("host", new URL(url).host);
      return SELF.fetch(input, { ...init, headers });
    },
  });
  const client = new Client({ name: "oauth-resource-test", version: "1.0.0" });
  await (era === "legacy"
    ? client.connect(transport, { prior: { kind: "legacy" } })
    : client.connect(transport));
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

describe("MCP over HTTP with an issued token", () => {
  it("serves all three mount paths to a token bound to /mcp, in both protocol eras", async () => {
    const { clientId, code } = await signIn();
    const tokens = (await (await exchange(clientId, code, "http://localhost/mcp")).json()) as {
      access_token: string;
    };

    for (const era of ["auto", "legacy"] as const) {
      const full = await listToolsOverHttp("http://localhost/mcp", tokens.access_token, era);
      const coach = await listToolsOverHttp("http://localhost/mcp/coach", tokens.access_token, era);
      const athlete = await listToolsOverHttp(
        "http://localhost/mcp/athlete",
        tokens.access_token,
        era,
      );

      expect(full).toContain("list_athletes");
      expect(full).toContain("athlete_whoami");
      expect(coach).toContain("list_athletes");
      expect(athlete).toContain("athlete_whoami");
      expect(athlete).not.toContain("list_athletes");
    }
  });
});

describe("scheduled OAuth purge", () => {
  async function runPurge(): Promise<void> {
    const ctx = createExecutionContext();
    // The handler's own type declares two parameters; the runtime, and Sentry's wrapper, pass ctx.
    const handler = worker as ExportedHandler<Env>;
    // `OAUTH_PROVIDER` is added to env by the provider during fetch; a cron run never reads it.
    await handler.scheduled?.(createScheduledController(), env as Env, ctx);
    await waitOnExecutionContext(ctx);
  }

  it("stores a cursor when a sweep outgrows one run and clears it once the sweep finishes", async () => {
    // 101 live grants exceed the 100-key batch. A CIMD client id with no expiry keeps every
    // grant out of the purge, so the sweep's length is all this test measures.
    for (let i = 0; i < 101; i++) {
      await env.OAUTH_KV.put(
        `grant:purge-user:g${i}`,
        JSON.stringify({ id: `g${i}`, userId: "purge-user", clientId: "https://client.example/c" }),
      );
    }

    await runPurge();
    expect(await env.OAUTH_KV.get("purge-cursor")).toMatch(/^grants:/u);

    await runPurge();
    expect(await env.OAUTH_KV.get("purge-cursor")).toBeNull();
  });
});
