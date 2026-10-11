"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { draftsApi, type AnalysisDraft, type DraftSection } from "./drafts-api";
import { RoofRequestError } from "./roof-api";

/**
 * Keeps the raw answers of the sizing, cost and benefit steps for one saved analysis.
 * Every change is written to this browser at once and synced to the account (debounced), so answers survive tab
 * switches, edits to an earlier step, reloads and other devices. Drafts hold inputs only; results are always
 * recomputed by the backend. Local copies are cleared on sign-out (see clearStoredProperties).
 */
export const DRAFT_STORAGE_PREFIX = "solarsaathi.draft.v1";
const SAVE_DELAY_MS = 1_200;

export type DraftSaveState = "idle" | "saving" | "saved" | "local-only" | "rejected";
/** `savedAt` is the server's `updatedAt` when `synced`, so synced copies are only ever compared with server time. */
interface LocalCopy { draft: AnalysisDraft; savedAt: string; synced: boolean }
/** Server limits (apps/api/src/data/drafts.ts): ≤ 40 fields per section, ≤ 200 characters per value. */
const MAX_VALUE_LENGTH = 200;
const MAX_FIELDS = 40;

interface DraftContextValue {
  draft: AnalysisDraft;
  loaded: boolean;
  saveState: DraftSaveState;
  savedAt?: string;
  setSection: (section: DraftSection, values: Record<string, string>) => void;
  setStep: (step: number) => void;
}

const DraftContext = createContext<DraftContextValue | null>(null);
const empty = (): AnalysisDraft => ({ schemaVersion: 1 });

function storageKey(userId: string, propertyId: string, analysisId: string) {
  return `${DRAFT_STORAGE_PREFIX}.${userId}.${propertyId}.${analysisId}`;
}
function readLocal(key: string): LocalCopy | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as LocalCopy;
    return value && typeof value === "object" && value.draft?.schemaVersion === 1 && typeof value.savedAt === "string" ? value : undefined;
  } catch { return undefined; }
}
function writeLocal(key: string, copy: LocalCopy) {
  try { localStorage.setItem(key, JSON.stringify(copy)); } catch { /* storage unavailable: server copy still applies */ }
}

