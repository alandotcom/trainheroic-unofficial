import type { TrainHeroicClient } from "../trainheroic/client";

/**
 * The exact chat comment body the web app sends. The non-obvious required field is
 * `feed_id` (the stream id repeated in the body); omitting it returns 400.
 */
export function buildCommentPayload(
  streamId: number,
  text: string,
  replyTo: number | null = null,
): Record<string, unknown> {
  return {
    type: 0,
    content: text,
    photo_url: "",
    photoUrl: "",
    access_level: 0,
    parent_feed_item_id: replyTo,
    feed_id: streamId,
  };
}

export async function sendComment(
  client: TrainHeroicClient,
  streamId: number,
  text: string,
  replyTo: number | null = null,
): Promise<Record<string, unknown>> {
  const res = await client.request<Record<string, unknown>>(
    "POST",
    `/v5/messaging/streams/${streamId}/comments`,
    { body: buildCommentPayload(streamId, text, replyTo) },
  );
  if (!res.ok || typeof res.data !== "object" || res.data === null || res.data.id === undefined) {
    throw new Error(`Message send failed (HTTP ${res.status}).`);
  }
  return res.data;
}

export async function deleteComment(
  client: TrainHeroicClient,
  streamId: number,
  commentId: number,
): Promise<unknown> {
  const res = await client.request(
    "DELETE",
    `/v5/messaging/streams/${streamId}/comments/${commentId}`,
  );
  if (!res.ok) throw new Error(`Message delete failed (HTTP ${res.status}).`);
  return res.data;
}

export async function readLive(
  client: TrainHeroicClient,
  streamId: number,
  limit?: number,
): Promise<unknown[]> {
  const res = await client.request<unknown>(
    "GET",
    `/v5/messaging/streams/${streamId}/comments?lastCommentId=`,
  );
  if (!res.ok || !Array.isArray(res.data))
    throw new Error(`Message read failed (HTTP ${res.status}).`);
  return limit !== undefined && limit > 0 ? res.data.slice(-limit) : res.data;
}
