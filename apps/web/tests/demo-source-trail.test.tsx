// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SourceTrailDemoPage from "../src/app/demo/source-trail/page";
import { demoDesign, demoFinancialResponse } from "../src/app/demo/system-financial-fixture";
import { demoPolicyFinancialResponse } from "../src/app/demo/policy-financial-fixture";

afterEach(cleanup);

describe("guided demo source trail", () => {
  it("keeps one coherent 3 kW fictional story with no clickable policy fixture URL", () => {
    expect(demoDesign.recommendation?.nominalKw).toBe(3);
    expect(demoFinancialResponse.system).toEqual(demoDesign.recommendation);
    expect(demoPolicyFinancialResponse.system).toEqual(demoFinancialResponse.system);
    expect(demoPolicyFinancialResponse.projection?.netUpfrontCostPaise).toBe(15_000_000);

    render(<SourceTrailDemoPage />);
    expect(screen.getByRole("heading", { name: "Where does this number come from?" })).toBeTruthy();
    expect(screen.getByText(/No government claim/)).toBeTruthy();
    expect(screen.getByText(/example\.invalid\/fixture/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /example\.invalid/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Guided demo/ }).getAttribute("href")).toBe("/demo");
  });
});
