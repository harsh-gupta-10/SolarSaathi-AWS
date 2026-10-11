"use client";

import { useEffect, useRef } from "react";

/** Scrolls a newly shown section into view and moves focus to it, so the next thing to read is never off-screen. */
export function revealElement(element: HTMLElement | null) {
  if (!element) return;
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof element.scrollIntoView === "function") element.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  focusHeading(element);
}

/** Moves focus to the first heading inside `container` (or the container itself) without scrolling. */
export function focusHeading(container: HTMLElement | null) {
  if (!container) return;
  // Never pull focus out of a field the user has already started using.
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable='true']")) return;
  const target = container.querySelector<HTMLElement>("h2, h3, h4") ?? (container.matches("[tabindex]") ? container : null);
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/** Reveals the referenced element each time `token` changes to a new defined value (e.g. a response request ID). */
export function useRevealOnChange<T extends HTMLElement>(token: string | number | undefined) {
  const ref = useRef<T>(null);
  const previous = useRef(token);
  useEffect(() => {
    if (token === undefined || token === previous.current) { previous.current = token; return; }
    previous.current = token;
    // Wait a frame so the newly rendered content has its final layout.
    const frame = requestAnimationFrame(() => revealElement(ref.current));
    return () => cancelAnimationFrame(frame);
  }, [token]);
  return ref;
}
