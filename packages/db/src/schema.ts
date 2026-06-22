// Drizzle schema for the warehouse. This is a typed mirror of the hand-written SQL in
// `packages/cloudflare/migrations/` — it is NOT the source of truth for the live D1 database.
// Migrations stay hand-written and are applied with `wrangler d1 migrations apply`; this file
// exists so the store query builders are type-checked against the real column shapes (verifiable
// with `drizzle-kit check`, see packages/cloudflare/drizzle.config.ts, which points here). The
// local node:sqlite adapter derives its `CREATE TABLE` DDL from the same column shapes.
//
// Column types deliberately mirror the SQLite affinities 1:1 (flags stay `integer` 0/1, JSON
// blobs stay `text`) so the query behaviour is identical on D1 and node:sqlite. There is no
// driver import here (no `drizzle-orm/d1`, no `@sentry/cloudflare`): the handle is built by the
// adapter entry points (`./d1`, `./sqlite`), so this core stays runtime-neutral.
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { customType, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// A REAL column that may hold free-text. Prescribed slot values are numeric when possible but
// fall back to the raw string ("AMRAP", "8-12", "max"); SQLite's REAL affinity stores such
// non-numeric text as text, and the store relies on that. `real()` alone would type inserts as
// `number`, rejecting those strings — so model the loose affinity explicitly.
const looseReal = customType<{ data: number | string | null; driverData: number | string | null }>({
  dataType: () => "real",
});

// -- reference + meta (org-scoped) ------------------------------------------

export const account = sqliteTable("account", {
  thUserId: integer("th_user_id").primaryKey(),
  orgId: integer("org_id"),
  email: text("email"),
  role: text("role"),
  createdAt: integer("created_at"),
  lastSeen: integer("last_seen"),
});

export const syncMeta = sqliteTable(
  "sync_meta",
  {
    orgId: integer("org_id").notNull(),
    key: text("key").notNull(),
    value: text("value"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

export const syncState = sqliteTable(
  "sync_state",
  {
    orgId: integer("org_id").notNull(),
    resource: text("resource").notNull(),
    scopeId: integer("scope_id").notNull().default(0),
    cursor: text("cursor"),
    syncedAt: integer("synced_at"),
    generation: integer("generation"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.resource, t.scopeId] })],
);

export const exercise = sqliteTable(
  "exercise",
  {
    orgId: integer("org_id").notNull(),
    id: integer("id").notNull(),
    title: text("title").notNull(),
    searchText: text("search_text").notNull(),
    param1Type: integer("param_1_type"),
    param2Type: integer("param_2_type"),
    canEdit: integer("can_edit").notNull().default(0),
    userId: integer("user_id"),
    useCount: integer("use_count").notNull().default(0),
    raw: text("raw").notNull(),
    generation: integer("generation").notNull(),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

// -- programming warehouse (org-scoped) -------------------------------------

export const program = sqliteTable(
  "program",
  {
    orgId: integer("org_id").notNull(),
    id: integer("id").notNull(),
    title: text("title"),
    raw: text("raw"),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

export const programSession = sqliteTable(
  "program_session",
  {
    orgId: integer("org_id").notNull(),
    id: integer("id").notNull(),
    programId: integer("program_id"),
    dayIndex: integer("day_index"),
    date: text("date"),
    title: text("title"),
    published: integer("published").notNull().default(0),
    raw: text("raw"),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

export const block = sqliteTable(
  "block",
  {
    orgId: integer("org_id").notNull(),
    id: integer("id").notNull(),
    programSessionId: integer("program_session_id"),
    ord: integer("ord"),
    type: integer("type"),
    title: text("title"),
    instruction: text("instruction"),
    raw: text("raw"),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

// Implicit rowid PK (rebuilt per session on each sync), so no declared primary key.
export const prescribedSet = sqliteTable("prescribed_set", {
  orgId: integer("org_id").notNull(),
  blockId: integer("block_id").notNull(),
  exerciseId: integer("exercise_id"),
  setIndex: integer("set_index"),
  param1Type: integer("param_1_type"),
  param1Value: looseReal("param_1_value"),
  param2Type: integer("param_2_type"),
  param2Value: looseReal("param_2_value"),
  source: text("source").notNull().default("api"),
});

// -- messaging warehouse (org-scoped) ---------------------------------------

export const messageStream = sqliteTable(
  "message_stream",
  {
    orgId: integer("org_id").notNull(),
    id: integer("id").notNull(),
    kind: text("kind"),
    title: text("title"),
    teamId: integer("team_id"),
    userId: integer("user_id"),
    lastViewed: integer("last_viewed"),
    raw: text("raw"),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

export const messageComment = sqliteTable(
  "message_comment",
  {
    orgId: integer("org_id").notNull(),
    id: integer("id").notNull(),
    streamId: integer("stream_id"),
    ts: integer("ts"),
    content: text("content"),
    authorName: text("author_name"),
    authorLogo: text("author_logo"),
    imageUrl: text("image_url"),
    isAuthor: integer("is_author").notNull().default(0),
    parentId: integer("parent_id"),
    reactions: text("reactions"),
    raw: text("raw"),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.id] })],
);

// -- coach roster main-lift PRs (org-scoped) --------------------------------

// One row per (coach org, roster athlete, lift family): the athlete's best PR for that family,
// resolved from the lift variant they actually log. Rebuilt per athlete on each sync. A family
// the athlete has never logged is simply absent (no row), so the read side renders "no PR yet".
export const coachAthletePr = sqliteTable(
  "coach_athlete_pr",
  {
    orgId: integer("org_id").notNull(),
    athleteId: integer("athlete_id").notNull(),
    athleteName: text("athlete_name"),
    family: text("family").notNull(),
    label: text("label"),
    exerciseId: integer("exercise_id"),
    exerciseTitle: text("exercise_title"),
    weight: real("weight"),
    reps: integer("reps"),
    date: text("date"),
    units: text("units"),
    syncedAt: integer("synced_at"),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.athleteId, t.family] })],
);

// -- athlete warehouse (user-scoped) ----------------------------------------

export const athleteSyncState = sqliteTable(
  "athlete_sync_state",
  {
    userId: integer("user_id").notNull(),
    resource: text("resource").notNull(),
    scopeId: integer("scope_id").notNull().default(0),
    cursor: text("cursor"),
    syncedAt: integer("synced_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resource, t.scopeId] })],
);

export const athleteWorkout = sqliteTable(
  "athlete_workout",
  {
    userId: integer("user_id").notNull(),
    id: integer("id").notNull(),
    date: text("date"),
    title: text("title"),
    programId: integer("program_id"),
    programTitle: text("program_title"),
    teamId: integer("team_id"),
    teamTitle: text("team_title"),
    raw: text("raw"),
    source: text("source").notNull().default("api"),
    logged: integer("logged").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

// Implicit rowid PK (rebuilt per workout on each sync), so no declared primary key.
export const athleteWorkoutExercise = sqliteTable("athlete_workout_exercise", {
  userId: integer("user_id").notNull(),
  workoutId: integer("workout_id").notNull(),
  blockOrder: integer("block_order"),
  blockTitle: text("block_title"),
  isTest: integer("is_test").notNull().default(0),
  exerciseId: integer("exercise_id"),
  title: text("title"),
  units: text("units"),
  prescribed: text("prescribed"),
  instruction: text("instruction"),
  source: text("source").notNull().default("api"),
  performed: text("performed"),
});

export const athleteExercise = sqliteTable(
  "athlete_exercise",
  {
    userId: integer("user_id").notNull(),
    id: integer("id").notNull(),
    title: text("title").notNull(),
    searchText: text("search_text").notNull(),
    param1Type: integer("param_1_type"),
    param2Type: integer("param_2_type"),
    isCircuit: integer("is_circuit").notNull().default(0),
    raw: text("raw"),
    sessionsSyncedAt: integer("sessions_synced_at"),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

export const athleteExerciseSession = sqliteTable(
  "athlete_exercise_session",
  {
    userId: integer("user_id").notNull(),
    savedWorkoutSetExerciseId: integer("saved_workout_set_exercise_id").notNull(),
    exerciseId: integer("exercise_id").notNull(),
    date: text("date"),
    abr: text("abr"),
    bestEstimated1rm: real("best_estimated_1rm"),
    programWorkoutId: integer("program_workout_id"),
    teamId: integer("team_id"),
    raw: text("raw"),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.savedWorkoutSetExerciseId] })],
);

// Implicit rowid PK (rebuilt per exercise on each sync), so no declared primary key.
export const athletePr = sqliteTable("athlete_pr", {
  userId: integer("user_id").notNull(),
  exerciseId: integer("exercise_id").notNull(),
  description: text("description"),
  reps: integer("reps"),
  weight: real("weight"),
  units: text("units"),
  date: text("date"),
  savedWorkoutSetExerciseId: integer("saved_workout_set_exercise_id"),
  source: text("source").notNull().default("api"),
});

export const athleteWorkingMax = sqliteTable(
  "athlete_working_max",
  {
    userId: integer("user_id").notNull(),
    exerciseId: integer("exercise_id").notNull(),
    title: text("title"),
    paramType: integer("param_type"),
    value: real("value"),
    typeSuffix: text("type_suffix"),
    workingMaxId: integer("working_max_id"),
    raw: text("raw"),
    source: text("source").notNull().default("api"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.exerciseId] })],
);

export const schema = {
  account,
  syncMeta,
  syncState,
  exercise,
  program,
  programSession,
  block,
  prescribedSet,
  messageStream,
  messageComment,
  coachAthletePr,
  athleteSyncState,
  athleteWorkout,
  athleteWorkoutExercise,
  athleteExercise,
  athleteExerciseSession,
  athletePr,
  athleteWorkingMax,
};

/**
 * The dialect-level Drizzle handle the stores query against — generalized over the result kind
 * (`async` D1, `sync` node:sqlite) and run-result so one store body type-checks on both adapters.
 * Each adapter builds a concrete handle (`drizzle-orm/d1` or `drizzle-orm/node-sqlite`) and widens
 * it to this type. The only driver-specific operation — atomic batch — is injected separately as a
 * `BatchExec` (see `./runner`), so the stores never touch a driver-only method on this handle.
 */
export type DrizzleDb = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>;
