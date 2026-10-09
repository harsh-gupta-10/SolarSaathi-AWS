// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PolicyFinancialResults } from "../src/components/policy-financial-results";
import { demoPolicyFinancialResponse } from "../src/app/demo/policy-financial-fixture";

afterEach(cleanup);

describe("policy-backed financial result", () => {
  it("shows a partial source-backed quote ledger and the upfront-timing limitation", async () => {
    const user = userEvent.setup();
    render(<PolicyFinancialResults response={demoPolicyFinancialResponse} />);
    expect(screen.getByRole("heading", { name: "From your quote to a modeled net cost" })).toBeTruthy();
    expect(screen.getByText("Partial verified coverage")).toBeTruthy();
    expect(screen.getByText("Central")).toBeTruthy();
    expect(screen.getAllByText("Undetermined")).toHaveLength(4);
    expect(screen.getByText("Total selected benefits")).toBeTruthy();
    expect(screen.getByText("Modeled upfront reduction")).toBeTruthy();
    expect(screen.getByText("Modeled net upfront cost")).toBeTruthy();
    expect(screen.getByText(/actual payment timing is unverified/i)).toBeTruthy();
    expect(screen.getByText(/Synthetic demo source/)).toBeTruthy();
    await user.click(screen.getByText("Compare 25-year base and adjusted cash flow"));
    expect(screen.getByRole("region", { name: "Base and adjusted annual cash flow" }).querySelectorAll("tbody tr")).toHaveLength(26);
  });

  it("keeps fictional policy citations and check times in the demo without an external link", () => {
    render(<PolicyFinancialResults response={demoPolicyFinancialResponse} demo />);
    expect(screen.getByText(/Fictional citation · Fictional rule fixture/)).toBeTruthy();
    expect(screen.getByText(/Fictional source check/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Synthetic demo source/ })).toBeNull();
  });

  it("hides net cost and adjusted payback when no current benefit is confirmed", () => {
    render(<PolicyFinancialResults response={{ ...demoPolicyFinancialResponse,
      status: "UNAVAILABLE", projection: undefined, benefits: { ...demoPolicyFinancialResponse.benefits,
        status: "UNAVAILABLE", result: undefined } }} />);
    expect(screen.getByRole("heading", { name: "Policy-adjusted estimate unavailable" })).toBeTruthy();
    expect(screen.queryByText("Modeled net upfront cost")).toBeNull();
    expect(screen.queryByText("Adjusted payback scenario")).toBeNull();
  });

  it("explains selected benefits that cannot be applied upfront", () => {
    render(<PolicyFinancialResults response={{ ...demoPolicyFinancialResponse,
      status: "UNAVAILABLE", projection: undefined, reasonCodes: ["NO_UPFRONT_MODELABLE_BENEFITS"] }} />);
    expect(screen.getByText(/Other selected benefits may exist/)).toBeTruthy();
    expect(screen.queryByText("Modeled net upfront cost")).toBeNull();
  });

  it("distinguishes missing applicant facts from incomplete policy coverage", () => {
    render(<PolicyFinancialResults response={{ ...demoPolicyFinancialResponse,
      projection: { ...demoPolicyFinancialResponse.projection!, coverageComplete: true, status: "PARTIAL",
        warnings: ["BENEFIT_PAYMENT_TIMING_UNVERIFIED", "BENEFIT_AMOUNT_UNKNOWN"] } }} />);
    expect(screen.getByText("Eligibility details incomplete")).toBeTruthy();
    expect(screen.getByText(/Some applicant details remain unknown/)).toBeTruthy();
    expect(screen.queryByText(/Unchecked central, state, DISCOM/)).toBeNull();
  });

  it("keeps selected other benefits separate from the modeled upfront reduction", () => {
    const projection = demoPolicyFinancialResponse.projection!;
    render(<PolicyFinancialResults response={{ ...demoPolicyFinancialResponse,
      projection: { ...projection, selectedByScopePaise: { ...projection.selectedByScopePaise, OTHER: 150_000 },
        totalEligibleBenefitPaise: projection.totalEligibleBenefitPaise + 150_000,
        nonUpfrontBenefitPaise: 150_000,
        warnings: [...projection.warnings, "OTHER_BENEFITS_NOT_MODELED_UPFRONT"] } }} />);
    expect(screen.getByText(/in selected other benefits is listed above but excluded/)).toBeTruthy();
    expect(screen.getByText("Modeled upfront reduction")).toBeTruthy();
  });

  it("labels an archived proposal as an as-of calculation without claiming policy is current now", () => {
    render(<PolicyFinancialResults asOfSnapshot response={{ ...demoPolicyFinancialResponse,
      projection: { ...demoPolicyFinancialResponse.projection!, coverageComplete: true, status: "COMPLETE" } }} />);
    expect(screen.getByText("Verified when saved")).toBeTruthy();
    expect(screen.getByText(/saved scenario used the verified rule set available when it was calculated/i)).toBeTruthy();
    expect(screen.getByText(/fresh when evaluated/i)).toBeTruthy();
    expect(screen.queryByText("Current verified coverage")).toBeNull();
  });

  it("uses past-tense unavailable copy for an archived proposal", () => {
    render(<PolicyFinancialResults asOfSnapshot response={{ ...demoPolicyFinancialResponse,
      status: "UNAVAILABLE", projection: undefined, benefits: { ...demoPolicyFinancialResponse.benefits,
        status: "UNAVAILABLE", result: undefined } }} />);
    expect(screen.getByText(/No benefit in this saved evaluation could be modeled/)).toBeTruthy();
    expect(screen.queryByText(/No current, confirmed benefit/)).toBeNull();
  });
});
