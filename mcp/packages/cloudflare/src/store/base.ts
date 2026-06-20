import type { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { resolveOrgId } from "./d1";

/**
 * Base for tenant-scoped D1 stores. Holds the database + client and lazily resolves
 * the coach's org_id (the tenant key) once, via the single shared resolver.
 */
export abstract class OrgScopedStore {
  protected readonly db: D1Database;
  protected readonly client: TrainHeroicClient;
  #orgId: number | null;

  constructor(db: D1Database, client: TrainHeroicClient, orgId: number | null = null) {
    this.db = db;
    this.client = client;
    this.#orgId = orgId;
  }

  protected async org(): Promise<number> {
    if (this.#orgId === null) {
      this.#orgId = await resolveOrgId((method, path) => this.client.request(method, path));
    }
    return this.#orgId;
  }
}
