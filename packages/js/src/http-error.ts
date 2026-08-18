const MAX_REQUEST_KEYS = 50;
const MAX_RESPONSE_DEPTH = 4;
const MAX_RESPONSE_KEYS = 20;
const MAX_RESPONSE_ITEMS = 10;
const MAX_RESPONSE_NODES = 50;
const MAX_RESPONSE_STRING = 2_000;

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
const RESPONSE_CONTAINER_KEYS = new Set(["data", "response", "result"]);
const SENSITIVE_FIELD_PARTS = new Set([
  "address",
  "athlete",
  "authorization",
  "birthdate",
  "body",
  "coach",
  "content",
  "cookie",
  "credential",
  "credentials",
  "description",
  "dob",
  "email",
  "instruction",
  "name",
  "note",
  "notes",
  "passwd",
  "password",
  "phone",
  "secret",
  "session",
  "title",
  "token",
  "user",
  "username",
]);

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

function redactText(value: string): string {
  const redacted = value
    .replace(
      /\bAuthorization(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;&]+)/gi,
      (_match, separator: string) => `Authorization${separator}[Redacted]`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [Redacted]")
    .replace(
      /\b(password|passwd|secret|session[_-]?id|token|api[_-]?key)(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      (_match, key: string, separator: string) => `${key}${separator}[Redacted]`,
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[Redacted email]")
    .replace(/\b(?:bearer\s+)?[a-f0-9]{32,}\b/gi, "[Redacted]");
  return redacted.length <= MAX_RESPONSE_STRING
    ? redacted
    : `${redacted.slice(0, MAX_RESPONSE_STRING)}…[truncated]`;
}

function safeFieldName(key: string): string {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    return "[Redacted key]";
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(key)) return "[Redacted key]";
  return key;
}

function boundedEntries(object: Record<string, unknown>, limit: number): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const key in object) {
    if (!Object.hasOwn(object, key)) continue;
    entries.push([key, object[key]]);
    if (entries.length >= limit) break;
  }
  return entries;
}

function isSensitiveField(key: string): boolean {
  const parts = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return (
    parts.some((part) => SENSITIVE_FIELD_PARTS.has(part)) ||
    parts.at(-1) === "id" ||
    (parts.includes("api") && parts.includes("key")) ||
    (parts.includes("private") && parts.includes("key"))
  );
}

function safeRequestValue(key: string, value: unknown): JsonScalar | undefined {
  if (key === "is_circuit" && typeof value === "boolean") return value;
  if (["param_1_type", "param_2_type", "type"].includes(key) && typeof value === "number") {
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
): unknown {
  if (budget.nodes <= 0) return "[Truncated]";
  budget.nodes -= 1;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactText(value);
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
      if (isSensitiveField(key)) {
        budget.nodes -= 1;
        result[safeKey] = "[Redacted]";
      } else if (
        (item !== null && typeof item === "object") ||
        RESPONSE_DIAGNOSTIC_KEYS.has(key) ||
        safeRequestValue(key, item) !== undefined
      ) {
        result[safeKey] = sanitizedDiagnosticValue(item, depth + 1, budget);
      } else {
        budget.nodes -= 1;
        result[safeKey] = "[Redacted]";
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
      result[safeFieldName(key)] = sanitizedDiagnosticValue(value, depth + 1, activeBudget);
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
  return {
    type: "object",
    keys: boundedEntries(object, MAX_RESPONSE_KEYS).map(([key]) => safeFieldName(key)),
  };
}

export function parseResponseText(text: string): unknown {
  if (text.length === 0) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
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
        : requestBodySummary(diagnostics.requestBody);
    this.responseBody =
      diagnostics.responseBody === undefined
        ? undefined
        : responseBodyDiagnostics(diagnostics.responseBody);
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
