import { z } from "zod";

/** An entity id as it arrives over the wire — a number or a numeric string. */
export const idSchema = z.union([z.string(), z.number()]);
export type Id = z.infer<typeof idSchema>;

/**
 * An id as a tool argument: a number, or a string of digits. Unlike idSchema (which
 * tolerates whatever the API sends back), this rejects non-numeric strings up front so
 * a bad argument fails validation instead of becoming NaN in a URL or a query.
 */
export const idArgSchema = z.union([z.number().int(), z.string().regex(/^\d+$/u)]);
