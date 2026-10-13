import { env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { oauthErrorIdentity } from "../src/auth/oauth-error-context";

const TOKEN = "200003:diagnostic-grant:private-token-secret";
const KEY = "grant:200003:diagnostic-grant";

afterEach(() => vi.restoreAllMocks());

async function saveGrant(overrides: object = {}): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  await env.OAUTH_KV.put(
    KEY,
    JSON.stringify({
      id: "diagnostic-grant",
      userId: "200003",
      clientId: "test-client",
      metadata: { label: "coach@example.com" },
      expiresAt: Date.now() / 1000 + 3600,
      refreshTokenId: hash,
      encryptedProps: "never-decrypt-this",
      ...overrides,
    }),
  );
}

function request(overrides: Record<string, string> = {}): Request {
  return new Request("http://localhost/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "test-client",
      refresh_token: TOKEN,
      resource: "http://localhost/mcp%20%5B1%5D%20(citation)",
      ...overrides,
    }),
  });
}

it("identifies a matching refresh token without decrypting props or returning token data", async () => {
  await saveGrant();
  expect(await oauthErrorIdentity(request(), env.OAUTH_KV)).toEqual({
    userKey: "user:200003",
    email: "coach@example.com",
  });
});

it("accepts the provider's previous refresh token", async () => {
  await saveGrant();
  const grant = await env.OAUTH_KV.get<{ refreshTokenId: string }>(KEY, "json");
  await saveGrant({ refreshTokenId: "different", previousRefreshTokenId: grant?.refreshTokenId });
  expect(await oauthErrorIdentity(request(), env.OAUTH_KV)).toMatchObject({
    userKey: "user:200003",
  });
});

it("identifies an unused authorization code and excludes a consumed code", async () => {
  await saveGrant();
  const grant = await env.OAUTH_KV.get<{ refreshTokenId: string }>(KEY, "json");
  await saveGrant({ authCodeId: grant?.refreshTokenId, authCodeWrappedKey: "wrapped-key" });
  const codeRequest = () => request({ grant_type: "authorization_code", code: TOKEN });
  expect(await oauthErrorIdentity(codeRequest(), env.OAUTH_KV)).toEqual({
    userKey: "user:200003",
    email: "coach@example.com",
  });
  await saveGrant({ authCodeId: grant?.refreshTokenId });
  expect(await oauthErrorIdentity(codeRequest(), env.OAUTH_KV)).toBeUndefined();
});

it.each([
  { refresh_token: "200003:diagnostic-grant:forged" },
  { client_id: "another-client" },
  { refresh_token: "200004:diagnostic-grant:private-token-secret" },
])("does not attribute an unverified token or client: %j", async (overrides) => {
  await saveGrant();
  expect(await oauthErrorIdentity(request(overrides), env.OAUTH_KV)).toBeUndefined();
});

it("does not attribute expired or missing grants", async () => {
  await saveGrant({ expiresAt: Date.now() / 1000 - 1 });
  expect(await oauthErrorIdentity(request(), env.OAUTH_KV)).toBeUndefined();
  await env.OAUTH_KV.delete(KEY);
  expect(await oauthErrorIdentity(request(), env.OAUTH_KV)).toBeUndefined();
});

it("returns only a correlation key when a verified grant has no email", async () => {
  await saveGrant({ metadata: undefined });
  expect(await oauthErrorIdentity(request(), env.OAUTH_KV)).toEqual({ userKey: "user:200003" });
});

it("ignores duplicate token fields and oversized bodies", async () => {
  await saveGrant();
  const duplicate = request();
  const body = new URLSearchParams(new TextDecoder().decode(await duplicate.arrayBuffer()));
  body.append("refresh_token", TOKEN);
  expect(
    await oauthErrorIdentity(new Request(duplicate.url, { method: "POST", body }), env.OAUTH_KV),
  ).toBeUndefined();
  expect(
    await oauthErrorIdentity(request({ padding: "x".repeat(16_385) }), env.OAUTH_KV),
  ).toBeUndefined();
});

it("keeps diagnostic KV failures from replacing the OAuth result", async () => {
  vi.spyOn(env.OAUTH_KV, "get").mockRejectedValueOnce(new Error("unavailable"));
  expect(await oauthErrorIdentity(request(), env.OAUTH_KV)).toBeUndefined();
});
