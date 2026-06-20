import { z } from "zod";

/** An entity id as it arrives over the wire — a number or a numeric string. */
export const idSchema = z.union([z.string(), z.number()]);
export type Id = z.infer<typeof idSchema>;
