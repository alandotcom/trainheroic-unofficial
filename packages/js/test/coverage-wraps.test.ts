import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionTemplate,
  deleteSessionTemplate,
  TrainHeroicClient,
  updateTeamPublishSettings,
} from "../src";

function json(obj: unknown, status = 200): Response {
  return new Response(typeof obj === "string" ? obj : JSON.stringify(obj), {
    status,
    headers: { "content-type": typeof obj === "string" ? "text/plain" : "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSessionTemplate", () => {
  it("POSTs title and instruction to /v5/sessions/template", async () => {
    let body: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.endsWith("/v5/sessions/template")) {
          body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
          return json({ id: 154548487, title: "Probe", instruction: "via instruction" });
        }
        return json({}, 404);
      }),
    );

    const result = await createSessionTemplate(new TrainHeroicClient("a@b.com", "pw"), {
      title: "Probe",
      instruction: "via instruction",
    });
    expect(result.id).toBe(154548487);
    expect(body).toEqual({ title: "Probe", instruction: "via instruction" });
  });
});

describe("deleteSessionTemplate", () => {
  it("DELETEs /v5/sessions/template/{id}", async () => {
    const deleted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (String(init?.method).toUpperCase() === "DELETE") deleted.push(String(url));
        if (url.endsWith("/v5/sessions/template/154548487"))
          return json("Session template deleted");
        return json({}, 404);
      }),
    );

    await expect(
      deleteSessionTemplate(new TrainHeroicClient("a@b.com", "pw"), 154548487),
    ).resolves.toEqual({ deleted: 154548487 });
    expect(deleted).toEqual([expect.stringMatching(/\/v5\/sessions\/template\/154548487$/u)]);
  });
});

describe("updateTeamPublishSettings", () => {
  it("GETs the program then POSTs the merged object", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.endsWith("/3.0/coach/program/5074600")) {
          return json({ id: 5074600, title: "Cal", pub_enabled: null, pub_days: null });
        }
        if (url.endsWith("/1.0/coach/team/updatePublishSettings")) {
          posts.push(init?.body === undefined ? undefined : JSON.parse(String(init.body)));
          return json({ id: 1, pub_enabled: 1 });
        }
        return json({}, 404);
      }),
    );

    await updateTeamPublishSettings(new TrainHeroicClient("a@b.com", "pw"), {
      programId: 5074600,
      patch: { pub_enabled: 1 },
    });
    expect(posts).toEqual([{ id: 5074600, title: "Cal", pub_enabled: 1, pub_days: null }]);
  });
});
