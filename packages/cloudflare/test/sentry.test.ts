import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicHttpError } from "@trainheroic-unofficial/js";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock("@sentry/cloudflare", () => ({
  captureException: (...args: unknown[]) => sentry.captureException(...args),
  getActiveSpan: () => undefined,
  httpServerIntegration: () => ({}),
  setTag: vi.fn(),
  withScope: (fn: (scope: { setUser: (user: unknown) => void }) => unknown) =>
    fn({ setUser: sentry.setUser }),
}));

import { trainHeroicHttpErrorReporter, trainHeroicLoginErrorReporter } from "../src/sentry";

afterEach(() => {
  sentry.captureException.mockReset();
  sentry.setUser.mockReset();
});

describe("TrainHeroic Sentry reporters", () => {
  it("captures a sanitized upstream failure with the user's email", () => {
    const error = new TrainHeroicHttpError(
      "post",
      "https://api.trainheroic.com/v5/workouts/private@example.com?token=secret",
      500,
    );

    trainHeroicHttpErrorReporter("user@example.com")(error);

    expect(sentry.setUser).toHaveBeenCalledWith({ email: "user@example.com" });
    expect(sentry.captureException).toHaveBeenCalledOnce();
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: {
        "http.request.method": "POST",
        "http.response.status_code": "500",
        "server.address": "api.trainheroic.com",
        "upstream.service": "trainheroic",
      },
    });
    expect(JSON.stringify(sentry.captureException.mock.calls[0])).not.toContain("private");
    expect(JSON.stringify(sentry.captureException.mock.calls[0])).not.toContain("secret");
  });

  it("suppresses expected interactive-login rejections at the hosted boundary", () => {
    const report = trainHeroicLoginErrorReporter("user@example.com");

    report(new TrainHeroicHttpError("POST", "https://apis.trainheroic.com/auth", 401));
    report(new TrainHeroicHttpError("POST", "https://apis.trainheroic.com/auth", 403));

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.setUser).not.toHaveBeenCalled();
  });

  it("reports unexpected interactive-login failures with the user's email", () => {
    const error = new TrainHeroicHttpError("POST", "https://apis.trainheroic.com/auth", 500);

    trainHeroicLoginErrorReporter("user@example.com")(error);

    expect(sentry.setUser).toHaveBeenCalledWith({ email: "user@example.com" });
    expect(sentry.captureException).toHaveBeenCalledWith(error, expect.any(Object));
  });
});
