// Serialize an athlete's workout history to a downloadable file in one of three formats. Pure and
// runtime-agnostic (no `node:*`), so the CLI, the hosted worker, and the static website all share
// one implementation. CSV and JSON carry the structured numeric sets (reps/weight broken out);
// text uses the readable `"5 @ 225"` form. Input is the structured export from
// `presentAthleteWorkoutsExport`.

import type { ExportSetSide, WorkoutHistoryExport } from "@trainheroic-unofficial/dto";

export type WorkoutExportFormat = "json" | "csv" | "text";

/** A serialized export ready to write to a file or hand to a browser download. */
export type SerializedExport = {
  content: string;
  contentType: string;
  extension: string;
  filename: string;
};

const DEFAULT_FILENAME_BASE = "trainheroic-workout-history";

// --- JSON ---

/** Pretty-printed JSON of the structured workouts, exactly as `presentAthleteWorkoutsExport` yields. */
export function workoutsToJson(workouts: readonly WorkoutHistoryExport[]): string {
  return JSON.stringify(workouts, null, 2);
}

// --- CSV ---

const CSV_HEADER = [
  "date",
  "program",
  "team",
  "workout",
  "block",
  "exercise",
  "set",
  "prescribed_reps",
  "prescribed_weight",
  "performed_reps",
  "performed_weight",
  "weight_unit",
  "prescribed",
  "performed",
] as const;

/**
 * Format a CSV cell. Numbers pass through verbatim. For strings: neutralize spreadsheet formula
 * injection first — a text cell that opens with `=`, `+`, `-`, `@`, tab, or CR is prefixed with a
 * single quote so Excel/Sheets treat a coach-authored title like `=HYPERLINK(...)` as text, not a
 * formula — then quote (and double internal quotes) when the value holds a comma, quote, or newline.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const guarded = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /["\n\r,]/u.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded;
}

/**
 * One row per set. `reps`/`weight` columns hold the broken-out numeric values for the common
 * lifting case; the trailing `prescribed`/`performed` columns hold the raw `"p1 @ p2"` display so a
 * time, distance, or percentage exercise (where the reps/weight columns are blank) loses nothing.
 */
export function workoutsToCsv(workouts: readonly WorkoutHistoryExport[]): string {
  const rows: string[] = [CSV_HEADER.join(",")];
  for (const w of workouts) {
    for (const block of w.blocks) {
      for (const ex of block.exercises) {
        for (const set of ex.sets) {
          const p = set.prescribed;
          const q = set.performed;
          rows.push(
            [
              w.date,
              w.program,
              w.team,
              w.title,
              block.title,
              ex.title,
              set.set,
              p?.reps,
              p?.weight,
              q?.reps,
              q?.weight,
              q?.weightUnit ?? p?.weightUnit,
              p?.display,
              q?.display,
            ]
              .map(csvCell)
              .join(","),
          );
        }
      }
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}

// --- Text ---

/** The set of unit labels an exercise uses, e.g. `"reps, lb"`. */
function unitsLabel(units: Array<string | null>): string {
  const named = units.filter((u): u is string => u !== null);
  return named.length > 0 ? ` (${named.join(", ")})` : "";
}

function sideText(side: ExportSetSide | null): string {
  return side && side.display !== "" ? side.display : "—";
}

/** A readable, indented rendering — one athlete-friendly block of text per session. */
export function workoutsToText(workouts: readonly WorkoutHistoryExport[]): string {
  const count = `${workouts.length} session${workouts.length === 1 ? "" : "s"}`;
  const lines: string[] = ["# TrainHeroic workout history", `# ${count}`, ""];
  for (const w of workouts) {
    lines.push(`${w.date}  ${w.title || "(untitled)"}`);
    const scope = [w.program && `Program: ${w.program}`, w.team && `Team: ${w.team}`].filter(
      Boolean,
    );
    if (scope.length > 0) lines.push(scope.join(" · "));
    if (w.personal) lines.push("(personal session)");
    for (const block of w.blocks) {
      if (block.exercises.length === 0) continue;
      if (block.title) lines.push(`  ${block.title}`);
      for (const ex of block.exercises) {
        lines.push(`    ${ex.title || "(exercise)"}${unitsLabel(ex.units)}`);
        for (const set of ex.sets) {
          const done = sideText(set.performed);
          const planned = set.prescribed ? `   (planned ${sideText(set.prescribed)})` : "";
          lines.push(`      set ${set.set}  ${done}${planned}`);
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

// --- Dispatch ---

const FORMAT_META: Record<WorkoutExportFormat, { contentType: string; extension: string }> = {
  json: { contentType: "application/json", extension: "json" },
  csv: { contentType: "text/csv", extension: "csv" },
  text: { contentType: "text/plain", extension: "txt" },
};

/** Serialize the workout history to the chosen format, with content-type and a suggested filename. */
export function serializeWorkoutHistory(
  workouts: readonly WorkoutHistoryExport[],
  format: WorkoutExportFormat,
  opts: { filenameBase?: string } = {},
): SerializedExport {
  const meta = FORMAT_META[format];
  const content =
    format === "json"
      ? workoutsToJson(workouts)
      : format === "csv"
        ? workoutsToCsv(workouts)
        : workoutsToText(workouts);
  const base = opts.filenameBase ?? DEFAULT_FILENAME_BASE;
  return {
    content,
    contentType: meta.contentType,
    extension: meta.extension,
    filename: `${base}.${meta.extension}`,
  };
}
