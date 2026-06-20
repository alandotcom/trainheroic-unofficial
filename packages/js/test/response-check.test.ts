import { sessionCreateResponseSchema } from "@trainheroic-unofficial/dto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkResponse } from "../src/response-check";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkResponse", () => {
  it("is silent when the response matches", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkResponse(sessionCreateResponseSchema, { workout_id: 1, id: 2 }, "session create");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns with the label and field path on drift", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkResponse(sessionCreateResponseSchema, { id: 2 }, "session create");
    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0]?.[0]);
    expect(msg).toContain("session create");
    expect(msg).toContain("workout_id");
  });
});
