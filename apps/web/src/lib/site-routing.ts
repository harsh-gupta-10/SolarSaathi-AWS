export type SiteRoute = { type: "rewrite" | "redirect"; pathname: string; origin?: string } | { type: "next" };
export function resolveSiteRoute(hostname: string, pathname: string): SiteRoute {
  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/") || pathname.startsWith("/auth/") || pathname.includes(".")) return { type: "next" };
  if (hostname === "solarsaathi.in" || hostname === "www.solarsaathi.in") {
    if (pathname === "/app" || pathname.startsWith("/app/")) {
      return { type: "redirect", origin: "https://app.solarsaathi.in", pathname: pathname.slice(4) || "/" };
    }
  }
  if (hostname === "app.solarsaathi.in") {
    if (pathname === "/app" || pathname.startsWith("/app/")) return { type: "redirect", origin: "https://app.solarsaathi.in", pathname: pathname.slice(4) || "/" };
    return { type: "rewrite", pathname: pathname === "/" ? "/app" : `/app${pathname}` };
  }
  return { type: "next" };
}
