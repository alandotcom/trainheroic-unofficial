import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";

// Pins the base-URL override seam: with no env set the client hits the production hosts (so every
// other test and real usage is unchanged), and with the TH_* overrides set it hits the override
// instead. This is the seam the eval harness relies on to point a spawned MCP server at a local
// fake backend, so a regression here would silently send eval traffic to the real API.

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function captureFetch(): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      // The login call is the POST; everything else is a data GET. Keyed on method (not the path)
      // so a custom TH_AUTH_URL like /login is still recognized as the auth call.
      return init?.method === "POST" ? json({ id: 1, session_id: "sess" }) : json({ ok: true });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TH_COACH_BASE;
  delete process.env.TH_APIS_BASE;
  delete process.env.TH_AUTH_URL;
});

describe("base-URL override", () => {
  it("hits the production hosts when no override is set", async () => {
    const calls = captureFetch();
    const client = new TrainHeroicClient("a@b.com", "pw");
    await client.request("GET", "/user/simple");
    await client.request("GET", "/v5/foo", { base: "apis" });

    expect(calls[0]).toBe("https://apis.trainheroic.com/auth");
    expect(calls[1]).toContain("https://api.trainheroic.com/user/simple");
    expect(calls[2]).toContain("https://apis.trainheroic.com/v5/foo");
  });

  it("routes the coach and apis hosts to TH_*_BASE when set", async () => {
    process.env.TH_COACH_BASE = "http://127.0.0.1:9911";
    process.env.TH_APIS_BASE = "http://127.0.0.1:9911";
    const calls = captureFetch();
    const client = new TrainHeroicClient("a@b.com", "pw");
    await client.request("GET", "/user/simple");
    await client.request("GET", "/v5/foo", { base: "apis" });

    // login derives from TH_APIS_BASE
    expect(calls[0]).toBe("http://127.0.0.1:9911/auth");
    expect(calls[1]).toBe("http://127.0.0.1:9911/user/simple");
    expect(calls[2]).toBe("http://127.0.0.1:9911/v5/foo");
  });

  it("prefers an explicit TH_AUTH_URL over the derived apis base", async () => {
    process.env.TH_APIS_BASE = "http://127.0.0.1:9911";
    process.env.TH_AUTH_URL = "http://127.0.0.1:9911/login";
    const calls = captureFetch();
    const client = new TrainHeroicClient("a@b.com", "pw");
    await client.request("GET", "/user/simple");

    expect(calls[0]).toBe("http://127.0.0.1:9911/login");
  });
});
