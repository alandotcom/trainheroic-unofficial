import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { idArgSchema } from "@trainheroic-unofficial/dto";
import type { ExerciseIndex } from "@trainheroic-unofficial/js";
import type { RequestOptions, TrainHeroicClient } from "@trainheroic-unofficial/js";

/** A tool argument that accepts a numeric id as a number or a string of digits. */
export const idParam = idArgSchema;

export function toId(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

// Shared MCP tool-annotation presets (honest hints; the destructive gate is enforced
// in-handler via elicitation, not by these advisory flags).
export const READ = { readOnlyHint: true, openWorldHint: true } as const;
export const SYNC = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;
export const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const;

/** Everything a tool handler needs: the authenticated client and the exercise index. */
export type ToolContext = {
  client: TrainHeroicClient;
  index: ExerciseIndex;
};

/** Run a tool body, converting thrown errors into an in-band tool error. */
export async function attempt(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** A successful tool result carrying JSON (or text) for the model. */
export function jsonResult(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** A tool-level error: returned in-band (isError) so the model can self-correct. */
export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Issue a TrainHeroic request and format the outcome as a tool result. */
export async function apiCall(
  ctx: ToolContext,
  method: string,
  path: string,
  options?: RequestOptions,
): Promise<CallToolResult> {
  return attempt(async () => {
    const res = await ctx.client.request(method, path, options);
    if (!res.ok) {
      const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      return errorResult(`TrainHeroic API error (HTTP ${res.status}): ${detail}`);
    }
    return jsonResult(res.data);
  });
}
