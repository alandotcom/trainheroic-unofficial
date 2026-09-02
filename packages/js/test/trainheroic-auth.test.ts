import { afterEach, describe, expect, it, vi } from "vitest";
import { loginTrainHeroic } from "../src/auth";

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loginTrainHeroic", () => {
  it.each([400, 500])(
    "reports an HTTP %i response without exposing credentials",
    async (status) => {
      const onHttpError = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("upstream error", { status })),
      );

      expect(
        await loginTrainHeroic("private@example.com", "very-secret", { onHttpError }),
      ).toBeNull();
      expect(onHttpError).toHaveBeenCalledOnce();
      expect(onHttpError).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "TrainHeroicHttpError",
          method: "POST",
          host: "apis.trainheroic.com",
          requestBody: undefined,
          responseBody: undefined,
          status,
        }),
      );
      const reported = JSON.stringify(onHttpError.mock.calls[0]?.[0]);
      expect(reported).not.toContain("private@example.com");
      expect(reported).not.toContain("very-secret");
    },
  );

  it("returns the session bundle on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ id: 42, session_id: "s".repeat(48), scope: "athlete", role: "coach" }),
      ),
    );
    expect(await loginTrainHeroic("a@b.com", "pw")).toEqual({
      thUserId: 42,
      sessionId: "s".repeat(48),
      scope: "athlete",
      role: "coach",
    });
  });

  it("reports a credential rejection to the caller", async () => {
    const onHttpError = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    expect(await loginTrainHeroic("a@b.com", "bad", { onHttpError })).toBeNull();
    expect(onHttpError).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });

  it("returns without reading an error response body", async () => {
    const onHttpError = vi.fn();
    const text = vi.fn(() => new Promise<string>(() => {}));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text,
      })),
    );

    const result = await Promise.race([
      loginTrainHeroic("a@b.com", "pw", { onHttpError }),
      new Promise<"timed out">((resolve) => {
        setTimeout(() => resolve("timed out"), 50);
      }),
    ]);

    expect(result).toBeNull();
    expect(text).not.toHaveBeenCalled();
    expect(onHttpError).toHaveBeenCalledWith(
      expect.objectContaining({ responseBody: undefined, status: 500 }),
    );
  });

  it("returns null when session_id is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ id: 42, scope: "athlete" })),
    );
    expect(await loginTrainHeroic("a@b.com", "pw")).toBeNull();
  });

  it("posts form-encoded credentials to the auth endpoint", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return jsonResponse({ id: 1, session_id: "x".repeat(48) });
      }),
    );
    await loginTrainHeroic("coach@x.com", "secret");
    expect(capturedUrl).toBe("https://apis.trainheroic.com/auth");
    expect(capturedInit?.method).toBe("POST");
    expect(String(capturedInit?.body)).toContain("coach%40x.com");
  });
});
