// The neutral core of the warehouse package: the shared Drizzle schema, the tenant-scoped store
// base classes, the atomic-batch write helpers, and the concrete stores. No driver import lives
// here — a runtime builds a {@link Warehouse} via the `./d1` (Cloudflare) or `./sqlite` (local
// node:sqlite) adapter and constructs stores from it, so every store body runs on both.
export * from "./schema";
export * from "./runner";
export * from "./base";
export * from "./stores/exercises";
export * from "./stores/programming";
export * from "./stores/messaging";
export * from "./stores/athlete-workouts";
export * from "./stores/athlete-training";
export * from "./stores/coach-prs";
