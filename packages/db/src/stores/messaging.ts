import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { chunk, coerceInt, fetchStreams, isRecord } from "@trainheroic-unofficial/js";
import { OrgScopedStore } from "../base";
import { type BatchStmt, cursorUpsertStmt } from "../runner";
import { messageComment, messageStream, syncState } from "../schema";

// org_id and resource consume two of D1's 100 bound parameters.
const CURSOR_QUERY_IDS = 98;
// The expanded comment upsert shape requires a conservative seven-row D1 parameter bound.
const COMMENT_WRITE_ROWS = 7;

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

  #upsertStreamStmt(org: number, sid: number, kind: string, s: Record<string, unknown>): BatchStmt {
    return this.db
      .insert(messageStream)
      .values({
        orgId: org,
        id: sid,
        kind,
        title: String(s.title ?? ""),
        teamId: coerceInt(s.teamId),
        userId: coerceInt(s.userId),
        lastViewed: coerceInt(s.lastViewed),
        raw: JSON.stringify(s),
      })
      .onConflictDoUpdate({
        target: [messageStream.orgId, messageStream.id],
        set: {
          kind: sql`excluded.kind`,
          title: sql`excluded.title`,
          teamId: sql`excluded.team_id`,
          userId: sql`excluded.user_id`,
          lastViewed: sql`excluded.last_viewed`,
          raw: sql`excluded.raw`,
        },
      });
  }

  #commentRows(
    org: number,
    streamId: number,
    c: Record<string, unknown>,
    parentId: number | null,
    rows: Array<typeof messageComment.$inferInsert>,
  ): void {
    const cid = coerceInt(c.id);
    if (cid === null) return;
    rows.push({
      orgId: org,
      id: cid,
      streamId,
      ts: coerceInt(c.timestamp),
      content: String(c.content ?? ""),
      authorName: String(c.authorName ?? ""),
      authorLogo: String(c.authorLogo ?? ""),
      imageUrl: c.imageUrl === undefined ? null : String(c.imageUrl),
      isAuthor: c.isAuthor ? 1 : 0,
      parentId,
      reactions: JSON.stringify(c.reactions ?? []),
      raw: JSON.stringify(c),
    });
    const replies = Array.isArray(c.replies) ? c.replies.filter(isRecord) : [];
    for (const reply of replies) {
      this.#commentRows(org, streamId, reply, cid, rows);
    }
  }

  async #cursors(org: number, streamIds: readonly number[]): Promise<Map<number, string>> {
    const cursors = new Map<number, string>();
    for (const ids of chunk([...new Set(streamIds)], CURSOR_QUERY_IDS)) {
      const rows = await this.db
        .select({ streamId: syncState.scopeId, cursor: syncState.cursor })
        .from(syncState)
        .where(
          and(
            eq(syncState.orgId, org),
            eq(syncState.resource, "messaging"),
            inArray(syncState.scopeId, ids),
          ),
        );
      for (const row of rows) cursors.set(row.streamId, row.cursor ?? "");
    }
    return cursors;
  }

  async #syncStream(
    org: number,
    s: Record<string, unknown>,
    kind: string,
    cursor: string,
  ): Promise<StreamSyncResult> {
    const sid = coerceInt(s.id) ?? 0;
    const title = String(s.title ?? "");
    const stmts: BatchStmt[] = [this.#upsertStreamStmt(org, sid, kind, s)];

    const res = await this.client.request<unknown>(
      "GET",
      `/v5/messaging/streams/${sid}/comments?lastCommentId=${encodeURIComponent(cursor)}`,
    );
    if (!res.ok || !Array.isArray(res.data)) {
      await this.runBatches(stmts);
      const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
      return {
        stream: sid,
        title,
        kind,
        new: 0,
        error: `HTTP ${res.status}: ${detail.slice(0, 200)}`,
      };
    }

    // Advance the cursor on top-level comment id only — that is what lastCommentId
    // paginates on. Replies are still stored, but a reply added to an already-synced
    // comment won't re-surface it, so refreshing reactions/replies needs full=true.
    let high = coerceInt(cursor) ?? 0;
    let count = 0;
    const commentRows: Array<typeof messageComment.$inferInsert> = [];
    for (const c of res.data) {
      if (!isRecord(c)) continue;
      const cid = coerceInt(c.id);
      if (cid !== null) high = Math.max(high, cid);
      this.#commentRows(org, sid, c, null, commentRows);
      count += 1;
    }
    for (const values of chunk(commentRows, COMMENT_WRITE_ROWS)) {
      stmts.push(
        this.db
          .insert(messageComment)
          .values(values)
          .onConflictDoUpdate({
            target: [messageComment.orgId, messageComment.id],
            set: {
              ts: sql`excluded.ts`,
              content: sql`excluded.content`,
              authorName: sql`excluded.author_name`,
              authorLogo: sql`excluded.author_logo`,
              imageUrl: sql`excluded.image_url`,
              isAuthor: sql`excluded.is_author`,
              parentId: sql`excluded.parent_id`,
              reactions: sql`excluded.reactions`,
              raw: sql`excluded.raw`,
            },
          }),
      );
    }
    if (high > 0) {
      stmts.push(cursorUpsertStmt(this.db, org, "messaging", sid, { cursor: String(high) }));
    }
    await this.runBatches(stmts);
    return { stream: sid, title, kind, new: count };
  }

  async syncStream(
    s: Record<string, unknown>,
    kind: string,
    full = false,
  ): Promise<StreamSyncResult> {
    const org = await this.org();
    const sid = coerceInt(s.id) ?? 0;
    const cursors = full ? new Map<number, string>() : await this.#cursors(org, [sid]);
    return this.#syncStream(org, s, kind, cursors.get(sid) ?? "");
  }

  async syncAll(full = false): Promise<StreamSyncResult[]> {
    const org = await this.org();
    const streams = await this.listStreams();
    const streamIds = streams.map(({ stream }) => coerceInt(stream.id) ?? 0);
    const cursors = full ? new Map<number, string>() : await this.#cursors(org, streamIds);
    const out: StreamSyncResult[] = [];
    for (const { stream, kind } of streams) {
      try {
        const sid = coerceInt(stream.id) ?? 0;
        out.push(await this.#syncStream(org, stream, kind, cursors.get(sid) ?? ""));
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

  async streams(): Promise<unknown[]> {
    const org = await this.org();
    return this.db
      .select({
        id: messageStream.id,
        kind: messageStream.kind,
        title: messageStream.title,
        team_id: messageStream.teamId,
        user_id: messageStream.userId,
        last_viewed: messageStream.lastViewed,
      })
      .from(messageStream)
      .where(eq(messageStream.orgId, org))
      .orderBy(desc(messageStream.lastViewed));
  }

  async history(streamId: number, limit = 50): Promise<unknown[]> {
    const org = await this.org();
    const rows = await this.db
      .select({
        id: messageComment.id,
        ts: messageComment.ts,
        content: messageComment.content,
        author_name: messageComment.authorName,
        is_author: messageComment.isAuthor,
        parent_id: messageComment.parentId,
        reactions: messageComment.reactions,
      })
      .from(messageComment)
      .where(and(eq(messageComment.orgId, org), eq(messageComment.streamId, streamId)))
      .orderBy(desc(messageComment.ts), desc(messageComment.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, reactions: safeParse(row.reactions) }));
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
