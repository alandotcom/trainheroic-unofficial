import { z } from "zod";

/** Fields merged onto the program object for `POST /1.0/coach/team/updatePublishSettings`. */
export const teamPublishPatchObject = z.object({
  pub_enabled: z.union([z.number(), z.boolean()]).optional(),
  pub_days: z.unknown().optional(),
  pub_time: z.unknown().optional(),
  pub_timezone: z.string().optional(),
});
export const teamPublishPatchSchema = teamPublishPatchObject.refine(
  (v) =>
    v.pub_enabled !== undefined ||
    v.pub_days !== undefined ||
    v.pub_time !== undefined ||
    v.pub_timezone !== undefined,
  { message: "Provide at least one pub_* field" },
);
export type TeamPublishPatch = z.infer<typeof teamPublishPatchSchema>;
