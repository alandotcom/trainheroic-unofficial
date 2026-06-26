import { afterEach, describe, expect, it, vi } from "vitest";
import { swapAthleteExercise } from "../src/athlete-set-write";
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

const SWE_ID = 2714543795;
const OLD_EXERCISE_ID = 6535;
const NEW_EXERCISE_ID = 31577;
const ATHLETE_ID = 2858055;

// The updated saved-workout-set-exercise row the swap endpoint returns: top-level exercise_id is
// the new exercise; the nested workout_set_exercise keeps the team's original prescription.
function swappedRow() {
  return {
    id: SWE_ID,
    user_id: ATHLETE_ID,
    exercise_id: NEW_EXERCISE_ID,
    workout_set_exercise: { id: 1187782394, exercise_id: OLD_EXERCISE_ID },
    exercise: { id: NEW_EXERCISE_ID, title: "2-arm DB Clean" },
  };
}

describe("swapAthleteExercise", () => {
  it("PUTs the new exercise as a query param with an empty body and projects the row", async () => {
    const calls: Array<{ url: string; method?: string | undefined; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/auth")) return json({ id: 1, session_id: "s" });
        calls.push({ url, method: init?.method, body: init?.body });
        return json(swappedRow());
      }),
    );

    const result = await swapAthleteExercise(new TrainHeroicClient("a@b.com", "pw"), {
      savedWorkoutSetExerciseId: SWE_ID,
      exerciseId: NEW_EXERCISE_ID,
    });

    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain(
      `/v5/savedWorkoutSetExercises/${SWE_ID}?exerciseId=${NEW_EXERCISE_ID}`,
    );
    // Empty body — the new exercise rides in the query string, not the payload.
    expect(put?.body).toBeUndefined();
    expect(result).toEqual({
      savedWorkoutSetExerciseId: SWE_ID,
      athleteId: ATHLETE_ID,
      newExerciseId: NEW_EXERCISE_ID,
      newExerciseTitle: "2-arm DB Clean",
      originalTeamExerciseId: OLD_EXERCISE_ID,
    });
  });

  it("flags a read-only (demo) athlete on a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/auth") ? json({ id: 1, session_id: "s" }) : json({}, 401),
      ),
    );

    await expect(
      swapAthleteExercise(new TrainHeroicClient("a@b.com", "pw"), {
        savedWorkoutSetExerciseId: SWE_ID,
        exerciseId: NEW_EXERCISE_ID,
      }),
    ).rejects.toThrow(/read-only/u);
  });
});
