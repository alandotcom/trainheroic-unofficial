/** Prefix an app-relative path with the Astro base (GitHub Pages subpath in CI). */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  const segment = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${segment}`;
}

/** Strip the Astro base from a URL pathname for route matching. */
export function sitePath(pathname: string): string {
  const base = import.meta.env.BASE_URL;
  if (base === "/") return pathname;
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  if (pathname === prefix || pathname === `${prefix}/`) return "/";
  if (pathname.startsWith(`${prefix}/`)) {
    return pathname.slice(prefix.length);
  }
  return pathname;
}
