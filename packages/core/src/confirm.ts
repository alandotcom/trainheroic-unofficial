import type {
  CallToolResult,
  InputRequiredResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { acceptedContent, inputRequired, inputResponse } from "@modelcontextprotocol/server";
import { errorResult } from "./context";

export const NOT_CONFIRMED =
  "Not confirmed. Re-run with confirm:true, or connect a client that supports MCP elicitation.";

/** Outcome of {@link confirmGate}: proceed, deny, or return an MRTR input round. */
export type ConfirmGateResult =
  | { status: "confirmed" }
  | { status: "denied"; result: CallToolResult }
  | { status: "needs_input"; result: InputRequiredResult };

/**
 * Confirm a destructive/athlete-facing action.
 *
 * Prefers MCP multi-round-trip elicitation (`input_required`); falls back to an explicit
 * `confirm:true` argument when the client already confirmed. Never proceeds without one of the two.
 *
 * Written once in the 2026 `inputRequired` style: modern clients retry with `inputResponses`;
 * 2025-era sessionful clients are served by the SDK's legacy shim (pushed `elicitation/create`).
 * Stateless legacy HTTP cannot push mid-call — those clients must pass `confirm:true`.
 */
export function confirmGate(
  ctx: ServerContext,
  message: string,
  confirmArg: boolean | undefined,
): ConfirmGateResult {
  if (confirmArg === true) return { status: "confirmed" };

  const accepted = acceptedContent<{ confirm?: boolean }>(ctx.mcpReq.inputResponses, "confirm");
  if (accepted?.confirm === true) return { status: "confirmed" };

  const view = inputResponse(ctx.mcpReq.inputResponses, "confirm");
  if (view.kind !== "missing") {
    return { status: "denied", result: errorResult(NOT_CONFIRMED) };
  }

  return {
    status: "needs_input",
    result: inputRequired({
      inputRequests: {
        confirm: inputRequired.elicit({
          message,
          requestedSchema: {
            type: "object",
            properties: {
              confirm: { type: "boolean", title: "Confirm", description: message },
            },
            required: ["confirm"],
          },
        }),
      },
    }),
  };
}
