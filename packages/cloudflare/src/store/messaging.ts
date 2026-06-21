import { and, desc, eq, sql } from "drizzle-orm";
import { fetchStreams } from "@trainheroic-unofficial/js";
import { OrgScopedStore } from "./base";
import { type BatchStmt, cursorUpsertStmt, runBatches } from "./d1";
import { messageComment, messageStream, syncState } from "./schema";
import { coerceInt, isRecord } from "@trainheroic-unofficial/js";

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

  #commentStatements(
    org: number,
    streamId: number,
    c: Record<string, unknown>,
    parentId: number | null,
    stmts: BatchStmt[],
  ): void {
    const cid = coerceInt(c.id);
    if (cid === null) return;
    stmts.push(
      this.db
        .insert(messageComment)
        .values({
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
        })
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
    const replies = Array.isArray(c.replies) ? c.replies.filter(isRecord) : [];
    for (const reply of replies) {
      this.#commentStatements(org, streamId, reply, cid, stmts);
    }
  }

  async #cursor(org: number, sid: number): Promise<string> {
    const row = await this.db
      .select({ cursor: syncState.cursor })
      .from(syncState)
      .where(
        and(
          eq(syncState.orgId, org),
          eq(syncState.resource, "messaging"),
          eq(syncState.scopeId, sid),
        ),
      )
      .get();
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
    const stmts: BatchStmt[] = [this.#upsertStreamStmt(org, sid, kind, s)];

    const cursor = full ? "" : await this.#cursor(org, sid);
    const res = await this.client.request<unknown>(
      "GET",
      `/v5/messaging/streams/${sid}/comments?lastCommentId=${encodeURIComponent(cursor)}`,
    );
    if (!res.ok || !Array.isArray(res.data)) {
      await runBatches(this.db, stmts);
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
    for (const c of res.data) {
      if (!isRecord(c)) continue;
      const cid = coerceInt(c.id);
      if (cid !== null) high = Math.max(high, cid);
      this.#commentStatements(org, sid, c, null, stmts);
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
