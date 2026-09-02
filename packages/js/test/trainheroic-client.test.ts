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
          requestBody: {
            keys: ["private"],
            type: "object",
          },
          responseBody: { error: "[Redacted]" },
          status,
        }),
      );
      const reported = JSON.stringify(onHttpError.mock.calls[0]?.[0]);
      expect(reported).not.toContain("private@example.com");
      expect(reported).not.toContain("preview");
      expect(reported).not.toContain("payload");
    },
  );

  it("reports allowlisted request values and redacted provider diagnostics", async () => {
    const onHttpError = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          {
            error: {
              code: "INVALID_EXERCISE",
              message: "token=provider-secret for coach@example.com",
              received: {
                param_1_type: 3,
                session_id: "private-session",
                title: "Private exercise title",
              },
            },
            athlete: { name: "Private Athlete" },
          },
          500,
        ),
      ),
    );
    const client = new TrainHeroicClient("a@b.com", "pw", "live-session", { onHttpError });

    await client.request("POST", "/2.0/coach/exercise/create", {
      body: {
        param_1_type: 3,
        param_2_type: 1,
        password: "private-password",
        title: "Private exercise title",
      },
    });

    const error = onHttpError.mock.calls[0]?.[0];
    expect(error).toMatchObject({
      requestBody: {
        keys: ["param_1_type", "param_2_type", "password", "title"],
        type: "object",
        values: { param_1_type: 3, param_2_type: 1 },
      },
      responseBody: {
        error: {
          code: "[Redacted]",
          message: "[Redacted]",
          received: {
            param_1_type: 3,
          },
        },
      },
    });
    const reported = JSON.stringify(error);
    expect(reported).not.toContain("provider-secret");
    expect(reported).not.toContain("coach@example.com");
    expect(reported).not.toContain("private-password");
    expect(reported).not.toContain("Private exercise title");
    expect(reported).not.toContain("Private Athlete");
  });

  it("reports failures without reading request body getters twice", async () => {
    const onHttpError = vi.fn();
    let reads = 0;
    const body = Object.defineProperty({}, "type", {
      enumerable: true,
      get() {
        reads += 1;
        if (reads > 1) throw new Error("getter read twice");
        return 3;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ code: "INVALID_REQUEST" }, 500)),
    );
    const client = new TrainHeroicClient("a@b.com", "pw", "live-session", { onHttpError });

    const result = await client.request("POST", "/v5/workouts", { body });

    expect(result.ok).toBe(false);
    expect(reads).toBe(1);
    expect(onHttpError).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { keys: ["type"], type: "object" } }),
    );
  });

  it("reports the HTTP failure before rethrowing an unreadable error body", async () => {
    const onHttpError = vi.fn();
    const bodyError = new Error("body stream failed");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => {
          throw bodyError;
        },
      })),
    );
    const client = new TrainHeroicClient("a@b.com", "pw", "live-session", { onHttpError });

    await expect(
      client.request("POST", "/v5/workouts", { body: { title: "Private" } }),
    ).rejects.toBe(bodyError);
    expect(onHttpError).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { keys: ["title"], type: "object" },
        responseBody: undefined,
        status: 500,
      }),
    );
  });

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