export function AnalysisDraftProvider({ userId, propertyId, analysisId, children }: {
  userId: string; propertyId: string; analysisId: string; children: ReactNode;
}) {
  const key = storageKey(userId, propertyId, analysisId);
  const [draft, setDraft] = useState<AnalysisDraft>(empty);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<DraftSaveState>("idle");
  const [savedAt, setSavedAt] = useState<string>();
  const latest = useRef<AnalysisDraft>(empty());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const editedSinceLoad = useRef(false);

  useEffect(() => {
    const local = readLocal(key);
    latest.current = local?.draft ?? empty();
    setDraft(latest.current); setSavedAt(local?.savedAt); setSaveState(local ? (local.synced ? "saved" : "local-only") : "idle");
    setLoaded(false);
    editedSinceLoad.current = false;
    const controller = new AbortController();
    void draftsApi.get(propertyId, analysisId, controller.signal).then(remote => {
      if (controller.signal.aborted) return;
      // Answers typed on this device and not yet in the account always win and are pushed up: edits made while this
      // request was in flight, and offline edits from an earlier visit. Otherwise a different account copy (saved
      // from another device) replaces the device copy. Only server timestamps are compared.
      if (editedSinceLoad.current || (local && !local.synced)) { schedule(0); return; }
      if (remote?.updatedAt && remote.updatedAt !== local?.savedAt) {
        latest.current = remote.draft; setDraft(remote.draft); setSavedAt(remote.updatedAt); setSaveState("saved");
        writeLocal(key, { draft: remote.draft, savedAt: remote.updatedAt, synced: true });
      }
    }).catch(() => { /* offline or not deployed yet: keep the local copy */ })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    return () => {
      controller.abort(); clearTimeout(timer.current);
      // Leaving the step must not drop an edit that is still waiting for its debounced save.
      if (pending.current) {
        pending.current = false;
        const snapshot = latest.current;
        void draftsApi.save(propertyId, analysisId, snapshot).then(result =>
          writeLocal(key, { draft: snapshot, savedAt: result.updatedAt, synced: true })).catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the analysis changes
  }, [key, propertyId, analysisId]);

  function schedule(delay = SAVE_DELAY_MS) {
    clearTimeout(timer.current);
    pending.current = true;
    timer.current = setTimeout(() => {
      pending.current = false;
      inflight.current?.abort();
      const controller = new AbortController(); inflight.current = controller;
      const snapshot = latest.current;
      setSaveState("saving");
      void draftsApi.save(propertyId, analysisId, snapshot, controller.signal).then(result => {
        if (controller.signal.aborted) return;
        setSavedAt(result.updatedAt);
        if (latest.current === snapshot) {
          setSaveState("saved");
          writeLocal(key, { draft: snapshot, savedAt: result.updatedAt, synced: true });
        }
      }).catch(failure => {
        if (controller.signal.aborted) return;
        // A validation refusal will not fix itself on retry, unlike a dropped connection.
        setSaveState(failure instanceof RoofRequestError && failure.code === "INVALID_REQUEST" ? "rejected" : "local-only");
      });
    }, delay);
  }

  const update = useCallback((next: AnalysisDraft) => {
    editedSinceLoad.current = true;
    latest.current = next; setDraft(next);
    const now = new Date().toISOString();
    writeLocal(key, { draft: next, savedAt: now, synced: false });
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- schedule reads refs only
  }, [key, propertyId, analysisId]);

  const value = useMemo<DraftContextValue>(() => ({
    draft, loaded, saveState, savedAt,
    setSection: (section, values) => {
      const merged: Record<string, string> = { ...latest.current[section] };
      for (const [name, value] of Object.entries(values)) {
        if (name in merged || Object.keys(merged).length < MAX_FIELDS) merged[name] = String(value).slice(0, MAX_VALUE_LENGTH);
      }
      update({ ...latest.current, [section]: merged });
    },
    setStep: step => { if (latest.current.step !== step) update({ ...latest.current, step }); },
  }), [draft, loaded, saveState, savedAt, update]);

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

/** True when sizing answers were saved for this analysis, on this device or in the account. */
export async function hasSavedDesignInputs(userId: string, propertyId: string, analysisId: string, signal?: AbortSignal): Promise<boolean> {
  const filled = (draft?: AnalysisDraft) => Boolean(draft?.design && Object.values(draft.design).some(value => value.trim() !== ""));
  if (filled(readLocal(storageKey(userId, propertyId, analysisId))?.draft)) return true;
  try { return filled((await draftsApi.get(propertyId, analysisId, signal))?.draft); } catch { return false; }
}

export function useAnalysisDraft() { return useContext(DraftContext); }

/**
 * A form section backed by the analysis draft when a provider exists (the live analysis flow) and by plain component
 * state otherwise (demos, tests). Only keys present in `initial` are read back, and only string values.
 */
export function useDraftSection<T extends Record<string, string>>(section: DraftSection, initial: T): [T, (patch: Partial<T>) => void] {
  const context = useContext(DraftContext);
  const [local, setLocal] = useState<T>(initial);
  const stored = context?.draft[section];
  const merged = useMemo(() => {
    if (!context) return local;
    const result = { ...initial };
    for (const name of Object.keys(initial) as (keyof T)[]) {
      const value = stored?.[name as string];
      if (typeof value === "string") result[name] = value as T[keyof T];
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is a fresh literal each render; its values are what matter
  }, [context, local, stored, JSON.stringify(initial)]);
  const set = useCallback((patch: Partial<T>) => {
    if (context) context.setSection(section, patch as Record<string, string>);
    else setLocal(previous => ({ ...previous, ...patch }));
  }, [context, section]);
  return [merged, set];
}

export function DraftSaveIndicator() {
  const context = useContext(DraftContext);
  if (!context || context.saveState === "idle") return null;
  const text = context.saveState === "saving" ? "Saving your answers…"
    : context.saveState === "saved" ? "Answers saved to your account"
      : context.saveState === "rejected" ? "Answers saved on this device only: one answer is too long to save to your account. Shorten it to sync."
        : "Answers saved on this device. They will sync to your account when the connection is back.";
  return <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{text}</p>;
}
