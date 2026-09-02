import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { MessagingStore } from "../src/index";
import { messageComment } from "../src/schema";
import { applyMigrations, makeSqliteWarehouse } from "../src/sqlite";

function json(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORG = 7;
const STREAM = { id: 55, title: "Team chat" };

describe("MessagingStore.syncStream", () => {
  it('stores a null imageUrl as SQL NULL rather than the text "null"', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/comments")) {
          return json([
            { id: 1, content: "no attachment", imageUrl: null, replies: [] },
            { id: 2, content: "with attachment", imageUrl: "https://cdn.example/a.jpg" },
            { id: 3, content: "field absent" },
          ]);
        }
        return json({});
      }),
    );
    const sqlite = new DatabaseSync(":memory:");
    applyMigrations(sqlite);
    const wh = makeSqliteWarehouse(sqlite);
    const store = new MessagingStore(wh, new TrainHeroicClient("a@b.com", "pw"), ORG);

    const result = await store.syncStream(STREAM, "team");
    expect(result.new).toBe(3);

    const rows = await wh.db
      .select({ id: messageComment.id, imageUrl: messageComment.imageUrl })
      .from(messageComment)
      .where(eq(messageComment.orgId, ORG))
      .orderBy(messageComment.id);
    expect(rows).toEqual([
      { id: 1, imageUrl: null },
      { id: 2, imageUrl: "https://cdn.example/a.jpg" },
      { id: 3, imageUrl: null },
    ]);
  });
});
