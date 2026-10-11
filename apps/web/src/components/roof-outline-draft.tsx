"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { decodeRoofOutline, encodeRoofOutline, type RoofOutline } from "@solarsaathi/calculations";
import { AnalysisDraftProvider, useAnalysisDraft } from "../lib/analysis-draft";

/**
 * One draft provider for the roof view and the steps after it, so the outline the user traced on the map is saved
 * with the same analysis draft (this device + account) as their sizing, cost and benefit answers.
 */
export function AnalysisDraftScope({ scope, children }: {
  scope?: { userId: string; propertyId: string; analysisId: string }; children: ReactNode;
}) {
  return scope ? <AnalysisDraftProvider {...scope}>{children}</AnalysisDraftProvider> : <>{children}</>;
}

/**
 * Keeps the traced outline and the analysis draft in step. When the draft first loads, an outline traced before the
 * roof was saved is written to it; otherwise a saved outline is restored. After that every change is written, and a
 * reset clears the saved value. The outline is a 3D-view aid only and never reaches sizing or benefit calculations.
 */
export function RoofOutlineDraftBridge({ outline, onRestore }: {
  outline: RoofOutline | undefined; onRestore: (outline: RoofOutline) => void;
}) {
  const draft = useAnalysisDraft();
  const started = useRef(false);
  const last = useRef("");
  const stored = draft?.draft.outline?.corners ?? "";
  const loaded = draft?.loaded ?? false;
  const setSection = draft?.setSection;
  useEffect(() => {
    if (!setSection || !loaded) return;
    const text = outline ? encodeRoofOutline(outline) : "";
    if (!started.current) {
      started.current = true;
      if (outline) { last.current = text; if (text !== stored) setSection("outline", { corners: text }); return; }
      const restored = decodeRoofOutline(stored);
      last.current = restored ? stored : "";
      if (restored) onRestore(restored);
      return;
    }
    if (text !== last.current) { last.current = text; if (text !== stored) setSection("outline", { corners: text }); }
  }, [loaded, outline, stored, setSection, onRestore]);
  return null;
}
