import { describe, expect, it } from "vitest";
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { isInputRequiredResult } from "@modelcontextprotocol/server";
import { confirmGate, NOT_CONFIRMED } from "../src/confirm";

function fakeCtx(inputResponses?: Record<string, unknown>): ServerContext {
  return {
    mcpReq: {
      inputResponses,
    },
  } as unknown as ServerContext;
}

describe("confirmGate", () => {
  it("returns undefined on an explicit confirm flag", () => {
    expect(confirmGate(fakeCtx(), "msg", true)).toBeUndefined();
  });

  it("returns input_required on first call without confirm", () => {
    const blocked = confirmGate(fakeCtx(), "Delete this?", undefined);
    expect(blocked).toBeDefined();
    expect(isInputRequiredResult(blocked)).toBe(true);
  });

  it("returns undefined when elicitation was accepted with confirm:true", () => {
    expect(
      confirmGate(
        fakeCtx({
          confirm: { action: "accept", content: { confirm: true } },
        }),
        "msg",
        undefined,
      ),
    ).toBeUndefined();
  });

  it("returns an error result when elicitation was declined", () => {
    const blocked = confirmGate(
      fakeCtx({
        confirm: { action: "decline" },
      }),
      "msg",
      undefined,
    );
    expect((blocked as CallToolResult).isError).toBe(true);
    expect((blocked as CallToolResult).content?.[0]).toMatchObject({
      type: "text",
      text: NOT_CONFIRMED,
    });
  });

  it("returns an error result when accepted but confirm is not true", () => {
    const blocked = confirmGate(
      fakeCtx({
        confirm: { action: "accept", content: { confirm: false } },
      }),
      "msg",
      undefined,
    );
    expect((blocked as CallToolResult).isError).toBe(true);
  });
});
