const KEY = "solarsaathi.pendingQuestion";

/** A question typed on the marketing page, carried through sign-in into the first chat turn (this tab only). */
export function rememberPendingQuestion(question: string): void {
  const trimmed = question.trim().slice(0, 2000);
  try { if (trimmed) sessionStorage.setItem(KEY, trimmed); } catch { /* sessionStorage blocked */ }
}

export function consumePendingQuestion(): string | undefined {
  try {
    const value = sessionStorage.getItem(KEY) ?? undefined;
    sessionStorage.removeItem(KEY);
    return value || undefined;
  } catch { return undefined; }
}
