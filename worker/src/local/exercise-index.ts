import {
  asExerciseList,
  buildSearchText,
  coerceInt,
  type ExerciseIndex,
  type ExerciseRow,
  type ExerciseView,
  rankSearch,
  type ResolveResult,
  unitLabel,
  unwrapEnvelope,
  withUnits,
} from "../store/exercise-util";
import type { TrainHeroicClient } from "../trainheroic/client";

const LIBRARY_PATH = "/v5/exerciseLibrary/all";
const CREATE_PATH = "/2.0/coach/exercise/create";
const TTL_MS = 7 * 24 * 3600 * 1000;

type Stored = {
  id: number;
  title: string;
  search: string;
  param_1_type: number | null;
  param_2_type: number | null;
  can_edit: number;
  user_id: number | null;
  use_count: number;
  raw: Record<string, unknown>;
};

function toStored(ex: Record<string, unknown>): Stored | null {
  const id = coerceInt(ex.id);
  if (id === null) return null;
  const title = String(ex.title ?? "");
  return {
    id,
    title,
    search: buildSearchText(title),
    param_1_type: coerceInt(ex.param_1_type),
    param_2_type: coerceInt(ex.param_2_type),
    can_edit: coerceInt(ex.can_edit) ?? 0,
    user_id: coerceInt(ex.user_id),
    use_count: coerceInt(ex.use_count) ?? 0,
    raw: ex,
  };
}

function toRow(s: Stored): ExerciseRow {
  return {
    id: s.id,
    title: s.title,
    param_1_type: s.param_1_type,
    param_2_type: s.param_2_type,
    can_edit: s.can_edit,
    user_id: s.user_id,
    use_count: s.use_count,
  };
}

/**
 * In-memory exercise mirror for the single-user local server: fetch the library once,
 * hold it in a Map for the life of the process. No database, same resolve/search/unit
 * behavior as the D1-backed store via the shared exercise-util helpers.
 */
export class InMemoryExerciseIndex implements ExerciseIndex {
  readonly #client: TrainHeroicClient;
  #byId = new Map<number, Stored>();
  #loadedAt = 0;

  constructor(client: TrainHeroicClient) {
    this.#client = client;
  }

  async ensureFresh(force = false): Promise<void> {
    if (force || this.#byId.size === 0 || Date.now() - this.#loadedAt > TTL_MS) {
      await this.refresh();
    }
  }

  async refresh(): Promise<Record<string, unknown>> {
    const res = await this.#client.request("GET", LIBRARY_PATH);
    if (!res.ok) throw new Error(`Exercise library fetch failed (HTTP ${res.status}).`);
    const list = asExerciseList(res.data);
    if (list.length === 0) throw new Error("Exercise library returned no rows; keeping the cache.");
    const next = new Map<number, Stored>();
    for (const ex of list) {
      const s = toStored(ex);
      if (s) next.set(s.id, s);
    }
    this.#byId = next;
    this.#loadedAt = Date.now();
    return { synced: next.size };
  }

  async get(id: number): Promise<Record<string, unknown> | null> {
    await this.ensureFresh();
    const s = this.#byId.get(id);
    if (!s) return null;
    const full = { ...s.raw };
    full.param_1_unit = unitLabel(full.param_1_type);
    full.param_2_unit = unitLabel(full.param_2_type);
    return full;
  }

  async defaults(id: number): Promise<{ param1: number | null; param2: number | null } | null> {
    const s = this.#byId.get(id);
    return s ? { param1: s.param_1_type, param2: s.param_2_type } : null;
  }

  async search(query: string, limit = 20): Promise<ExerciseView[]> {
    await this.ensureFresh();
    return this.#searchOnly(query, limit);
  }

  #searchOnly(query: string, limit: number): ExerciseView[] {
    const tokens = query
      .toLowerCase()
      .split(/\s+/u)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return [];
    const rows = [...this.#byId.values()]
      .filter((s) => tokens.every((t) => s.search.includes(t)))
      .map((s) => toRow(s));
    return rankSearch(rows, query, limit).map(withUnits);
  }

  #exact(name: string): ExerciseView | null {
    const q = name.trim().toLowerCase();
    const hits = [...this.#byId.values()]
      .filter((s) => s.search === q)
      .sort((a, b) => a.can_edit - b.can_edit);
    const first = hits[0];
    return first ? withUnits(toRow(first)) : null;
  }

  async resolve(name: string): Promise<ResolveResult> {
    await this.ensureFresh();
    let hit = this.#exact(name);
    if (hit) return { match: hit, candidates: [hit] };

    let candidates = this.#searchOnly(name, 20);
    if (candidates.length === 0) {
      await this.refresh();
      hit = this.#exact(name);
      if (hit) return { match: hit, candidates: [hit] };
      candidates = this.#searchOnly(name, 20);
    }
    if (candidates.length === 1) return { match: candidates[0] ?? null, candidates };
    return { match: null, candidates };
  }

  async create(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.#client.request("POST", CREATE_PATH, { body });
    if (!res.ok) throw new Error(`Exercise create failed (HTTP ${res.status}).`);
    const ex = unwrapEnvelope(res.data);
    if (ex && typeof ex === "object") {
      const s = toStored(ex as Record<string, unknown>);
      if (s) this.#byId.set(s.id, s);
    }
    return ex as Record<string, unknown>;
  }

  async recordDelete(id: number): Promise<void> {
    this.#byId.delete(id);
  }

  async stats(): Promise<Record<string, unknown>> {
    let custom = 0;
    for (const s of this.#byId.values()) if (s.can_edit === 1) custom += 1;
    return { exercises: this.#byId.size, custom, loaded: this.#loadedAt > 0 };
  }
}
