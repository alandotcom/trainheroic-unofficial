import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TrainHeroicClient", () => {
  it.each([400, 500])(
    "reports a final HTTP %i response without changing the result",
    async (status) => {
      const onHttpError = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => json({ error: "upstream rejected the request" }, status)),
      );
      const client = new TrainHeroicClient("a@b.com", "pw", "live-session", {
        onHttpError,
      });

      const result = await client.request("POST", "/v5/workouts/private@example.com?preview=true", {
        body: { private: "payload" },
      });

      expect(result).toMatchObject({ ok: false, status });
      expect(onHttpError).toHaveBeenCalledOnce();
      expect(onHttpError).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "TrainHeroicHttpError",
          method: "POST",
          host: "api.trainheroic.com",
          status,
        }),
      );
      expect(String(onHttpError.mock.calls[0]?.[0])).not.toContain("private@example.com");
      expect(String(onHttpError.mock.calls[0]?.[0])).not.toContain("preview");
    },
  );

  it("logs in lazily then issues the request", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return url.endsWith("/auth") ? json({ id: 1, session_id: "sess" }) : json({ ok: true });
      }),
    );
    const client = new TrainHeroicClient("a@b.com", "pw");
    const res = await client.request<{ ok: boolean }>("GET", "/user/simple");

    expect(res.ok).toBe(true);
    expect(res.data.ok).toBe(true);
    expect(client.sessionId).toBe("sess");
    expect(calls[0]).toContain("/auth");
    expect(calls[1]).toContain("api.trainheroic.com/user/simple");
  });

  it("re-logs in once on a 401 and retries", async () => {
    let dataCalls = 0;
    let logins = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) {
          logins += 1;
          return json({ id: 1, session_id: `s${logins}` });
        }
        dataCalls += 1;
        return dataCalls === 1 ? json({ error: "expired" }, 401) : json({ ok: true });
      }),
    );
    const client = new TrainHeroicClient("a@b.com", "pw", "stale-session");
    const res = await client.request("GET", "/v5/athletes");

    expect(res.ok).toBe(true);
    expect(logins).toBe(1);
    expect(dataCalls).toBe(2);
    expect(client.sessionId).toBe("s1");
  });

  it("does not report a transient 401 when re-login succeeds", async () => {
    const onHttpError = vi.fn();
    let dataCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "fresh-session" });
        dataCalls += 1;
        return dataCalls === 1 ? json({ error: "expired" }, 401) : json({ ok: true });
      }),
    );
    const client = new TrainHeroicClient("a@b.com", "pw", "stale-session", {
      onHttpError,
    });

    expect((await client.request("GET", "/v5/athletes")).ok).toBe(true);
    expect(onHttpError).not.toHaveBeenCalled();
  });

  it("does not report an expected final status after re-login", async () => {
    const onHttpError = vi.fn();
    let dataCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "fresh-session" });
        dataCalls += 1;
        return json({ error: "Cannot access program" }, 401);
      }),
    );
    const client = new TrainHeroicClient("a@b.com", "pw", "stale-session", {
      onHttpError,
    });

    const result = await client.request("GET", "/3.0/coach/program/42", {
      expectedStatuses: [401],
    });

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(dataCalls).toBe(2);
    expect(onHttpError).not.toHaveBeenCalled();
  });

  it("shares one login across concurrent cold requests", async () => {
    let logins = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) {
          logins += 1;
          return json({ id: 1, session_id: "sess" });
        }
        return json({ ok: true });
      }),
    );
    const client = new TrainHeroicClient("a@b.com", "pw");
    const results = await Promise.all([
      client.request<{ ok: boolean }>("GET", "/a"),
      client.request<{ ok: boolean }>("GET", "/b"),
      client.request<{ ok: boolean }>("GET", "/c"),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(logins).toBe(1);

    // A later request reuses the cached session — no second login.
    await client.request("GET", "/d");
    expect(logins).toBe(1);
  });

  it("targets the apis host when base is 'apis'", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return json({});
      }),
    );
    const client = new TrainHeroicClient("a@b.com", "pw", "live-session");
    await client.request("GET", "/user", { base: "apis" });
    expect(urls.some((u) => u.startsWith("https://apis.trainheroic.com/user"))).toBe(true);
  });
});
