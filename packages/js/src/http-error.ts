const MAX_REQUEST_KEYS = 50;
const MAX_RESPONSE_DEPTH = 4;
const MAX_RESPONSE_KEYS = 20;
const MAX_RESPONSE_ITEMS = 10;
const MAX_RESPONSE_NODES = 50;

const RESPONSE_DIAGNOSTIC_KEYS = new Set([
  "code",
  "detail",
  "details",
  "error",
  "error_code",
  "errors",
  "message",
  "reason",
  "status",
  "status_code",
  "success",
]);
const RESPONSE_CONTAINER_KEYS = new Set(["data", "received", "response", "result"]);
const RESPONSE_STATUS_KEYS = new Set(["status", "status_code"]);
const RESPONSE_BOOLEAN_KEYS = new Set(["success"]);
const PARAMETER_TYPES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 18]);

type JsonScalar = boolean | number | string | null;
type DiagnosticBudget = { nodes: number };

export type RequestBodySummary =
  | { type: "array"; length: number }
  | { type: "object"; keys: string[]; values?: Record<string, JsonScalar> }
  | { type: "boolean" | "number" | "other" | "string" };

export type TrainHeroicHttpErrorDiagnostics = {
  requestBody?: unknown;
  responseBody?: unknown;
};

function safeFieldName(key: string): string {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    return "[Redacted key]";
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(key)) return "[Redacted key]";
  return key;
}

function boundedEntries(object: Record<string, unknown>, limit: number): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const key of Object.keys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    entries.push([key, descriptor && "value" in descriptor ? descriptor.value : undefined]);
    if (entries.length >= limit) break;
  }
  return entries;
}

function safeRequestValue(key: string, value: unknown): JsonScalar | undefined {
  if (key === "is_circuit" && typeof value === "boolean") return value;
  if (
    ["param_1_type", "param_2_type"].includes(key) &&
    typeof value === "number" &&
    PARAMETER_TYPES.has(value)
  ) {
    return value;
  }
  return undefined;
}

function requestBodySummary(body: unknown): RequestBodySummary {
  if (Array.isArray(body)) return { type: "array", length: body.length };
  if (body && typeof body === "object") {
    const entries = boundedEntries(body as Record<string, unknown>, MAX_REQUEST_KEYS).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    const keys = entries.map(([key]) => safeFieldName(key));
    const values: Record<string, JsonScalar> = {};
    for (const [key, value] of entries) {
      const safeValue = safeRequestValue(key, value);
      if (safeValue !== undefined) values[safeFieldName(key)] = safeValue;
    }
    return Object.keys(values).length > 0
      ? { type: "object", keys, values }
      : { type: "object", keys };
  }
  const primitive = typeof body;
  return primitive === "boolean" || primitive === "number" || primitive === "string"
    ? { type: primitive }
    : { type: "other" };
}

function sanitizedDiagnosticValue(
  value: unknown,
  depth: number,
  budget: DiagnosticBudget,
  field?: string,
): unknown {
  if (budget.nodes <= 0) return "[Truncated]";
  budget.nodes -= 1;
  if (value === null) return null;
  if (typeof value === "boolean") {
    return field && RESPONSE_BOOLEAN_KEYS.has(field) ? value : "[Redacted]";
  }
  if (typeof value === "number") {
    return field &&
      RESPONSE_STATUS_KEYS.has(field) &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
      ? value
      : "[Redacted]";
  }
  if (typeof value === "string") return "[Redacted]";
  if (depth >= MAX_RESPONSE_DEPTH) return "[Truncated]";
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value.slice(0, MAX_RESPONSE_ITEMS)) {
      if (budget.nodes <= 0) {
        result.push("[Truncated]");
        break;
      }
      result.push(sanitizedDiagnosticValue(item, depth + 1, budget));
    }
    return result;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of boundedEntries(value as Record<string, unknown>, MAX_RESPONSE_KEYS)) {
      if (budget.nodes <= 0) {
        result.truncated = "[Truncated]";
        break;
      }
      const safeKey = safeFieldName(key);
      const safeValue = safeRequestValue(key, item);
      if (RESPONSE_DIAGNOSTIC_KEYS.has(key)) {
        result[safeKey] = sanitizedDiagnosticValue(item, depth + 1, budget, key);
      } else if (RESPONSE_CONTAINER_KEYS.has(key) && item && typeof item === "object") {
        result[safeKey] = sanitizedDiagnosticValue(item, depth + 1, budget);
      } else if (safeValue !== undefined) {
        budget.nodes -= 1;
        result[safeKey] = safeValue;
      }
    }
    return result;
  }
  return `[${typeof value}]`;
}

