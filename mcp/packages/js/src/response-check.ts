import type { ZodType } from "zod";

/**
 * Validate an API response against its (loose) expected shape and warn once on drift.
 * Never throws: callers keep working via defensive coercion. This only surfaces a signal
 * when TrainHeroic renames or drops a field we read.
 */
export function checkResponse(schema: ZodType, data: unknown, label: string): void {
  const result = schema.safeParse(data);
  if (result.success) return;
  const issue = result.error.issues[0];
  const where = issue && issue.path.length > 0 ? issue.path.join(".") : "(root)";
  console.warn(
    `[trainheroic] response drift in ${label} at ${where}: ${issue?.message ?? "shape mismatch"}`,
  );
}
