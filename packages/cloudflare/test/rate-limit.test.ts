import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { isLoginAttempt } from "../src/index";

describe("isLoginAttempt routing", () => {
  it("treats /token and /register as login attempts regardless of method", () => {
    expect(isLoginAttempt(new Request("http://x/token", { method: "POST" }), "/token")).toBe(true);
    expect(isLoginAttempt(new Request("http://x/register", { method: "POST" }), "/register")).toBe(
      true,
    );
  });

  it("treats only POST /authorize as a login attempt, not the GET render", () => {
    expect(
      isLoginAttempt(new Request("http://x/authorize", { method: "POST" }), "/authorize"),
    ).toBe(true);
    expect(isLoginAttempt(new Request("http://x/authorize", { method: "GET" }), "/authorize")).toBe(
      false,
    );
  });

  it("treats /mcp and other routes as non-login", () => {
    expect(isLoginAttempt(new Request("http://x/mcp", { method: "POST" }), "/mcp")).toBe(false);
    expect(
      isLoginAttempt(new Request("http://x/.well-known/x", { method: "GET" }), "/.well-known/x"),
    ).toBe(false);
  });
});

describe("edge rate limiting", () => {
  // The login limiter is the tightest budget (12/60s in wrangler.jsonc). Flooding from one
  // IP should trip a 429. The binding is best-effort, so assert that a 429 appears within a
  // generous number of attempts rather than at an exact request index.
  it("returns 429 after enough login attempts from one IP", async () => {
    const headers = { "CF-Connecting-IP": "203.0.113.7" };
    let saw429 = false;
    for (let i = 0; i < 40 && !saw429; i++) {
      const res = await SELF.fetch("http://localhost/token", { method: "POST", headers });
      if (res.status === 429) saw429 = true;
    }
    expect(saw429).toBe(true);
  });
});
