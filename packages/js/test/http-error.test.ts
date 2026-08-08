import { describe, expect, it, vi } from "vitest";
import { notifyHttpError } from "../src/http-error";

describe("notifyHttpError", () => {
  it("consumes rejected async handler results", async () => {
    const rejected = Promise.reject(new Error("telemetry failed"));
    void rejected.catch(() => {});
    const then = vi.spyOn(rejected, "then");

    notifyHttpError(() => rejected, "GET", "https://api.trainheroic.com/v5/teams", 500);
    await Promise.resolve();

    expect(then).toHaveBeenCalledOnce();
  });
});
