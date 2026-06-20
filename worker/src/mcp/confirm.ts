import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const NOT_CONFIRMED =
  "Not confirmed. Re-run with confirm:true, or connect a client that supports MCP elicitation.";

/**
 * Confirm a destructive/athlete-facing action. Prefers MCP elicitation (an
 * in-the-moment user prompt); falls back to an explicit confirm:true argument when
 * the client does not support elicitation. Never proceeds without one of the two.
 */
export async function confirmGate(
  server: McpServer,
  requestId: string | number | undefined,
  message: string,
  confirmArg: boolean | undefined,
): Promise<boolean> {
  if (confirmArg === true) return true;
  try {
    const result = await server.server.elicitInput(
      {
        message,
        requestedSchema: {
          type: "object",
          properties: { confirm: { type: "boolean", title: "Confirm", description: message } },
          required: ["confirm"],
        },
      },
      requestId === undefined ? undefined : { relatedRequestId: requestId },
    );
    return result.action === "accept" && result.content?.confirm === true;
  } catch (err) {
    // Elicitation unsupported by the client, or it errored. Fail closed; log so the
    // supported-but-errored case is diagnosable rather than silently a decline.
    console.warn("MCP elicitation unavailable; treating as not confirmed", err);
    return false;
  }
}
