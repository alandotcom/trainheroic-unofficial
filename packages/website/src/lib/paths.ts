import { relative } from "node:path";

/** Root-relative app path (always starts with /). */
export function appPath(segment: string): string {
  if (segment === "" || segment === ".") return "/";
  return `/${segment.replace(/^\//, "")}`;
}

/** Prefix an app-relative path with the Astro base (GitHub Pages subpath in CI). */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  const segment = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${segment}`;
}

/**
 * Pathname relative to the current page — used when base is `./` (dual-host builds).
 * Prefer withBase when CI sets an absolute ASTRO_BASE.
 */
export function relativeHref(targetPath: string, fromPathname: string): string {
  const to = appPath(targetPath);
  const fromDir = fromPathname.endsWith("/") ? fromPathname : `${fromPathname}/`;
  const href = relative(fromDir, to);
  return href === "" ? "." : href;
}

/** Strip the Astro base from a URL pathname for route matching. */
export function sitePath(pathname: string): string {
  const base = import.meta.env.BASE_URL;
  if (base === "/" || base === "./") return pathname;
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  if (pathname === prefix || pathname === `${prefix}/`) return "/";
  if (pathname.startsWith(`${prefix}/`)) {
    return pathname.slice(prefix.length);
  }
  return pathname;
}

/** Internal link href for the current build (subpath base vs root). */
export function pageHref(targetPath: string, fromPathname: string): string {
  const base = import.meta.env.BASE_URL;
  if (base === "./") return relativeHref(targetPath, fromPathname);
  return withBase(targetPath);
}
