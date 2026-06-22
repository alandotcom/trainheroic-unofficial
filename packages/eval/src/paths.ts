import { join, resolve } from "node:path";

// import.meta.dirname is packages/eval/src; the repo root is three levels up.
export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** A package's hoisted tsx binary — used to run a server/CLI entry directly, no pnpm overhead. */
export function tsxBin(pkg: string): string {
  return join(REPO_ROOT, "packages", pkg, "node_modules/.bin/tsx");
}

export function pkgEntry(pkg: string, rel: string): string {
  return join(REPO_ROOT, "packages", pkg, rel);
}
