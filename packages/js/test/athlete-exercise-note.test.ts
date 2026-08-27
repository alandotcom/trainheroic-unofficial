import { afterEach, describe, expect, it, vi } from "vitest";
import { setAthleteExerciseNote } from "../src/athlete-exercise-note";
import { TrainHeroicClient } from "../src/client";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const SWE_ID = 2809127408;

describe("setAthleteExerciseNote", () => {
  it("PUTs notes on /1.0/athlete/savedworkoutsetexercise/{id}", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (init?.method === "PUT") {
          puts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
          return json({ id: SWE_ID, notes: "green band" });
        }
        return json({});
      }),
    );

    const result = await setAthleteExerciseNote(new TrainHeroicClient("a@b.com", "pw"), {
      savedWorkoutSetExerciseId: SWE_ID,
      notes: "green band",
    });

    expect(puts).toHaveLength(1);
    expect(puts[0]?.url).toContain(`/1.0/athlete/savedworkoutsetexercise/${SWE_ID}`);
    expect(puts[0]?.body).toEqual({ id: SWE_ID, notes: "green band" });
    expect(result).toEqual({ savedWorkoutSetExerciseId: SWE_ID, notes: "green band" });
  });

  it("sends empty notes as a clear", async () => {
    const puts: Array<{ body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (init?.method === "PUT") {
          puts.push({ body: init.body ? JSON.parse(String(init.body)) : null });
          return json({ id: SWE_ID, notes: "" });
        }
        return json({});
      }),
    );

    const result = await setAthleteExerciseNote(new TrainHeroicClient("a@b.com", "pw"), {
      savedWorkoutSetExerciseId: String(SWE_ID),
      notes: "",
    });
    expect(puts[0]?.body).toEqual({ id: SWE_ID, notes: "" });
    expect(result.notes).toBe("");
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        return json({}, 500);
      }),
    );

    await expect(
      setAthleteExerciseNote(new TrainHeroicClient("a@b.com", "pw"), {
        savedWorkoutSetExerciseId: SWE_ID,
        notes: "nope",
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("throws on an invalid savedWorkoutSetExerciseId", async () => {
    await expect(
      setAthleteExerciseNote(new TrainHeroicClient("a@b.com", "pw"), {
        savedWorkoutSetExerciseId: "x",
        notes: "nope",
      }),
    ).rejects.toThrow(/Invalid savedWorkoutSetExerciseId/);
  });
});
