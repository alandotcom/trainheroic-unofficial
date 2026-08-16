import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram, TrainHeroicClient } from "../src";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createProgram", () => {
  it.each([
    ["calendar", false, 1],
    ["fixed", true, 2],
  ] as const)("creates a %s program and returns unambiguous ids", async (kind, finite, type) => {
    let body: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.endsWith("/1.0/coach/programs/create")) {
          body = JSON.parse(String(init?.body));
          return json({
            id: 5038722,
            title: "Generated title",
            programId: 5074349,
            group_program: 5074349,
            type,
            program: { id: 5074349, program_type: type },
          });
        }
        return json({});
      }),
    );

    const result = await createProgram(new TrainHeroicClient("a@b.com", "pw"), {
      kind,
      name: "Requested title",
    });

    expect(body).toEqual({ finite, name: "Requested title" });
    expect(result).toEqual({
      containerId: 5038722,
      programId: 5074349,
      title: "Generated title",
      kind,
      requestedName: "Requested title",
      nameApplied: false,
    });
  });

  it("rejects a blank program name before making an API request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      createProgram(new TrainHeroicClient("a@b.com", "pw"), {
        kind: "calendar",
        name: "   ",
      }),
    ).rejects.toThrow(/name/iu);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a successful response that omits the two required ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        return json({ title: "Incomplete" });
      }),
    );

    await expect(
      createProgram(new TrainHeroicClient("a@b.com", "pw"), {
        kind: "fixed",
        name: "Incomplete",
      }),
    ).rejects.toThrow(/missing.*id/iu);
  });

  it("rejects a successful response that omits the assigned title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        return json({ id: 5038722, programId: 5074349, group_program: 5074349, type: 1 });
      }),
    );

    await expect(
      createProgram(new TrainHeroicClient("a@b.com", "pw"), {
        kind: "calendar",
        name: "Missing title",
      }),
    ).rejects.toThrow(/missing.*title/iu);
  });
});
