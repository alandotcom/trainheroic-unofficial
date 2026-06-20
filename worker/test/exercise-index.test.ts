import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryExerciseIndex } from "../src/local/exercise-index";
import { TrainHeroicClient } from "../src/trainheroic/client";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi(library: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
      if (url.includes("/v5/exerciseLibrary/all")) return json(library);
      if (url.includes("/2.0/coach/exercise/create"))
        return json({ success: 1, data: { id: 555, title: "Made", param_1_type: 3 } });
      return json({});
    }),
  );
}

function index(): InMemoryExerciseIndex {
  return new InMemoryExerciseIndex(new TrainHeroicClient("a@b.com", "pw"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InMemoryExerciseIndex", () => {
  it("loads the library and resolves with units", async () => {
    mockApi([
      { id: 1, title: "Back Squat", param_1_type: 3, param_2_type: 1 },
      { id: 1162, title: "Bench Press", param_1_type: 3, param_2_type: 1 },
    ]);
    const r = await index().resolve("Back Squat");
    expect(r.match?.id).toBe(1);
    expect(r.match?.param_1_unit).toBe("reps");
    expect(r.match?.param_2_unit).toBe("lb");
  });

  it("searches by token and gets full objects", async () => {
    mockApi([
      { id: 1, title: "Back Squat", param_1_type: 3 },
      { id: 1162, title: "Bench Press", param_1_type: 3 },
    ]);
    const idx = index();
    expect((await idx.search("press")).some((e) => e.id === 1162)).toBe(true);
    expect((await idx.get(1))?.title).toBe("Back Squat");
  });

  it("refuses to wipe the cache on an empty response", async () => {
    mockApi([]);
    await expect(index().refresh()).rejects.toThrow(/no rows/u);
  });

  it("write-through create then forget", async () => {
    mockApi([{ id: 1, title: "Back Squat", param_1_type: 3 }]);
    const idx = index();
    await idx.refresh();
    await idx.create({ title: "Made", param_1_type: 3 });
    expect((await idx.get(555))?.title).toBe("Made");
    await idx.recordDelete(555);
    expect(await idx.get(555)).toBeNull();
  });

  it("returns no match when ambiguous", async () => {
    mockApi([
      { id: 1, title: "Incline Bench Press", param_1_type: 3 },
      { id: 2, title: "Decline Bench Press", param_1_type: 3 },
    ]);
    const r = await index().resolve("bench press");
    expect(r.match).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(1);
  });
});
