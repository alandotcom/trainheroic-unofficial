import { and, asc, eq } from "drizzle-orm";
import { fetchRosterMainLiftPRs } from "@trainheroic-unofficial/js";
import { OrgScopedStore } from "../base";
import { type BatchStmt } from "../runner";
import { coachAthletePr, syncMeta } from "../schema";

const SYNCED_AT_KEY = "coach_main_lift_prs_synced_at";

export type CoachPrSyncResult = {
  athletes: number;
  rows: number;
  syncedAt: number;
};

export type CoachAthletePrRow = {
  athleteId: number;
  athleteName: string | null;
  family: string;
  label: string | null;
  exerciseId: number | null;
  exerciseTitle: string | null;
  weight: number | null;
  reps: number | null;
  units: string | null;
  date: string | null;
};

/**
 * Coach roster main-lift PRs warehouse. {@link sync} resolves the roster's logged lift variants and
 * best PRs ({@link fetchRosterMainLiftPRs}) and stores one row per logged family; {@link read}
 * returns the stored board. Mirrors the other coach stores (org-scoped, accumulate-by-replace per
 * athlete) and works unchanged on the D1 and node:sqlite adapters — so a coach can sync into the
 * hosted warehouse or a local SQLite cache identically.
 */
export class CoachAthletePrStore extends OrgScopedStore {
  /**
   * Refresh the stored PR board for the roster (or a given subset). Each athlete's rows are
   * replaced atomically (a group per athlete, never split across a chunk), so a mid-run failure
   * never leaves a half-written board. Only families the athlete has logged get a row; never-logged
   * families are simply absent.
   */
  async sync(
    opts: { months?: number; athleteIds?: readonly number[]; now?: Date } = {},
  ): Promise<CoachPrSyncResult> {
    const org = await this.org();
    const board = await fetchRosterMainLiftPRs(this.client, {
      ...(opts.athleteIds ? { athleteIds: opts.athleteIds } : {}),
      ...(opts.months !== undefined ? { months: opts.months } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
    const syncedAt = Date.now();

    const groups: BatchStmt[][] = [];
    let rows = 0;
    for (const athlete of board) {
      const group: BatchStmt[] = [
        this.db
          .delete(coachAthletePr)
          .where(
            and(eq(coachAthletePr.orgId, org), eq(coachAthletePr.athleteId, athlete.athleteId)),
          ),
      ];
      for (const pr of athlete.prs) {
        // Store only families the athlete has logged (a resolved exercise); a never-logged family
        // is left out, so an absent row reads as "no PR yet" on the dashboard.
        if (pr.exerciseId === null) continue;
        group.push(
          this.db.insert(coachAthletePr).values({
            orgId: org,
            athleteId: athlete.athleteId,
            athleteName: athlete.athleteName,
            family: pr.family,
            label: pr.label,
            exerciseId: pr.exerciseId,
            exerciseTitle: pr.title,
            weight: pr.weight,
            reps: pr.reps,
            units: pr.units,
            date: pr.date,
            syncedAt,
          }),
        );
        rows += 1;
      }
      groups.push(group);
    }
    await this.runGroups(groups);

    await this.exec([
      this.db
        .insert(syncMeta)
        .values({ orgId: org, key: SYNCED_AT_KEY, value: String(syncedAt) })
        .onConflictDoUpdate({
          target: [syncMeta.orgId, syncMeta.key],
          set: { value: String(syncedAt) },
        }),
    ]);

    return { athletes: board.length, rows, syncedAt };
  }

  /** The stored PR board for the org, ordered by athlete then lift. */
  async read(): Promise<CoachAthletePrRow[]> {
    const org = await this.org();
    return this.db
      .select({
        athleteId: coachAthletePr.athleteId,
        athleteName: coachAthletePr.athleteName,
        family: coachAthletePr.family,
        label: coachAthletePr.label,
        exerciseId: coachAthletePr.exerciseId,
        exerciseTitle: coachAthletePr.exerciseTitle,
        weight: coachAthletePr.weight,
        reps: coachAthletePr.reps,
        units: coachAthletePr.units,
        date: coachAthletePr.date,
      })
      .from(coachAthletePr)
      .where(eq(coachAthletePr.orgId, org))
      .orderBy(asc(coachAthletePr.athleteName), asc(coachAthletePr.family));
  }

  /** Epoch ms of the last sync for this org, or null if never synced. */
  async lastSynced(): Promise<number | null> {
    const org = await this.org();
    const row = await this.db
      .select({ value: syncMeta.value })
      .from(syncMeta)
      .where(and(eq(syncMeta.orgId, org), eq(syncMeta.key, SYNCED_AT_KEY)))
      .get();
    const value = row?.value;
    return value === null || value === undefined ? null : Number(value);
  }
}
