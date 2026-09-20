import type { ClientCapabilities, ServerContext } from "@modelcontextprotocol/server";
import {
  acceptedContent,
  CLIENT_CAPABILITIES_META_KEY,
  inputRequired,
  inputResponse,
} from "@modelcontextprotocol/server";
import { errorResult, type ToolHandlerResult } from "./context";

/**
 * Returned when the user was asked and said no. It must not tell the model how to retry: the
 * refusal is the answer. (The `confirm: true` fallback for clients that cannot elicit is
 * advertised in each gated tool's description, which is where a model looks before calling.)
 */
export const NOT_CONFIRMED = "Not confirmed — the user declined. Nothing was changed.";

/** Appended to the prompt so the fallback survives whichever way a client surfaces the request. */
const FALLBACK_HINT =
  " (If you cannot show this prompt, re-run the tool with confirm:true once the user has agreed.)";

const CONFIRMATION_REQUIRED =
  "Ask the user to approve this action, then retry the tool with confirm:true only after they " +
  "agree. Nothing was changed.";

type ModernRequestEnvelope = {
  [CLIENT_CAPABILITIES_META_KEY]?: ClientCapabilities;
};

/** `undefined` means a legacy request, whose capability check belongs to the SDK's shim. */
function modernClientSupportsFormElicitation(ctx: ServerContext): boolean | undefined {
  // The SDK validates the modern envelope before invoking the handler. Its public
  // RequestMetaEnvelope type is intentionally neutral, so narrow it at this boundary.
  const envelope = ctx.mcpReq.envelope as ModernRequestEnvelope | undefined;
  if (envelope === undefined) return undefined;

  const elicitation = envelope[CLIENT_CAPABILITIES_META_KEY]?.elicitation;
  if (elicitation === undefined) return false;

  // MCP SDK v2 treats a bare `elicitation: {}` declaration as form support for compatibility.
  return elicitation.form !== undefined || elicitation.url === undefined;
}

/**
 * Confirm a destructive/athlete-facing action.
 *
 * Prefers MCP multi-round-trip elicitation (`input_required`); falls back to an explicit
 * `confirm:true` argument when the client already confirmed. Never proceeds without one of the two.
 *
 * Returns `undefined` when the action may proceed, otherwise the result to return to the client
 * (`input_required` or an in-band denial).
 *
 * **Call this before any read or write.** MRTR is re-entrant: the client answers by re-sending
 * the whole `tools/call`, and the stateless handler builds a fresh server and runs the handler
 * from the top. Anything above the gate therefore executes twice on a confirmed action. If a
 * confirmation message ever needs data fetched first, that fetch must be idempotent.
 *
 * Written once in the 2026 `inputRequired` style: modern clients retry with `inputResponses`.
 * MCP correctly rejects unsupported embedded requests with `-32021`. This application has an
 * alternate `confirm: true` flow, so a modern client that does not declare form elicitation gets
 * a model-readable tool error that tells it how to recover while the gate remains closed.
 */
export function confirmGate(
  ctx: ServerContext,
  message: string,
  confirmArg: boolean | undefined,
): ToolHandlerResult | undefined {
  if (confirmArg === true) return undefined;

  const accepted = acceptedContent<{ confirm?: boolean }>(ctx.mcpReq.inputResponses, "confirm");
  if (accepted?.confirm === true) return undefined;

  // A response that is present but not an accepted `confirm: true` means the client already
  // answered this round — declined, cancelled, or accepted with `confirm: false`. Re-issuing
  // `inputRequired` here would ask the same question forever, so deny instead.
  const view = inputResponse(ctx.mcpReq.inputResponses, "confirm");
  if (view.kind !== "missing") {
    return errorResult(NOT_CONFIRMED);
  }

  if (modernClientSupportsFormElicitation(ctx) === false) {
    return errorResult(`${message} ${CONFIRMATION_REQUIRED}`);
  }

  const prompt = message + FALLBACK_HINT;
  return inputRequired({
    inputRequests: {
      confirm: inputRequired.elicit({
        message: prompt,
        requestedSchema: {
          type: "object",
          properties: {
            confirm: { type: "boolean", title: "Confirm", description: prompt },
          },
          required: ["confirm"],
        },
      }),
    },
  });
}
