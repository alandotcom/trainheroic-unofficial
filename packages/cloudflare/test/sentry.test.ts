import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicHttpError } from "@trainheroic-unofficial/js";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  setUser: vi.fn(),
  wrapMcpServerWithSentry: vi.fn(
    (server: object, _options?: { recordInputs?: boolean; recordOutputs?: boolean }) => server,
  ),
  metrics: { count: vi.fn() },
}));

vi.mock("@sentry/cloudflare", () => ({
  captureException: (...args: unknown[]) => sentry.captureException(...args),
  getActiveSpan: () => undefined,
  httpServerIntegration: () => ({}),
  setTag: vi.fn(),
  metrics: sentry.metrics,
  withSentry: (_options: unknown, handler: object) => handler,
  instrumentDurableObjectWithSentry: (_options: unknown, object: unknown) => object,
  withScope: (fn: (scope: { setUser: (user: unknown) => void }) => unknown) =>
    fn({ setUser: sentry.setUser }),
  wrapMcpServerWithSentry: (
    server: object,
    options?: { recordInputs?: boolean; recordOutputs?: boolean },
  ) => sentry.wrapMcpServerWithSentry(server, options),
}));
import worker from "../src/index";

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
  sentry.metrics.count.mockReset();
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

describe("Sentry data collection", () => {
  it("collects no headers, bodies, cookies, query strings, query data, or inferred user fields", () => {
    expect(sentryOptions({} as Env).dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });
});

describe("Cloudflare trace propagation", () => {
  it("propagates RPC traces only to the upstream coordinator", () => {
    const options = sentryOptions({} as Env);

    expect(options.rpcTracePropagationBindings).toEqual(["TRAINHEROIC_UPSTREAM"]);
  });

  it("does not add Sentry trace headers to outbound HTTP requests", () => {
    expect(sentryOptions({} as Env).tracePropagationTargets).toEqual([]);
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
            message: "token=[Redacted]",
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

  it.each([
    ["MCP request", trainHeroicHttpErrorReporter],
    ["interactive login", trainHeroicLoginErrorReporter],
  ])("counts a TrainHeroic outage during %s without opening an issue", (_label, reporter) => {
    reporter("user@example.com")(
      new TrainHeroicHttpError("POST", "https://apis.trainheroic.com/auth", 522),
    );

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.setUser).not.toHaveBeenCalled();
    expect(sentry.metrics.count).toHaveBeenCalledWith("trainheroic.upstream.unavailable", 1, {
      attributes: { status: "522", host: "apis.trainheroic.com" },
    });
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
  it("rejects unsupported content types without waiting for the request stream to close", async () => {
    const body = new TransformStream<Uint8Array, Uint8Array>();
    const writer = body.writable.getWriter();
    const ctx = createExecutionContext();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/token", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: body.readable,
        }),
        env as Env,
        ctx,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
      expect(sentry.captureException).not.toHaveBeenCalled();
      await waitOnExecutionContext(ctx);
    } finally {
      await writer.abort();
    }
  });

  it("captures the verified user through the Worker's real token error path", async () => {
    const ctx = createExecutionContext();
    // The provider injects OAUTH_PROVIDER into the request env during fetch.
    const bindings = env as Env;
    const registration = await worker.fetch(
      new Request("http://localhost/register", {
        method: "POST",
        body: JSON.stringify({
          redirect_uris: ["http://localhost/cb"],
          token_endpoint_auth_method: "none",
        }),
        headers: { "content-type": "application/json" },
      }),
      bindings,
      ctx,
    );
    const { client_id: clientId } = (await registration.json()) as { client_id: string };
    const token = "200003:sentry-grant:private-refresh-secret";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    await env.OAUTH_KV.put(
      "grant:200003:sentry-grant",
      JSON.stringify({
        id: "sentry-grant",
        userId: "200003",
        clientId,
        metadata: { label: "coach@example.com" },
        refreshTokenId: hash,
        expiresAt: Date.now() / 1000 + 3600,
      }),
    );
    const response = await worker.fetch(
      new Request("http://localhost/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: token,
          resource: "http://localhost/mcp%20%5B1%5D%20(citation)",
        }),
      }),
      bindings,
      ctx,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_target" });
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        user: { email: "coach@example.com" },
        tags: expect.objectContaining({ "mcp.session": "user:200003" }),
      }),
    );
    expect(JSON.stringify(sentry.captureException.mock.calls)).not.toContain(
      "private-refresh-secret",
    );
    sentry.captureException.mockClear();
    const oversized = await worker.fetch(
      new Request("http://localhost/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: token,
          resource: "http://localhost/mcp%20%5B1%5D%20(citation)",
          padding: "x".repeat(20_000),
        }),
      }),
      bindings,
      ctx,
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toMatchObject({ error: "invalid_target" });
    expect(sentry.captureException.mock.calls[0]?.[1]).not.toHaveProperty("user");
    await waitOnExecutionContext(ctx);
  });

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

  it("does not report routine client errors", () => {
    oauthProviderErrorReporter({
      code: "invalid_token",
      description: "Invalid access token",
      status: 401,
      headers: {},
      internal: { category: "protected-resource", reason: "token_expired" },
    });

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("reports a rejected resource as a warning with verified account context", () => {
    oauthProviderErrorReporter(
      {
        code: "invalid_target",
        description: "The resource parameter must name exactly one configured protected resource",
        status: 400,
        headers: {},
        internal: { category: "resource-indicator", reason: "resource_not_configured" },
      },
      { userKey: "user:200003", email: "coach@example.com" },
    );

    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "OAuth resource rejected" }),
      {
        level: "warning",
        fingerprint: ["oauth-resource", "resource_not_configured"],
        user: { email: "coach@example.com" },
        tags: {
          "oauth.error.code": "invalid_target",
          "oauth.error.status": "400",
          "oauth.internal.category": "resource-indicator",
          "oauth.internal.reason": "resource_not_configured",
          "mcp.session": "user:200003",
        },
      },
    );
  });

  it("reports every server error whatever its category", () => {
    oauthProviderErrorReporter({
      code: "temporarily_unavailable",
      description: "Try again later",
      status: 503,
      headers: {},
      internal: { category: "token-issuance", reason: "kv_rate_limited" },
    });

    expect(sentry.captureException).toHaveBeenCalledOnce();
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
