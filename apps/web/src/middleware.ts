import { NextResponse, type NextRequest } from "next/server";
import { resolveSiteRoute } from "./lib/site-routing";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host")?.toLowerCase().replace(/:\d+$/, "") ?? request.nextUrl.hostname;
  const route = resolveSiteRoute(hostname, request.nextUrl.pathname);
  if (route.type === "next") return NextResponse.next();
  const url = route.origin ? new URL(route.pathname, route.origin) : request.nextUrl.clone();
  url.pathname = route.pathname;
  url.search = request.nextUrl.search;
  return route.type === "rewrite" ? NextResponse.rewrite(url) : NextResponse.redirect(url);
}
export const config = { matcher: ["/((?!_next|favicon.ico|robots.txt|sitemap.xml).*)"] };
