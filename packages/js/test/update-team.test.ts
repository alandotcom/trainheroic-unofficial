import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import { updateTeam } from "../src/coach";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("updateTeam", () => {
  it("PUTs title only when renaming", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/v5/teams/10") && init?.method === "PUT") {
          bodies.push(JSON.parse(String(init.body)));
          return json({ id: 10, title: "Renamed", group_program: 100 });
        }
        return json({});
      }),
    );
    const res = await updateTeam(new TrainHeroicClient("a@b.com", "pw"), {
      teamId: 10,
      title: "Renamed",
    });
    expect(bodies).toEqual([{ title: "Renamed" }]);
    expect(res).toMatchObject({ id: 10, title: "Renamed" });
  });

  it("PUTs title + group_program when both provided", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/v5/teams/10") && init?.method === "PUT") {
          bodies.push(JSON.parse(String(init.body)));
          return json({ id: 10, title: "Linked", group_program: 200 });
        }
        return json({});
      }),
    );
    await updateTeam(new TrainHeroicClient("a@b.com", "pw"), {
      teamId: 10,
      title: "Linked",
      groupProgram: 200,
    });
    expect(bodies).toEqual([{ title: "Linked", group_program: 200 }]);
  });

  it("GETs current title when only groupProgram is set, then PUTs both", async () => {
    const bodies: unknown[] = [];
    let got = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/v5/teams/10") && (init?.method === undefined || init.method === "GET")) {
          got = true;
          return json({ id: 10, title: "Keep Me", group_program: 100 });
        }
        if (url.includes("/v5/teams/10") && init?.method === "PUT") {
          bodies.push(JSON.parse(String(init.body)));
          return json({ id: 10, title: "Keep Me", group_program: 200 });
        }
        return json({});
      }),
    );
    await updateTeam(new TrainHeroicClient("a@b.com", "pw"), {
      teamId: 10,
      groupProgram: 200,
    });
    expect(got).toBe(true);
    expect(bodies).toEqual([{ title: "Keep Me", group_program: 200 }]);
  });

  it("rejects when neither title nor groupProgram is provided", async () => {
    await expect(updateTeam(new TrainHeroicClient("a@b.com", "pw"), { teamId: 10 })).rejects.toThrow(
      /title and\/or groupProgram/iu,
    );
  });
});
