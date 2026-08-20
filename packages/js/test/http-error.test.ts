import { describe, expect, it, vi } from "vitest";
import { TrainHeroicHttpError, notifyHttpError } from "../src/http-error";

describe("notifyHttpError", () => {
  it("bounds captured response diagnostics", () => {
    const error = new TrainHeroicHttpError("GET", "https://api.trainheroic.com/test", 500, {
      responseBody: { message: "x".repeat(5_000) },
    });

    expect(JSON.stringify(error.responseBody).length).toBeLessThan(2_500);
    expect(error.responseBody).toEqual({ message: `${"x".repeat(2_000)}…[truncated]` });
  });

  it("redacts whitespace-heavy provider text without polynomial backtracking", () => {
    const startedAt = performance.now();
    const error = new TrainHeroicHttpError("GET", "https://api.trainheroic.com/test", 500, {
      responseBody: { message: `Authorization${" ".repeat(100_000)}!` },
    });

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(JSON.stringify(error.responseBody).length).toBeLessThan(2_500);
  });

  it("bounds the total response diagnostic tree", () => {
    const error = new TrainHeroicHttpError("GET", "https://api.trainheroic.com/test", 500, {
      responseBody: {
        errors: Array.from({ length: 10 }, (_, index) =>
          Object.fromEntries(
            Array.from({ length: 20 }, (_unused, field) => [
              `field_${index}_${field}`,
              "x".repeat(2_000),
            ]),
          ),
        ),
      },
    });

    expect(JSON.stringify(error.responseBody).length).toBeLessThan(125_000);
  });

  it("redacts identifiers and bearer credentials instead of trusting arbitrary values", () => {
    const error = new TrainHeroicHttpError("POST", "https://api.trainheroic.com/test", 500, {
      requestBody: {
        "private@example.com": true,
        is_circuit: false,
        type: "private-type",
      },
      responseBody: {
        error: {
          athlete_id: 42,
          authorization: "Bearer short-secret",
          message: 'Authorization: Bearer short-secret; {"token":"quoted-secret"}',
          nickname: "Private Athlete",
          ssn: "123-45-6789",
        },
      },
    });

    expect(error.requestBody).toEqual({
      keys: ["is_circuit", "[Redacted key]", "type"],
      type: "object",
      values: { is_circuit: false },
    });
    expect(error.responseBody).toEqual({
      error: {
        athlete_id: "[Redacted]",
        authorization: "[Redacted]",
        message: 'Authorization: [Redacted]; {"token":[Redacted]}',
        nickname: "[Redacted]",
        ssn: "[Redacted]",
      },
    });
    expect(JSON.stringify(error)).not.toContain("short-secret");
    expect(JSON.stringify(error)).not.toContain("quoted-secret");
    expect(JSON.stringify(error)).not.toContain("private@example.com");
    expect(JSON.stringify(error)).not.toContain("private-type");
    expect(JSON.stringify(error)).not.toContain("Private Athlete");
    expect(JSON.stringify(error)).not.toContain("123-45-6789");
  });

  it("redacts common credential field-name variants", () => {
    const error = new TrainHeroicHttpError("GET", "https://api.trainheroic.com/test", 500, {
      responseBody: {
        error: {
          access_token: "access-value",
          apiKey: "api-value",
          clientSecret: "client-value",
          refreshToken: "refresh-value",
          sessionToken: "session-value",
        },
      },
    });

    expect(error.responseBody).toEqual({
      error: {
        access_token: "[Redacted]",
        apiKey: "[Redacted]",
        clientSecret: "[Redacted]",
        refreshToken: "[Redacted]",
        sessionToken: "[Redacted]",
      },
    });
    expect(JSON.stringify(error)).not.toMatch(/(?:access|api|client|refresh|session)-value/);
  });

  it("bounds nested response containers", () => {
    let responseBody: unknown = { message: "unreachable private detail" };
    for (let index = 0; index < 20; index += 1) responseBody = { data: responseBody };

    const error = new TrainHeroicHttpError("GET", "https://api.trainheroic.com/test", 500, {
      responseBody,
    });

    expect(JSON.stringify(error.responseBody)).toContain("[Truncated]");
    expect(JSON.stringify(error.responseBody)).not.toContain("unreachable private detail");
  });

  it("classifies unsupported request body primitives without exposing their values", () => {
    const error = new TrainHeroicHttpError("POST", "https://api.trainheroic.com/test", 500, {
      requestBody: Symbol("private-symbol"),
    });

    expect(error.requestBody).toEqual({ type: "other" });
    expect(JSON.stringify(error)).not.toContain("private-symbol");
  });

  it("consumes rejected async handler results", async () => {
    const rejected = Promise.reject(new Error("telemetry failed"));
    void rejected.catch(() => {});
    const then = vi.spyOn(rejected, "then");

    notifyHttpError(() => rejected, "GET", "https://api.trainheroic.com/v5/teams", 500);
    await Promise.resolve();

    expect(then).toHaveBeenCalledOnce();
  });
});
