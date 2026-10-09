// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidedDemo } from "../src/components/guided-demo";

const financial = { gross: "₹2,00,000", central: "₹50,000", selectedTotal: "₹50,000",
  net: "₹1,50,000", coverageComplete: false };

afterEach(() => cleanup());

describe("guided synthetic demo", () => {
  it("reveals approximate house bounds only after an explicit sample-house selection", async () => {
    const user = userEvent.setup();
    render(<GuidedDemo financial={financial} />);
    expect(screen.getByRole("note").textContent).toContain("No live account, map, government policy");
    expect(screen.getByRole("heading", { name: "Start with an address" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Choose the house" })).toBeTruthy();
    expect(screen.queryByText("Approximate bounds overlay")).toBeNull();
    const sampleHouse = screen.getByRole("button", { name: "Select the sample house on the illustrative map" });
    expect(sampleHouse.getAttribute("aria-pressed")).toBe("false");
    await user.click(sampleHouse);
    expect(sampleHouse.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Approximate bounds overlay")).toBeTruthy();
    expect(screen.getByText(/no property was saved/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Use my current location once in the real map" }).getAttribute("href"))
      .toBe("/app/analyze");
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByRole("heading", { name: "Start with an address" })).toBeTruthy();
  });

  it("keeps fictional partial benefits distinct from undetermined scopes and links to the source trail", async () => {
    const user = userEvent.setup();
    render(<GuidedDemo financial={financial} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Jump to a stage" }), "4");
    expect(screen.getByRole("heading", { name: "Check benefit compatibility" })).toBeTruthy();
    expect(screen.getByText("Undetermined")).toBeTruthy();
    expect(screen.getByText(/Policy coverage is incomplete/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Inspect fictional rule scenario" }).getAttribute("href"))
      .toBe("/demo/policy-financial");
    await user.selectOptions(screen.getByRole("combobox", { name: "Jump to a stage" }), "5");
    expect(screen.getByText("₹1,50,000")).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Jump to a stage" }), "10");
    expect(screen.getByRole("heading", { name: "Trace every claim" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Inspect fictional source trail" }).getAttribute("href"))
      .toBe("/demo/source-trail");
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("note").textContent).toContain("fictional");
  });
});
