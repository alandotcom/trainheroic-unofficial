import { afterEach, describe, expect, it, vi } from "vitest";
import { loginTrainHeroic } from "../src/trainheroic/auth";

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

  it("returns null on an HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    expect(await loginTrainHeroic("a@b.com", "bad")).toBeNull();
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
