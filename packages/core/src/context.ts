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

// ---------------------------------------------------------------------------
// Payload budgeting
//
// Hosts cap tool-result text (claude.ai / Claude Desktop truncate around 150k
// characters; Claude Code at ~25k tokens). When a result exceeds the cap the host
// silently swaps in a file-pointer string the model cannot parse, with no hint that
// size was the cause. So we bound our own output below the smallest effective cap and
// degrade with a readable marker instead of letting the host mangle it. JSON of
// snake_case keys tokenizes worse than prose, so the default is deliberately low.
// ---------------------------------------------------------------------------

/** Conservative per-result character cap, below the smallest host cap. */
export const DEFAULT_RESULT_BUDGET = 60_000;

/** Reserve for the `__truncated` marker so wrapping cannot push back over budget. */
const MARKER_RESERVE = 300;

const DEFAULT_ARRAY_HINT =
  "Result was truncated to fit the size budget. Narrow it with a filter/search argument or paginate to see the rest.";
const DEFAULT_OBJECT_HINT =
  "Result was truncated to fit the size budget. Request a more specific id or sub-resource.";

/** Active budget. Overridable via TH_MCP_RESULT_BUDGET on Node; the default on workerd. */
export function resultBudget(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const raw = env?.TH_MCP_RESULT_BUDGET;
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RESULT_BUDGET;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Largest count k such that the JSON of the first k pre-serialized pieces fits. O(n). */
function largestPrefixCount(pieces: string[], charBudget: number): number {
  // Start at 2 for the surrounding "[" and "]".
  let used = 2;
  let k = 0;
  for (const piece of pieces) {
    // Add one for the comma separator after the first element.
    const add = piece.length + (k > 0 ? 1 : 0);
    if (used + add > charBudget) break;
    used += add;
    k += 1;
  }
  return k;
}

/** Last resort: cap a string at the budget and label it as truncated, non-JSON output. */
function hardCap(text: string, budget: number, hint?: string): string {
  if (text.length <= budget) return text;
  const note = `\n\n[TRUNCATED: output exceeded ${budget} chars and is NOT valid JSON. ${
    hint ?? "Narrow the query (filter, paginate, or fetch a specific id)."
  }]`;
  const keep = Math.max(0, budget - note.length);
  return text.slice(0, keep) + note;
}

function largestArrayValuedKey(obj: Record<string, unknown>): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const [key, value] of Object.entries(obj)) {
    if (!Array.isArray(value)) continue;
    const len = (JSON.stringify(value) ?? "[]").length;
    if (len > bestLen) {
      best = key;
      bestLen = len;
    }
  }
  return best;
}

/**
 * Serialize `data` as JSON within `budget` characters. Small results are pretty-printed.
 * Oversized results degrade in order: trim a top-level array (wrapping it as
 * `{ items, __truncated }`), then a top-level object's largest array property (annotated
 * with `__truncated`), then a last-resort hard character cap. Pure and side-effect free.
 */
export function boundedSerialize(data: unknown, budget: number, hint?: string): string {
  // A string body (e.g. a non-JSON API response) still needs a hard cap.
  if (typeof data === "string") return hardCap(data, budget, hint);

  // JSON.stringify(undefined) returns undefined, so coerce to a "null" sentinel.
  const compact = JSON.stringify(data) ?? "null";
  if (compact.length <= budget) {
    const pretty = JSON.stringify(data, null, 2) ?? "null";
    return pretty.length <= budget ? pretty : compact;
  }

  if (Array.isArray(data)) {
    const pieces = data.map((el) => JSON.stringify(el) ?? "null");
    const k = largestPrefixCount(pieces, budget - MARKER_RESERVE);
    const wrapped = {
      items: data.slice(0, k),
      __truncated: {
        returned: k,
        total: data.length,
        omitted: data.length - k,
        hint: hint ?? DEFAULT_ARRAY_HINT,
      },
    };
    const out = JSON.stringify(wrapped);
    if (out.length <= budget) return out;
  } else if (isPlainObject(data)) {
    const key = largestArrayValuedKey(data);
    if (key !== null) {
      const arr = data[key] as unknown[];
      const pieces = arr.map((el) => JSON.stringify(el) ?? "null");
      // Leave room for the rest of the object and the marker before filling the array.
      const restLen = (JSON.stringify({ ...data, [key]: [] }) ?? "{}").length;
      const k = largestPrefixCount(pieces, Math.max(0, budget - MARKER_RESERVE - restLen));
      const clone: Record<string, unknown> = {
        ...data,
        [key]: arr.slice(0, k),
        __truncated: {
          field: key,
          returned: k,
          total: arr.length,
          omitted: arr.length - k,
          hint: hint ?? DEFAULT_OBJECT_HINT,
        },
      };
      const out = JSON.stringify(clone);
      if (out.length <= budget) return out;
    }
  }

  return hardCap(compact, budget, hint);
}

/** Per-tool guidance threaded into the truncation marker when a result is too large. */
export type BudgetHint = { hint?: string | undefined };

/** A successful tool result carrying JSON (or text) for the model, size-bounded. */
export function jsonResult(data: unknown, opts?: BudgetHint): CallToolResult {
  const text = boundedSerialize(data, resultBudget(), opts?.hint);
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
  hint?: string,
): Promise<CallToolResult> {
  return attempt(async () => {
    const res = await ctx.client.request(method, path, options);
    if (!res.ok) {
      const raw = typeof res.data === "string" ? res.data : (JSON.stringify(res.data) ?? "");
      const detail = hardCap(raw, resultBudget());
      return errorResult(`TrainHeroic API error (HTTP ${res.status}): ${detail}`);
    }
    return jsonResult(res.data, { hint });
  });
}
