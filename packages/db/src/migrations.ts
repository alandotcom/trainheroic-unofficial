// The ordered migration list, embedded from the `.sql` files in `../migrations` (the single source
// of truth, shared with wrangler's D1 `migrations_dir`). Embedding them as strings — rather than
// reading the directory at runtime — means the DDL travels inside the bundle, so a local tool that
// updates to a new version of this package automatically carries the new migrations and the
// node:sqlite runner ({@link applyMigrations}) applies whatever is pending.
//
// Adding a migration: drop a `NNNN_name.sql` file in `../migrations` and append one import + entry
// here, in numeric order. The name MUST match the filename stem so the applied-set tracking lines
// up across the D1 and local runners.
import m0001 from "../migrations/0001_init.sql?raw";
import m0002 from "../migrations/0002_warehouse.sql?raw";
import m0003 from "../migrations/0003_athlete.sql?raw";
import m0004 from "../migrations/0004_athlete_performed.sql?raw";
import m0005 from "../migrations/0005_coach_athlete_pr.sql?raw";

/** One migration: a stable name (the filename stem) and its SQL. Applied in array order. */
export type Migration = { name: string; sql: string };

export const MIGRATIONS: readonly Migration[] = [
  { name: "0001_init", sql: m0001 },
  { name: "0002_warehouse", sql: m0002 },
  { name: "0003_athlete", sql: m0003 },
  { name: "0004_athlete_performed", sql: m0004 },
  { name: "0005_coach_athlete_pr", sql: m0005 },
];
