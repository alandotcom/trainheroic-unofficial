import type { ServerContext } from "@modelcontextprotocol/server";
import { acceptedContent, inputRequired, inputResponse } from "@modelcontextprotocol/server";
import { errorResult, type ToolHandlerResult } from "./context";

export const NOT_CONFIRMED =
  "Not confirmed. Re-run with confirm:true, or connect a client that supports MCP elicitation.";

/**
 * Confirm a destructive/athlete-facing action.
 *
 * Prefers MCP multi-round-trip elicitation (`input_required`); falls back to an explicit
 * `confirm:true` argument when the client already confirmed. Never proceeds without one of the two.
 *
 * Returns `undefined` when the action may proceed, otherwise the result to return to the client
 * (`input_required` or an in-band denial).
 *
 * Written once in the 2026 `inputRequired` style: modern clients retry with `inputResponses`;
 * 2025-era sessionful clients are served by the SDK's legacy shim (pushed `elicitation/create`).
 * Stateless legacy HTTP cannot push mid-call — those clients must pass `confirm:true`.
 */
export function confirmGate(
  ctx: ServerContext,
  message: string,
  confirmArg: boolean | undefined,
): ToolHandlerResult | undefined {
  if (confirmArg === true) return undefined;

  const accepted = acceptedContent<{ confirm?: boolean }>(ctx.mcpReq.inputResponses, "confirm");
  if (accepted?.confirm === true) return undefined;

  const view = inputResponse(ctx.mcpReq.inputResponses, "confirm");
  if (view.kind !== "missing") {
    return errorResult(NOT_CONFIRMED);
  }

  return inputRequired({
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
  });
}
