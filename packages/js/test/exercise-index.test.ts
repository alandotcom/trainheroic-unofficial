import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import { ExerciseLibrary } from "../src/exercise-index";
import { MemoryLibraryCache } from "../src/library-cache";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockApi(library: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth")) return json({ id: 1, session_id: "sess" });
      if (url.includes("/v5/exerciseLibrary/all")) return json(library);
      if (url.includes("/2.0/coach/exercise/create"))
        return json({ success: 1, data: { id: 555, title: "Made", param_1_type: 3 } });
      if (url.includes("/2.0/coach/exercise/update/"))
        return json({ success: 1, data: { id: 555, title: "Renamed", param_1_type: 3 } });
      if (url.includes("/v5/exercises/") && String(init?.method).toUpperCase() === "DELETE")
        return json("ok");
      return json({});
    }),
  );
}

function client(): TrainHeroicClient {
  return new TrainHeroicClient("a@b.com", "pw");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExerciseLibrary", () => {
  it("loads the library and resolves with units", async () => {
    mockApi([
      { id: 1, title: "Back Squat", param_1_type: 3, param_2_type: 1 },
      { id: 1162, title: "Bench Press", param_1_type: 3, param_2_type: 1 },
    ]);
    const r = await new ExerciseLibrary(client()).resolve("Back Squat");
    expect(r.match?.id).toBe(1);
    expect(r.match?.units).toEqual(["reps", "lb"]);
  });

  it("searches by token and gets full objects", async () => {
    mockApi([
      { id: 1, title: "Back Squat", param_1_type: 3, muscle_group: "legs" },
      { id: 1162, title: "Bench Press", param_1_type: 3 },
    ]);
    const lib = new ExerciseLibrary(client());
    expect((await lib.search("press")).some((e) => e.id === 1162)).toBe(true);
    const full = await lib.get(1);
    expect(full?.title).toBe("Back Squat");
    expect(full?.units).toEqual(["reps", null]);
    expect(full?.muscle_group).toBe("legs");
    expect(full).not.toHaveProperty("param_1_type");
    expect(full).not.toHaveProperty("param_2_type");
  });

  it("refuses to wipe the cache on an empty response", async () => {
    mockApi([]);
    await expect(new ExerciseLibrary(client()).refresh()).rejects.toThrow(/no rows/u);
  });

  it("write-through create then forget", async () => {
    mockApi([{ id: 1, title: "Back Squat", param_1_type: 3 }]);
    const lib = new ExerciseLibrary(client());
    await lib.refresh();
    await lib.create({ title: "Made", param_1_type: 3 });
    expect((await lib.get(555))?.title).toBe("Made");
    await lib.recordDelete(555);
    expect(await lib.get(555)).toBeNull();
  });

  it("write-through update POSTs then refreshes the cached title", async () => {
    mockApi([{ id: 555, title: "Made", param_1_type: 3, can_edit: 1 }]);
    const lib = new ExerciseLibrary(client());
    await lib.refresh();
    const updated = await lib.update(555, { title: "Renamed", param_1_type: 3 });
    expect(updated.title).toBe("Renamed");
    expect((await lib.get(555))?.title).toBe("Renamed");
    const posted = vi.mocked(fetch).mock.calls.filter(([url, init]) => {
      return (
        String(url).includes("/2.0/coach/exercise/update/555") &&
        String((init as RequestInit | undefined)?.method).toUpperCase() === "POST"
      );
    });
    expect(posted).toHaveLength(1);
  });

  it("write-through remove DELETEs the live exercise then drops the cache row", async () => {
    mockApi([{ id: 555, title: "Made", param_1_type: 3, can_edit: 1 }]);
    const lib = new ExerciseLibrary(client());
    await lib.refresh();
    expect((await lib.get(555))?.title).toBe("Made");
    await lib.remove(555);
    expect(await lib.get(555)).toBeNull();
    const deleted = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/v5/exercises/555") &&
          String((init as RequestInit | undefined)?.method).toUpperCase() === "DELETE",
      );
    expect(deleted).toHaveLength(1);
  });

  it("returns no match when ambiguous", async () => {
    mockApi([
      { id: 1, title: "Incline Bench Press", param_1_type: 3 },
      { id: 2, title: "Decline Bench Press", param_1_type: 3 },
    ]);
    const r = await new ExerciseLibrary(client()).resolve("bench press");
    expect(r.match).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(1);
  });

  it("does not refetch a fresh library for repeated unresolved names", async () => {
    mockApi([{ id: 1, title: "Back Squat", param_1_type: 3 }]);
    const lib = new ExerciseLibrary(client());
    await lib.refresh();

    expect((await lib.resolve("Definitely Missing")).match).toBeNull();
    expect((await lib.resolve("Definitely Missing")).match).toBeNull();

    const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(requests.filter((url) => url.includes("/v5/exerciseLibrary/all"))).toHaveLength(1);
  });

  it("fetches a cold library once when several callers wait on it concurrently", async () => {
    mockApi([{ id: 1, title: "Back Squat", param_1_type: 3 }]);
    const lib = new ExerciseLibrary(client());
    // A workout build resolving several exercises under Promise.all hits ensureFresh in parallel.
    await Promise.all([lib.resolve("Back Squat"), lib.search("squat"), lib.get(1)]);
    const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(requests.filter((url) => url.includes("/v5/exerciseLibrary/all"))).toHaveLength(1);
  });

  it("persists through the cache so a fresh instance loads without refetching", async () => {
    const cache = new MemoryLibraryCache();
    mockApi([{ id: 1, title: "Back Squat", param_1_type: 3 }]);
    await new ExerciseLibrary(client(), cache).resolve("Back Squat");

    // Library endpoint now fails; a fresh instance must serve from the saved snapshot.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/auth") ? json({ id: 1, session_id: "s" }) : json({}, 500),
      ),
    );
    const r = await new ExerciseLibrary(client(), cache).resolve("Back Squat");
    expect(r.match?.id).toBe(1);
  });
});
