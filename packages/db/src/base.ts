import type { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { resolveAthleteUserId } from "@trainheroic-unofficial/js";
import type { DrizzleDb } from "./schema";
import {
  type BatchExec,
  type BatchStmt,
  type Warehouse,
  resolveOrgId,
  runBatches,
  runGroups,
} from "./runner";

/**
 * Base for the warehouse stores. Holds the Drizzle handle and its atomic-batch executor (the one
 * driver-specific seam — see {@link Warehouse}), plus the client. Subclasses build their own
 * statements against {@link db} and commit them through {@link exec} / {@link runGroups} /
 * {@link runBatches}, so the same store body runs on the D1 and node:sqlite adapters alike.
 */
abstract class WarehouseStore {
  protected readonly db: DrizzleDb;
  protected readonly exec: BatchExec;
  protected readonly client: TrainHeroicClient;

  constructor(wh: Warehouse, client: TrainHeroicClient) {
    this.db = wh.db;
    this.exec = wh.exec;
    this.client = client;
  }

  /** Run statement groups (each committed atomically) through this store's executor. */
  protected runGroups(
    groups: ReadonlyArray<readonly BatchStmt[]>,
    chunkSize?: number,
  ): Promise<void> {
    return runGroups(this.exec, groups, chunkSize);
  }

  /** Run statements in ordered chunks through this store's executor. */
  protected runBatches(statements: readonly BatchStmt[], chunkSize?: number): Promise<void> {
    return runBatches(this.exec, statements, chunkSize);
  }
}

/**
 * Base for tenant-scoped coach stores. Lazily resolves the coach's org_id (the tenant key) once,
 * via the single shared resolver. A failed resolve leaves it unresolved (retried next call) rather
 * than caching a bogus tenant key — two tenants must never collapse onto one partition.
 */
export abstract class OrgScopedStore extends WarehouseStore {
  #orgId: number | null;

  constructor(wh: Warehouse, client: TrainHeroicClient, orgId: number | null = null) {
    super(wh, client);
    this.#orgId = orgId;
  }

  protected async org(): Promise<number> {
    if (this.#orgId === null) {
      this.#orgId = await resolveOrgId((method, path) => this.client.request(method, path));
    }
    if (this.#orgId <= 0) {
      throw new Error("Refusing to scope a query to a non-positive org id.");
    }
    return this.#orgId;
  }
}

/**
 * Base for the athlete warehouse stores. Athletes have no org, so the tenant key is the athlete's
 * own numeric user id (from /user/simple), resolved lazily and cached. Mirrors OrgScopedStore's
 * fail-closed discipline.
 */
export abstract class AthleteScopedStore extends WarehouseStore {
  #userId: number | null;

  constructor(wh: Warehouse, client: TrainHeroicClient, userId: number | null = null) {
    super(wh, client);
    this.#userId = userId;
  }

  protected async user(): Promise<number> {
    if (this.#userId === null) {
      this.#userId = await resolveAthleteUserId(this.client);
    }
    if (this.#userId <= 0) {
      throw new Error("Refusing to scope a query to a non-positive athlete user id.");
    }
    return this.#userId;
  }
}
