import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicHttpError } from "@trainheroic-unofficial/js";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  setUser: vi.fn(),
  wrapMcpServerWithSentry: vi.fn(
    (server: object, _options?: { recordInputs?: boolean; recordOutputs?: boolean }) => server,
  ),
}));

vi.mock("@sentry/cloudflare", () => ({
  captureException: (...args: unknown[]) => sentry.captureException(...args),
  getActiveSpan: () => undefined,
  httpServerIntegration: () => ({}),
  setTag: vi.fn(),
  withScope: (fn: (scope: { setUser: (user: unknown) => void }) => unknown) =>
    fn({ setUser: sentry.setUser }),
  wrapMcpServerWithSentry: (
    server: object,
    options?: { recordInputs?: boolean; recordOutputs?: boolean },
  ) => sentry.wrapMcpServerWithSentry(server, options),
}));

import {
  instrumentMcpServer,
  oauthProviderErrorReporter,
  reportOAuthInternalError,
  sentryOptions,
  trainHeroicHttpErrorReporter,
  trainHeroicLoginErrorReporter,
} from "../src/sentry";

afterEach(() => {
  sentry.captureException.mockReset();
  sentry.setUser.mockReset();
  sentry.wrapMcpServerWithSentry.mockClear();
});

describe("MCP Sentry instrumentation", () => {
  it("uses the official MCP wrapper without recording tool inputs or outputs", () => {
    const server = {};

    expect(instrumentMcpServer(server)).toBe(server);
    expect(sentry.wrapMcpServerWithSentry).toHaveBeenCalledWith(server, {
      recordInputs: false,
      recordOutputs: false,
    });
  });
});

describe("TrainHeroic Sentry reporters", () => {
  it("captures a sanitized upstream failure with the user's email", () => {
    const error = new TrainHeroicHttpError(
      "post",
      "https://api.trainheroic.com/v5/workouts/private@example.com?token=secret",
      500,
      {
        requestBody: { param_1_type: 3, title: "Private title" },
        responseBody: {
          error: {
            code: "INVALID_EXERCISE",
            message: "token=private-token for coach@example.com",
          },
        },
      },
    );

    trainHeroicHttpErrorReporter("user@example.com")(error);

    expect(sentry.setUser).toHaveBeenCalledWith({ email: "user@example.com" });
    expect(sentry.captureException).toHaveBeenCalledOnce();
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      extra: {
        "trainheroic.request_body": {
          keys: ["param_1_type", "title"],
          type: "object",
          values: { param_1_type: 3 },
        },
        "trainheroic.response_body": {
          error: {
            code: "INVALID_EXERCISE",
            message: "[Redacted]",
          },
        },
      },
      tags: {
        "http.request.method": "POST",
        "http.response.status_code": "500",
        "server.address": "api.trainheroic.com",
        "upstream.service": "trainheroic",
      },
    });
    expect(JSON.stringify(sentry.captureException.mock.calls[0])).not.toContain("private");
    expect(JSON.stringify(sentry.captureException.mock.calls[0])).not.toContain("secret");
    expect(JSON.stringify(sentry.captureException.mock.calls[0])).not.toContain(
      "coach@example.com",
    );
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

describe("OAuth provider Sentry reporter", () => {
  it("captures application-owned OAuth diagnostics without a synthetic provider event", () => {
    reportOAuthInternalError({
      code: "server_error",
      status: 502,
      category: "client-id-metadata-document",
      reason: "metadata_resolution_failed",
    });

    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: {
        "oauth.error.code": "server_error",
        "oauth.error.status": "502",
        "oauth.internal.category": "client-id-metadata-document",
        "oauth.internal.reason": "metadata_resolution_failed",
      },
    });
  });

  it("captures internal provider failures without request or diagnostic detail", () => {
    oauthProviderErrorReporter({
      code: "invalid_client",
      description: "Client not found",
      status: 401,
      headers: {},
      internal: {
        category: "client-id-metadata-document",
        reason: "metadata_resolution_failed",
        detail: "https://client.example/private?token=secret timed out",
      },
      request: new Request("https://worker.example/token?code=private"),
    });

    expect(sentry.captureException).toHaveBeenCalledOnce();
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: {
        "oauth.error.code": "invalid_client",
        "oauth.error.status": "401",
        "oauth.internal.category": "client-id-metadata-document",
        "oauth.internal.reason": "metadata_resolution_failed",
      },
    });
    expect(JSON.stringify(sentry.captureException.mock.calls[0])).not.toContain("private");
    expect(JSON.stringify(sentry.captureException.mock.calls[0])).not.toContain("secret");
  });

  it("does not report ordinary client errors without an internal diagnosis", () => {
    oauthProviderErrorReporter({
      code: "invalid_request",
      description: "Missing grant_type",
      status: 400,
      headers: {},
    });

    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});

describe("tracesSampleRate from SENTRY_TRACES_SAMPLE_RATE", () => {
  const rate = (value: string | undefined): number =>
    sentryOptions({ SENTRY_TRACES_SAMPLE_RATE: value } as unknown as Env)
      .tracesSampleRate as number;

  it("uses a valid rate in [0, 1]", () => {
    expect(rate("0.25")).toBe(0.25);
    expect(rate("0")).toBe(0);
  });

  it("falls back to 1 when unset, blank, non-numeric, or out of range", () => {
    expect(rate(undefined)).toBe(1);
    // Number("") is 0; a cleared dashboard variable must not switch tracing off.
    expect(rate("")).toBe(1);
    expect(rate("   ")).toBe(1);
    expect(rate("abc")).toBe(1);
    expect(rate("2")).toBe(1);
  });
});
