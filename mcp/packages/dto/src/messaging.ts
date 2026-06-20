import { z } from "zod";
import { idSchema } from "./common";

/** A chat comment to draft or send: target stream, body text, optional threaded reply. */
export const commentDraftSchema = z.object({
  streamId: idSchema,
  text: z.string().min(1),
  replyTo: idSchema.optional(),
});
export type CommentDraft = z.infer<typeof commentDraftSchema>;
