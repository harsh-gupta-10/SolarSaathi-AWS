// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { encodeRoofOutline, type RoofOutline } from "@solarsaathi/calculations";

const context = vi.hoisted(() => ({ value: null as null | { loaded: boolean; draft: { outline?: Record<string, string> }; setSection: (section: string, values: Record<string, string>) => void } }));
vi.mock("../src/lib/analysis-draft", () => ({
  useAnalysisDraft: () => context.value,
  AnalysisDraftProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
import { AnalysisDraftScope, RoofOutlineDraftBridge } from "../src/components/roof-outline-draft";

const outline: RoofOutline = [
  { latitude: 19.0760, longitude: 72.8770 }, { latitude: 19.0760, longitude: 72.8772 },
  { latitude: 19.0763, longitude: 72.8772 }, { latitude: 19.0763, longitude: 72.8770 },
];
const other: RoofOutline = [outline[0], outline[1], { latitude: 19.0765, longitude: 72.8773 }, outline[3]];

afterEach(() => { cleanup(); context.value = null; });

describe("roof outline draft bridge", () => {
  it("restores a saved outline once the draft has loaded", async () => {
    const onRestore = vi.fn(), setSection = vi.fn();
    context.value = { loaded: false, draft: { outline: { corners: encodeRoofOutline(outline) } }, setSection };
    const view = render(<RoofOutlineDraftBridge outline={undefined} onRestore={onRestore} />);
    expect(onRestore).not.toHaveBeenCalled();
    context.value = { ...context.value, loaded: true };
    view.rerender(<RoofOutlineDraftBridge outline={undefined} onRestore={onRestore} />);
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(onRestore.mock.calls[0][0][2].latitude).toBeCloseTo(19.0763, 6);
    expect(setSection).not.toHaveBeenCalled();
  });

  it("saves an outline traced before the roof was saved and every later change, and clears it on reset", async () => {
    // Like the real store, a saved section shows up in the draft that the bridge reads back.
    const setSection = vi.fn((section: string, values: Record<string, string>) => {
      if (section === "outline" && context.value) context.value = { ...context.value, draft: { outline: values } };
    });
    context.value = { loaded: true, draft: {}, setSection };
    const view = render(<RoofOutlineDraftBridge outline={outline} onRestore={vi.fn()} />);
    await waitFor(() => expect(setSection).toHaveBeenCalledWith("outline", { corners: encodeRoofOutline(outline) }));
    view.rerender(<RoofOutlineDraftBridge outline={other} onRestore={vi.fn()} />);
    await waitFor(() => expect(setSection).toHaveBeenLastCalledWith("outline", { corners: encodeRoofOutline(other) }));
    view.rerender(<RoofOutlineDraftBridge outline={undefined} onRestore={vi.fn()} />);
    await waitFor(() => expect(setSection).toHaveBeenLastCalledWith("outline", { corners: "" }));
    expect(setSection.mock.calls.every(call => encodeRoofOutline(outline).length <= 200 && String(call[1].corners).length <= 200)).toBe(true);
  });

  it("ignores an unreadable saved value and does nothing without a draft", () => {
    const setSection = vi.fn(), onRestore = vi.fn();
    context.value = { loaded: true, draft: { outline: { corners: "not,an;outline" } }, setSection };
    render(<RoofOutlineDraftBridge outline={undefined} onRestore={onRestore} />);
    expect(onRestore).not.toHaveBeenCalled();
    cleanup(); context.value = null;
    const { container } = render(<><AnalysisDraftScope><RoofOutlineDraftBridge outline={outline} onRestore={onRestore} /></AnalysisDraftScope></>);
    expect(container.textContent).toBe("");
  });
});
