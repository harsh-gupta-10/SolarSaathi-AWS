const KEY = "solarsaathi.returnTo";

/** Accepts only same-origin app paths so a crafted link cannot redirect users off-site after sign-in. */
export function safeReturnTo(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return undefined;
  if (value.startsWith("/auth/")) return undefined;
  return value.length <= 300 ? value : undefined;
}

export function rememberReturnTo(value: string | null | undefined): void {
  const target = safeReturnTo(value);
  try { if (target) sessionStorage.setItem(KEY, target); } catch { /* sessionStorage blocked */ }
}

export function consumeReturnTo(fallback = "/app"): string {
  try {
    const stored = safeReturnTo(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
    return stored ?? fallback;
  } catch { return fallback; }
}

export function signInHref(returnTo?: string): string {
  const target = safeReturnTo(returnTo);
  return target ? `/auth/sign-in?returnTo=${encodeURIComponent(target)}` : "/auth/sign-in";
}
