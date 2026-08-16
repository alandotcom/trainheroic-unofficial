import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteProgram, TrainHeroicClient } from "../src";

function json(obj: unknown, status = 200): Response {
  return new Response(typeof obj === "string" ? obj : JSON.stringify(obj), {
    status,
    headers: { "content-type": typeof obj === "string" ? "text/plain" : "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deleteProgram", () => {
  it("DELETEs /v5/programs/{programId} when the id is already the program id", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        paths.push(String(url));
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.endsWith("/1.0/coach/programs")) {
          return json([{ id: 5038722, group_program: 5074349, title: "Cal" }]);
        }
        if (url.endsWith("/v5/programs/5074349")) return json("Successfully deleted program");
        return json({}, 404);
      }),
    );

    const result = await deleteProgram(new TrainHeroicClient("a@b.com", "pw"), 5074349);

    expect(result).toEqual({ programId: 5074349, containerId: 5038722 });
    expect(paths.some((p) => p.endsWith("/v5/programs/5074349"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/v5/programs/5038722"))).toBe(false);
  });

  it("resolves a list_programs container id to group_program before deleting", async () => {
    const deleted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.endsWith("/1.0/coach/programs")) {
          return json([{ id: 5038722, group_program: 5074349, title: "Cal" }]);
        }
        if (String(init?.method).toUpperCase() === "DELETE") deleted.push(String(url));
        if (url.endsWith("/v5/programs/5074349")) return json("Successfully deleted program");
        return json("Unauthorized", 401);
      }),
    );

    const result = await deleteProgram(new TrainHeroicClient("a@b.com", "pw"), 5038722);

    expect(result).toEqual({ programId: 5074349, containerId: 5038722 });
    expect(deleted).toEqual([expect.stringMatching(/\/v5\/programs\/5074349$/u)]);
  });

  it("DELETEs the given id when it is not a standalone list_programs row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.endsWith("/1.0/coach/programs")) return json([]);
        if (url.endsWith("/v5/programs/99")) return json("Successfully deleted program");
        return json({}, 404);
      }),
    );

    await expect(deleteProgram(new TrainHeroicClient("a@b.com", "pw"), 99)).resolves.toEqual({
      programId: 99,
      containerId: null,
    });
  });

  it("rejects a non-positive id before making an API request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(deleteProgram(new TrainHeroicClient("a@b.com", "pw"), 0)).rejects.toThrow(/id/iu);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws when the delete endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.endsWith("/1.0/coach/programs")) return json([]);
        return json("Unauthorized", 401);
      }),
    );

    await expect(deleteProgram(new TrainHeroicClient("a@b.com", "pw"), 99)).rejects.toThrow(
      /HTTP 401/u,
    );
  });
});
