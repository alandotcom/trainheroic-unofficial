import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCommentPayload, deleteComment, readLive, sendComment } from "../src/messaging/send";
import { TrainHeroicClient } from "../src/trainheroic/client";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildCommentPayload", () => {
  it("includes feed_id (the easily-missed required field)", () => {
    expect(buildCommentPayload(700, "hi")).toEqual({
      type: 0,
      content: "hi",
      photo_url: "",
      photoUrl: "",
      access_level: 0,
      parent_feed_item_id: null,
      feed_id: 700,
    });
  });

  it("sets parent_feed_item_id for a threaded reply", () => {
    expect(buildCommentPayload(700, "re", 42).parent_feed_item_id).toBe(42);
  });
});

describe("sendComment", () => {
  it("posts the full body and returns the created comment", async () => {
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
        if (url.includes("/streams/700/comments")) {
          captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return json({ id: 999, content: "hi" });
        }
        return json({});
      }),
    );
    const result = await sendComment(new TrainHeroicClient("a@b.com", "pw"), 700, "hi");
    expect(result.id).toBe(999);
    expect(captured?.feed_id).toBe(700);
    expect(captured?.content).toBe("hi");
  });

  it("throws when the API does not return an id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/auth") ? json({ id: 1, session_id: "s" }) : json({}),
      ),
    );
    await expect(sendComment(new TrainHeroicClient("a@b.com", "pw"), 700, "hi")).rejects.toThrow(
      /send failed/u,
    );
  });
});

describe("readLive / deleteComment", () => {
  it("tails the recent messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/auth")
          ? json({ id: 1, session_id: "s" })
          : json([{ id: 1 }, { id: 2 }, { id: 3 }]),
      ),
    );
    const tail = await readLive(new TrainHeroicClient("a@b.com", "pw"), 700, 2);
    expect(tail).toHaveLength(2);
    expect((tail[1] as { id: number }).id).toBe(3);
  });

  it("issues a DELETE to the comment path", async () => {
    let deletedUrl: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (init?.method === "DELETE") {
          deletedUrl = url;
          return json({ success: 1 });
        }
        return json({});
      }),
    );
    await deleteComment(new TrainHeroicClient("a@b.com", "pw"), 700, 55);
    expect(deletedUrl).toContain("/v5/messaging/streams/700/comments/55");
  });
});
