import { afterEach, describe, expect, it, vi } from "vitest";
import { setAthleteWorkoutNote } from "../src/athlete-workout-note";
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

const DATE = "2026-06-21";
const PW_ID = 12345;
const SAVED_ID = 8000;

function dayWithSaved(
  opts: { id?: number; savedId?: number | null; notes?: string; rpe?: number | null } = {},
) {
  const saved =
    opts.savedId === null
      ? {}
      : {
          saved_workout: {
            id: opts.savedId ?? SAVED_ID,
            notes: opts.notes ?? "",
            rpe: opts.rpe === undefined ? 8 : opts.rpe,
            workoutSets: [],
          },
        };
  return [
    {
      id: opts.id ?? PW_ID,
      date: DATE,
      summarizedSavedWorkout: saved,
    },
  ];
}

describe("setAthleteWorkoutNote", () => {
  it("PUTs notes on /1.0/athlete/savedworkout/{id} after resolving the saved id from the range", async () => {
    const puts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) {
          return json(dayWithSaved({ notes: "old", rpe: 8 }));
        }
        if (init?.method === "PUT") {
          puts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
          // Live PUT echoes the stored object: notes-only leaves rpe as it was.
          return json({ id: SAVED_ID, notes: "felt strong", rpe: 8 });
        }
        return json({});
      }),
    );

    const result = await setAthleteWorkoutNote(new TrainHeroicClient("a@b.com", "pw"), {
      date: DATE,
      programWorkoutId: PW_ID,
      notes: "felt strong",
    });

    expect(puts).toHaveLength(1);
    expect(puts[0]?.url).toContain(`/1.0/athlete/savedworkout/${SAVED_ID}`);
    expect(puts[0]?.body).toEqual({ id: SAVED_ID, notes: "felt strong" });
    expect(result).toEqual({
      programWorkoutId: PW_ID,
      savedWorkoutId: SAVED_ID,
      date: DATE,
      notes: "felt strong",
      rpe: 8,
    });
  });

  it("includes rpe when provided and omits notes when they are not", async () => {
    const puts: Array<{ body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) {
          return json(dayWithSaved({ notes: "kept", rpe: 7 }));
        }
        if (init?.method === "PUT") {
          puts.push({ body: init.body ? JSON.parse(String(init.body)) : null });
          return json({ id: SAVED_ID, notes: "kept", rpe: 8 });
        }
        return json({});
      }),
    );

    const result = await setAthleteWorkoutNote(new TrainHeroicClient("a@b.com", "pw"), {
      date: DATE,
      programWorkoutId: PW_ID,
      rpe: 8,
    });

    expect(puts[0]?.body).toEqual({ id: SAVED_ID, rpe: 8 });
    expect(result.rpe).toBe(8);
    expect(result.notes).toBe("kept");
  });

  it("sends empty notes as a clear", async () => {
    const puts: Array<{ body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) {
          return json(dayWithSaved({ notes: "old", rpe: 8 }));
        }
        if (init?.method === "PUT") {
          puts.push({ body: init.body ? JSON.parse(String(init.body)) : null });
          return json({ id: SAVED_ID, notes: "", rpe: 8 });
        }
        return json({});
      }),
    );

    const result = await setAthleteWorkoutNote(new TrainHeroicClient("a@b.com", "pw"), {
      date: DATE,
      programWorkoutId: PW_ID,
      notes: "",
    });

    expect(puts[0]?.body).toEqual({ id: SAVED_ID, notes: "" });
    expect(result.notes).toBe("");
    expect(result.rpe).toBe(8);
  });

  it("throws when the program workout is not on that date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) return json(dayWithSaved({ id: 99 }));
        return json({});
      }),
    );

    await expect(
      setAthleteWorkoutNote(new TrainHeroicClient("a@b.com", "pw"), {
        date: DATE,
        programWorkoutId: PW_ID,
        notes: "nope",
      }),
    ).rejects.toThrow(/No workout with id 12345/);
  });

  it("throws when the workout has no saved copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        if (url.includes("/athlete/programworkout/range")) {
          return json(dayWithSaved({ savedId: null }));
        }
        return json({});
      }),
    );

    await expect(
      setAthleteWorkoutNote(new TrainHeroicClient("a@b.com", "pw"), {
        date: DATE,
        programWorkoutId: PW_ID,
        notes: "nope",
      }),
    ).rejects.toThrow(/no saved workout/i);
  });

  it("throws when neither notes nor rpe is provided", async () => {
    await expect(
      setAthleteWorkoutNote(new TrainHeroicClient("a@b.com", "pw"), {
        date: DATE,
        programWorkoutId: PW_ID,
      }),
    ).rejects.toThrow(/Provide notes and\/or rpe/);
  });
});
