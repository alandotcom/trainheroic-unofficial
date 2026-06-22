// Small runtime-agnostic helpers shared across the SDK and its consumers.

/**
 * Drop the keys whose value is `undefined`, so the result can be passed to a function or
 * spread into an object under `exactOptionalPropertyTypes` without the per-key
 * `...(x !== undefined ? { x } : {})` dance. Required keys stay required in the result type;
 * optional ones lose `undefined` from their value type.
 *
 * Example:
 *   definedProps({ metric, teamId: maybeId, date })  // omits teamId/date if they're undefined
 */
export function definedProps<T extends object>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result as { [K in keyof T]: Exclude<T[K], undefined> };
}
