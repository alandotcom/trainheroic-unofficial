// Raw-text import of a `.sql` migration file. Vitest/Vite and tsdown/rolldown both honour the
// `?raw` suffix; this declaration lets `tsc` type the import as a string. The migration files are
// the single source of truth (shared with wrangler, which applies them to D1); `migrations.ts`
// imports them so the local node:sqlite runner ships the identical DDL embedded in the bundle.
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
