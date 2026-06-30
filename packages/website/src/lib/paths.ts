import { relative } from "node:path";

/** Root-relative app path (always starts with /). */
export function appPath(segment: string): string {
  if (segment === "" || segment === ".") return "/";
  return `/${segment.replace(/^\//, "")}`;
}

/**
 * Pathname relative to the current page so links work on both the custom domain
 * and the github.io project subpath from a single static build.
 */
export function relativeHref(targetPath: string, fromPathname: string): string {
  const to = appPath(targetPath);
  const fromDir = fromPathname.endsWith("/") ? fromPathname : `${fromPathname}/`;
  const href = relative(fromDir, to);
  return href === "" ? "." : href;
}

/** Normalize Astro.url.pathname for route matching (strip trailing slash). */
export function sitePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}
