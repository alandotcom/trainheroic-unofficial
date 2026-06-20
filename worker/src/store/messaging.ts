import { fetchStreams } from "../messaging/send";
import { OrgScopedStore } from "./base";
import { cursorUpsertStmt, runBatches } from "./d1";
import { coerceInt, isRecord } from "./exercise-util";

export type StreamSyncResult = {
  stream: number;
  title: string;
  kind: string;
  new: number;
  error?: string;
};

/** Messaging zone: conversations (streams) + comments. Incremental, accumulate-only. */
export class MessagingStore extends OrgScopedStore {
  async listStreams(): Promise<Array<{ stream: Record<string, unknown>; kind: string }>> {
    return fetchStreams(this.client);
  }

  #upsertStreamStmt(
    org: number,
    sid: number,
    kind: string,
    s: Record<string, unknown>,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        "INSERT INTO message_stream (org_id, id, kind, title, team_id, user_id, last_viewed, raw, source) " +
          "VALUES (?,?,?,?,?,?,?,?,'api') ON CONFLICT(org_id, id) DO UPDATE SET " +
          "kind=excluded.kind, title=excluded.title, team_id=excluded.team_id, " +
          "user_id=excluded.user_id, last_viewed=excluded.last_viewed, raw=excluded.raw",
      )
      .bind(
        org,
        sid,
        kind,
        String(s.title ?? ""),
        coerceInt(s.teamId),
        coerceInt(s.userId),
        coerceInt(s.lastViewed),
        JSON.stringify(s),
      );
  }

  #commentStatements(
    org: number,
    streamId: number,
    c: Record<string, unknown>,
    parentId: number | null,
    stmts: D1PreparedStatement[],
  ): number {
    const cid = coerceInt(c.id);
    if (cid === null) return 0;
    stmts.push(
      this.db
        .prepare(
          "INSERT INTO message_comment (org_id, id, stream_id, ts, content, author_name, author_logo, " +
            "image_url, is_author, parent_id, reactions, raw, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'api') " +
            "ON CONFLICT(org_id, id) DO UPDATE SET ts=excluded.ts, content=excluded.content, " +
            "author_name=excluded.author_name, author_logo=excluded.author_logo, image_url=excluded.image_url, " +
            "is_author=excluded.is_author, parent_id=excluded.parent_id, reactions=excluded.reactions, raw=excluded.raw",
        )
        .bind(
          org,
          cid,
          streamId,
          coerceInt(c.timestamp),
          String(c.content ?? ""),
          String(c.authorName ?? ""),
          String(c.authorLogo ?? ""),
          c.imageUrl === undefined ? null : String(c.imageUrl),
          c.isAuthor ? 1 : 0,
          parentId,
          JSON.stringify(c.reactions ?? []),
          JSON.stringify(c),
        ),
    );
    let high = cid;
    const replies = Array.isArray(c.replies) ? c.replies.filter(isRecord) : [];
    for (const reply of replies) {
      high = Math.max(high, this.#commentStatements(org, streamId, reply, cid, stmts));
    }
    return high;
  }

  async #cursor(org: number, sid: number): Promise<string> {
    const row = await this.db
      .prepare(
        "SELECT cursor FROM sync_state WHERE org_id=? AND resource='messaging' AND scope_id=?",
      )
      .bind(org, sid)
      .first<{ cursor: string | null }>();
    return row?.cursor ?? "";
  }

  async syncStream(
    s: Record<string, unknown>,
    kind: string,
    full = false,
  ): Promise<StreamSyncResult> {
    const org = await this.org();
    const sid = coerceInt(s.id) ?? 0;
    const title = String(s.title ?? "");
    const stmts: D1PreparedStatement[] = [this.#upsertStreamStmt(org, sid, kind, s)];

    const cursor = full ? "" : await this.#cursor(org, sid);
    const res = await this.client.request<unknown>(
      "GET",
      `/v5/messaging/streams/${sid}/comments?lastCommentId=${encodeURIComponent(cursor)}`,
    );
    if (!res.ok || !Array.isArray(res.data)) {
      await runBatches(this.db, stmts);
      return { stream: sid, title, kind, new: 0, error: `HTTP ${res.status}` };
    }

    let high = coerceInt(cursor) ?? 0;
    let count = 0;
    for (const c of res.data) {
      if (!isRecord(c)) continue;
      high = Math.max(high, this.#commentStatements(org, sid, c, null, stmts));
      count += 1;
    }
    if (high > 0) {
      stmts.push(cursorUpsertStmt(this.db, org, "messaging", sid, { cursor: String(high) }));
    }
    await runBatches(this.db, stmts);
    return { stream: sid, title, kind, new: count };
  }

  async syncAll(full = false): Promise<StreamSyncResult[]> {
    const streams = await this.listStreams();
    const out: StreamSyncResult[] = [];
    for (const { stream, kind } of streams) {
      try {
        out.push(await this.syncStream(stream, kind, full));
      } catch (err) {
        out.push({
          stream: coerceInt(stream.id) ?? 0,
          title: String(stream.title ?? ""),
          kind,
          new: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return out;
  }

  /** Write-through one comment after a send, so the store reflects it without a re-sync. */
  async recordComment(streamId: number, comment: Record<string, unknown>): Promise<void> {
    const org = await this.org();
    const stmts: D1PreparedStatement[] = [];
    this.#commentStatements(org, streamId, comment, null, stmts);
    if (stmts.length > 0) await runBatches(this.db, stmts);
  }

  async streams(): Promise<unknown[]> {
    const org = await this.org();
    const res = await this.db
      .prepare(
        "SELECT id, kind, title, team_id, user_id, last_viewed FROM message_stream WHERE org_id=? ORDER BY last_viewed DESC",
      )
      .bind(org)
      .all();
    return res.results;
  }

  async history(streamId: number, limit = 50): Promise<unknown[]> {
    const org = await this.org();
    const res = await this.db
      .prepare(
        "SELECT id, ts, content, author_name, is_author, parent_id, reactions FROM message_comment " +
          "WHERE org_id=? AND stream_id=? ORDER BY ts DESC, id DESC LIMIT ?",
      )
      .bind(org, streamId, limit)
      .all<Record<string, unknown>>();
    return res.results.map((row) => ({ ...row, reactions: safeParse(row.reactions) }));
  }
}

function safeParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
