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
      // resolveOrgId throws on an unresolvable org, so a failure leaves #orgId null
      // (retried next call) rather than caching a bogus tenant key.
      this.#orgId = await resolveOrgId((method, path) => this.client.request(method, path));
    }
    if (this.#orgId <= 0) {
      throw new Error("Refusing to scope a query to a non-positive org id.");
    }
    return this.#orgId;
  }
}
