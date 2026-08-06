import { describe, expect, it } from "vitest";
import type {
  CallToolResult,
  InputRequiredResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { isInputRequiredResult } from "@modelcontextprotocol/server";
import { confirmGate } from "../src/confirm";

function fakeCtx(inputResponses?: Record<string, unknown>): ServerContext {
  return {
    mcpReq: {
      inputResponses,
    },
  } as unknown as ServerContext;
}

describe("confirmGate", () => {
  it("returns confirmed on an explicit confirm flag without eliciting", () => {
    const gate = confirmGate(fakeCtx(), "msg", true);
    expect(gate.status).toBe("confirmed");
  });

  it("returns needs_input on first call without confirm", () => {
    const gate = confirmGate(fakeCtx(), "Delete this?", undefined);
    expect(gate.status).toBe("needs_input");
    if (gate.status !== "needs_input") return;
    expect(isInputRequiredResult(gate.result)).toBe(true);
    const result = gate.result as InputRequiredResult;
    expect(result.inputRequests?.confirm).toBeDefined();
  });

  it("returns confirmed when elicitation was accepted with confirm:true", () => {
    const gate = confirmGate(
      fakeCtx({
        confirm: { action: "accept", content: { confirm: true } },
      }),
      "msg",
      undefined,
    );
    expect(gate.status).toBe("confirmed");
  });

  it("returns denied when elicitation was declined", () => {
    const gate = confirmGate(
      fakeCtx({
        confirm: { action: "decline" },
      }),
      "msg",
      undefined,
    );
    expect(gate.status).toBe("denied");
    if (gate.status !== "denied") return;
    const result = gate.result as CallToolResult;
    expect(result.isError).toBe(true);
  });

  it("returns denied when accepted but confirm is not true", () => {
    const gate = confirmGate(
      fakeCtx({
        confirm: { action: "accept", content: { confirm: false } },
      }),
      "msg",
      undefined,
    );
    expect(gate.status).toBe("denied");
  });
});