function responseBodyDiagnostics(body: unknown, budget?: DiagnosticBudget, depth = 0): unknown {
  const activeBudget = budget ?? { nodes: MAX_RESPONSE_NODES };
  if (activeBudget.nodes <= 0 || depth >= MAX_RESPONSE_DEPTH) return "[Truncated]";
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sanitizedDiagnosticValue(body, depth, activeBudget);
  }

  const object = body as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of boundedEntries(object, MAX_RESPONSE_KEYS)) {
    if (activeBudget.nodes <= 0) {
      result.truncated = "[Truncated]";
      break;
    }
    if (RESPONSE_DIAGNOSTIC_KEYS.has(key)) {
      result[safeFieldName(key)] = sanitizedDiagnosticValue(value, depth + 1, activeBudget, key);
      continue;
    }
    if (RESPONSE_CONTAINER_KEYS.has(key) && value && typeof value === "object") {
      activeBudget.nodes -= 1;
      const nested = responseBodyDiagnostics(value, activeBudget, depth + 1);
      if (
        nested === "[Truncated]" ||
        (nested && typeof nested === "object" && Object.keys(nested).length > 0)
      ) {
        result[safeFieldName(key)] = nested;
      }
    }
  }

  if (Object.keys(result).length > 0) return result;
  return { type: "object" };
}

export function parseResponseText(text: string): unknown {
  if (text.length === 0) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function safeRequestBodySummary(body: unknown): RequestBodySummary {
  try {
    return requestBodySummary(body);
  } catch {
    return { type: "other" };
  }
}

function safeResponseBodyDiagnostics(body: unknown): unknown {
  try {
    return responseBodyDiagnostics(body);
  } catch {
    return "[Unavailable]";
  }
}

/** A final non-2xx response plus bounded, telemetry-safe request and response diagnostics. */
export class TrainHeroicHttpError extends Error {
  override readonly name = "TrainHeroicHttpError";
  readonly method: string;
  readonly status: number;
  readonly host: string;
  readonly requestBody: RequestBodySummary | undefined;
  readonly responseBody: unknown;

  constructor(
    method: string,
    url: string,
    status: number,
    diagnostics: TrainHeroicHttpErrorDiagnostics = {},
  ) {
    const parsed = new URL(url);
    const normalizedMethod = method.toUpperCase();
    super(`TrainHeroic ${normalizedMethod} request failed with HTTP ${status}`);
    this.method = normalizedMethod;
    this.status = status;
    this.host = parsed.host;
    this.requestBody =
      diagnostics.requestBody === undefined
        ? undefined
        : safeRequestBodySummary(diagnostics.requestBody);
    this.responseBody =
      diagnostics.responseBody === undefined
        ? undefined
        : safeResponseBodyDiagnostics(diagnostics.responseBody);
  }
}

export type TrainHeroicHttpErrorHandler = (error: TrainHeroicHttpError) => void | PromiseLike<void>;

/** Call observability hooks without allowing them to change SDK behavior. */
export function notifyHttpError(
  handler: TrainHeroicHttpErrorHandler | undefined,
  method: string,
  url: string,
  status: number,
  diagnostics: TrainHeroicHttpErrorDiagnostics = {},
): void {
  if (!handler) return;
  try {
    void Promise.resolve(handler(new TrainHeroicHttpError(method, url, status, diagnostics))).catch(
      () => {},
    );
  } catch {
    // Telemetry must never change the API result or hide the upstream response.
  }
}
