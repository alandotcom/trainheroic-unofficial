import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import { searchExerciseHistory } from "../src/athlete";

const catalog = [
  { id: 1, title: "Back Squat" },
  { id: 2, title: "Front Squat" },
  { id: 3, title: "Bench Press" },
  { id: 4, title: "Row" },
  { id: 5, title: "Dip" },
];

function stubCatalog(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.endsWith("/auth") ? { id: 1, session_id: "s" } : catalog;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchExerciseHistory", () => {
  it("returns only rows whose title carries every query token", async () => {
    stubCatalog();
    const hits = await searchExerciseHistory(new TrainHeroicClient("a@b.com", "pw"), "squat", 20);
    expect(hits.map((r) => r.title)).toEqual(["Back Squat", "Front Squat"]);
  });

  it("returns nothing for a query that matches no exercise", async () => {
    stubCatalog();
    const hits = await searchExerciseHistory(
      new TrainHeroicClient("a@b.com", "pw"),
      "kettlebell swing",
      20,
    );
    expect(hits).toEqual([]);
  });

  it("returns nothing for a blank query", async () => {
    stubCatalog();
    const hits = await searchExerciseHistory(new TrainHeroicClient("a@b.com", "pw"), "  ", 20);
    expect(hits).toEqual([]);
  });

  it("ranks an exact title first and honours the limit", async () => {
    stubCatalog();
    const hits = await searchExerciseHistory(
      new TrainHeroicClient("a@b.com", "pw"),
      "back squat",
      1,
    );
    expect(hits.map((r) => r.title)).toEqual(["Back Squat"]);
  });
});
