import { describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "../src/client";
import { saveSessionAsTemplate } from "../src/coach";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("saveSessionAsTemplate", () => {
  it("puts the workout id in the path and the programWorkout id in the body", async () => {
    const transport = vi.fn(async (_url: string, _init: RequestInit) =>
      json({ id: 900, title: "Lower A" }),
    );
    const client = new TrainHeroicClient("a@b.com", "pw", "live-session", { transport });

    const saved = await saveSessionAsTemplate(client, {
      workoutId: 10,
      pwId: 20,
      title: " Lower A ",
    });

    expect(saved).toEqual({ id: 900, title: "Lower A" });
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toMatch(/\/2\.0\/coach\/calendar\/programWorkout\/saveWorkoutAsTemplate\/10$/u);
    expect(JSON.parse(String(init?.body))).toEqual({ id: 20, title: "Lower A" });
  });

  it("names both ids when TrainHeroic rejects the save", async () => {
    const transport = vi.fn(async () => json({ message: "Server Error" }, 500));
    const client = new TrainHeroicClient("a@b.com", "pw", "live-session", { transport });

    await expect(
      saveSessionAsTemplate(client, { workoutId: 20, pwId: 10, title: "Lower A" }),
    ).rejects.toThrow(/session 10 \(workout 20\).*HTTP 500.*belong to the same session/u);
  });
});
