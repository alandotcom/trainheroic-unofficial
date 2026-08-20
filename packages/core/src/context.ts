import type { CallToolResult, InputRequiredResult } from "@modelcontextprotocol/server";
import { idArgSchema } from "@trainheroic-unofficial/dto";
import type { ExerciseIndex } from "@trainheroic-unofficial/js";
import type { ClientResult, RequestOptions, TrainHeroicClient } from "@trainheroic-unofficial/js";

/** What a tool handler may return: a finished result or an MRTR input round. */
export type ToolHandlerResult = CallToolResult | InputRequiredResult;

/** A tool argument that accepts a numeric id as a number or a string of digits. */
export const idParam = idArgSchema;

export function toId(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

// Shared MCP tool-annotation presets. These flags are advisory; tools that require confirmation
// enforce it separately in their handlers.
export const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;
export const ADDITIVE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;
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

/**
 * Run a tool body, converting thrown errors into an in-band tool error. Generic so a caller that
 * only ever produces a `CallToolResult` keeps that narrower type instead of widening to the
 * MRTR union — that is what lets `apiCall` delegate here rather than repeat this catch.
 */
export async function attempt<T extends ToolHandlerResult>(
  fn: () => Promise<T>,
): Promise<T | CallToolResult> {
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

/** Smallest cap that can still carry a useful structured truncation envelope. */
const MIN_RESULT_BUDGET = 256;

/** Reserve for the `__truncated` marker so wrapping cannot push back over budget. */
const MARKER_RESERVE = 300;

const DEFAULT_ARRAY_HINT =
  "Result was truncated to fit the size budget. Narrow it with a filter/search argument or paginate to see the rest.";
const DEFAULT_OBJECT_HINT =
  "Result was truncated to fit the size budget. Request a more specific id or sub-resource.";

/**
 * Clip an array to its first `keep` items and attach the `__truncated` marker describing what was
 * dropped. Every budget fallback that trims a list uses this envelope (`{ items, __truncated }`),
 * including in-place object-array truncation (the sliced array becomes `items` and `field` names
 * the original key). `athlete_exercises` uses the same helper for a client-side catalog cap.
 */
export function clipArray<T>(
  items: readonly T[],
  keep: number,
  hint?: string,
  field?: string,
): {
  items: T[];
  __truncated: {
    field?: string;
    returned: number;
    total: number;
    omitted: number;
    hint: string;
  };
} {
  const marker: {
    field?: string;
    returned: number;
    total: number;
    omitted: number;
    hint: string;
  } = {
    returned: keep,
    total: items.length,
    omitted: items.length - keep,
    hint: hint ?? DEFAULT_ARRAY_HINT,
  };
  if (field !== undefined) marker.field = field;
  return { items: items.slice(0, keep), __truncated: marker };
}

/** Active budget. Overridable via TH_MCP_RESULT_BUDGET on Node; the default on workerd. */
export function resultBudget(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const raw = env?.TH_MCP_RESULT_BUDGET;
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n >= MIN_RESULT_BUDGET ? n : DEFAULT_RESULT_BUDGET;
}

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
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

/** Cap diagnostic text. Tool errors are text-only and are not output-schema validated. */
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
 * A JSON value that can be carried by MCP `structuredContent`.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function jsonValue(data: unknown): JsonValue {
  return JSON.parse(JSON.stringify(data) ?? "null") as JsonValue;
}

function previewEnvelope(source: string, budget: number, hint?: string): JsonValue {
  const total = source.length;
  const makeValue = (preview: string, markerHint: string) => ({
    preview,
    __truncated: { total, omitted: total - preview.length, hint: markerHint },
  });

  let markerHint = hint ?? "Narrow the query (filter, paginate, or fetch a specific id).";
  while (JSON.stringify(makeValue("", markerHint)).length > budget && markerHint.length > 0) {
    markerHint = markerHint.slice(0, -1);
  }
  if (JSON.stringify(makeValue("", markerHint)).length > budget) {
    throw new RangeError("Result budget is too small for a structured truncation envelope.");
  }

  let keep = Math.max(0, budget - JSON.stringify(makeValue("", markerHint)).length);
  let value = makeValue(source.slice(0, keep), markerHint);
  while (JSON.stringify(value).length > budget && keep > 0) {
    keep = Math.max(0, keep - (JSON.stringify(value).length - budget));
    value = makeValue(source.slice(0, keep), markerHint);
  }
  return value;
}

function boundedResult(
  data: unknown,
  budget: number,
  hint?: string,
): { text: string; value: JsonValue } {
  if (typeof data === "string" && data.length <= budget) return { text: data, value: data };

  const value = jsonValue(data);
  const compact = JSON.stringify(value);
  if (compact.length <= budget) {
    const pretty = JSON.stringify(value, null, 2);
    return { text: pretty.length <= budget ? pretty : compact, value };
  }

  if (Array.isArray(value)) {
    const pieces = value.map((element) => JSON.stringify(element));
    const k = largestPrefixCount(pieces, budget - MARKER_RESERVE);
    const truncated = clipArray(value, k, hint);
    const text = JSON.stringify(truncated);
    if (text.length <= budget) return { text, value: truncated };
  } else if (isPlainObject(value)) {
    const key = largestArrayValuedKey(value);
    if (key !== null) {
      const array = value[key] as JsonValue[];
      const pieces = array.map((element) => JSON.stringify(element));
      const k = largestPrefixCount(pieces, budget - MARKER_RESERVE);
      const truncated = clipArray(array, k, hint ?? DEFAULT_OBJECT_HINT, key);
      const text = JSON.stringify(truncated);
      if (text.length <= budget) return { text, value: truncated };
    }
  }

  const truncated = previewEnvelope(typeof data === "string" ? data : compact, budget, hint);
  return { text: JSON.stringify(truncated), value: truncated };
}

/**
 * Serialize `data` within `budget` characters. Small JSON results are pretty-printed and small
 * strings remain plain text. Oversized values become valid JSON truncation envelopes.
 */
export function boundedSerialize(data: unknown, budget: number, hint?: string): string {
  return boundedResult(data, budget, hint).text;
}

/** Per-tool guidance threaded into the truncation marker when a result is too large. */
export type BudgetHint = { hint?: string | undefined };

/** A successful tool result carrying JSON (or text) for the model, size-bounded. */
export function jsonResult(data: unknown, opts?: BudgetHint): CallToolResult {
  const { text, value } = boundedResult(data, resultBudget(), opts?.hint);
  return { content: [{ type: "text", text }], structuredContent: value };
}

/** A tool-level error: returned in-band (isError) so the model can self-correct. */
export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Format an already-issued TrainHeroic response as a size-bounded tool result. */
export function apiResponseResult(res: ClientResult, hint?: string): CallToolResult {
  if (!res.ok) {
    const raw = typeof res.data === "string" ? res.data : (JSON.stringify(res.data) ?? "");
    const detail = hardCap(raw, resultBudget());
    return errorResult(`TrainHeroic API error (HTTP ${res.status}): ${detail}`);
  }
  return jsonResult(res.data, { hint });
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
    return apiResponseResult(res, hint);
  });
}
