const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_DATE_WINDOWS = 100;

export type DateWindow = { start: string; end: string };

function dayNumber(value: string): number | null {
  if (!ISO_DAY.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    return null;
  }
  return timestamp / DAY_MS;
}

function isoDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Number of calendar days in an inclusive ISO-date range, or null for an invalid range. */
export function dateSpanDays(start: string, end: string): number | null {
  const first = dayNumber(start);
  const last = dayNumber(end);
  return first === null || last === null || first > last ? null : last - first + 1;
}

/** Split an inclusive ISO-date range into at most 100 ordered, non-overlapping windows. */
export function splitDateRange(start: string, end: string, maxDays: number): DateWindow[] | null {
  const first = dayNumber(start);
  const last = dayNumber(end);
  if (first === null || last === null || first > last) return null;
  if (!Number.isSafeInteger(maxDays) || maxDays < 1) {
    throw new RangeError("maxDays must be a positive integer.");
  }
  const windowCount = Math.ceil((last - first + 1) / maxDays);
  if (windowCount > MAX_DATE_WINDOWS) {
    throw new RangeError(
      `Date range is limited to ${MAX_DATE_WINDOWS} windows; narrow the range or increase the window size.`,
    );
  }

  const windows: DateWindow[] = [];
  for (let cursor = first; cursor <= last; cursor += maxDays) {
    windows.push({ start: isoDay(cursor), end: isoDay(Math.min(cursor + maxDays - 1, last)) });
  }
  return windows;
}
