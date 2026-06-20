// Pure helpers for the exercise store. No I/O, so they are unit-testable directly.

import type { ExerciseRow, ExerciseView, ResolveResult } from "@trainheroic-unofficial/dto";

/**
 * Display labels for TrainHeroic parameter types. The unit is FIXED PER EXERCISE
 * (the API forces param_1_type/param_2_type back to the library default on save), so
 * resolve/search surface it to stop callers picking, say, the miles "Run" for a
 * metric workout. Keep in sync with the workout builder's unit table.
 */
export const PARAM_UNIT: Readonly<Record<number, string | null>> = {
  0: null,
  1: "lb",
  2: "%max",
  3: "reps",
  4: "sec",
  5: "yd",
  6: "m",
  7: "in",
  10: "mi",
  11: "ft",
  12: "in",
  13: "bpm",
  14: "RPE",
  18: "sec",
};

// TrainHeroic parameter-type codes. The fixed-unit labels live in PARAM_UNIT above.
export const PARAM_NONE = 0;
export const PARAM_WEIGHT = 1;
export const PARAM_PCT_MAX = 2;
export const PARAM_REPS = 3;
export const PARAM_RPE = 14;

export function coerceInt(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

export function coerceNum(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function unitLabel(paramType: unknown): string | null {
  const t = coerceInt(paramType);
  if (t === null) return null;
  return PARAM_UNIT[t] ?? null;
}

/** Annotate a row with human-readable units for display. */
export function withUnits(row: ExerciseRow): ExerciseView {
  return {
    ...row,
    param_1_unit: unitLabel(row.param_1_type),
    param_2_unit: unitLabel(row.param_2_type),
  };
}

export function buildSearchText(title: string): string {
  return title.trim().toLowerCase();
}

/** Strip the {"success":1,"data":X} envelope some 2.0/coach endpoints use. */
export function unwrapEnvelope(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    const keys = new Set(Object.keys(obj));
    const envelope = new Set(["success", "data", "message", "error"]);
    if ("data" in obj && [...keys].every((k) => envelope.has(k))) {
      return obj.data;
    }
  }
  return body;
}

/** Pull the exercise array out of whatever shape the bulk endpoint returns. */
export function asExerciseList(body: unknown): Array<Record<string, unknown>> {
  const unwrapped = unwrapEnvelope(body);
  if (Array.isArray(unwrapped)) {
    return unwrapped.filter((x): x is Record<string, unknown> => isRecord(x));
  }
  if (isRecord(unwrapped)) {
    const items: Array<Record<string, unknown>> = [];
    for (const key of ["exercises", "circuits", "workoutCircuits", "library", "items", "results"]) {
      const value = unwrapped[key];
      if (Array.isArray(value)) {
        items.push(...value.filter((x): x is Record<string, unknown> => isRecord(x)));
      }
    }
    if (items.length > 0) return items;
    const values = Object.values(unwrapped);
    if (values.length > 0 && values.every(isRecord)) {
      return values as Array<Record<string, unknown>>;
    }
  }
  return [];
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Rank candidate rows for a free-text query (FTS5 replacement). Higher is better:
 * exact title, then prefix, then count of matched tokens, with shorter titles and
 * standard (non-custom) exercises preferred on ties.
 */
export function rankSearch<T extends { title: string; can_edit: number }>(
  rows: readonly T[],
  query: string,
  limit: number,
): T[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/u).filter((t) => t.length > 0);
  const scored = rows.map((row) => {
    const title = row.title.toLowerCase();
    let score = 0;
    if (title === q) score += 1000;
    if (title.startsWith(q)) score += 100;
    for (const tok of tokens) if (title.includes(tok)) score += 10;
    score -= title.length * 0.05;
    if (row.can_edit === 0) score += 1;
    return { row, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.row);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The exercise-library surface the tools depend on, so the tools work over either a
 * D1-backed mirror (hosted, multi-tenant) or an in-memory cache (local, single-user).
 */
export interface ExerciseIndex {
  ensureFresh(): Promise<void>;
  refresh(): Promise<Record<string, unknown>>;
  resolve(name: string): Promise<ResolveResult>;
  search(query: string, limit?: number): Promise<ExerciseView[]>;
  get(id: number): Promise<Record<string, unknown> | null>;
  defaults(id: number): Promise<{ param1: number | null; param2: number | null } | null>;
  create(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  recordDelete(id: number): Promise<void>;
  stats(): Promise<Record<string, unknown>>;
}
