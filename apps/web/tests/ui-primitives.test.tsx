// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChipGroup, CurrencyInput, Field, Input, formatIndianDigits, SourceCitation } from "@solarsaathi/ui";

afterEach(cleanup);

describe("shared UI primitives", () => {
  it("groups digits the Indian way", () => {
    expect(formatIndianDigits("")).toBe("");
    expect(formatIndianDigits("999")).toBe("999");
    expect(formatIndianDigits("1234567")).toBe("12,34,567");
    expect(formatIndianDigits("180000")).toBe("1,80,000");
  });

  it("CurrencyInput keeps digits only and formats while typing", async () => {
    function Harness() {
      const [value, setValue] = useState("");
      return <CurrencyInput aria-label="Quote" value={value} onValueChange={setValue} />;
    }
    render(<Harness />);
    const input = screen.getByLabelText("Quote") as HTMLInputElement;
    await userEvent.type(input, "1e8,0a000");
    expect(input.value).toBe("1,80,000");
    expect(input.inputMode).toBe("numeric");
  });

  it("Field wires hint and error to the control", () => {
    render(
      <Field id="bill" label="Monthly bill" hint="From your latest bill" error="Enter a number" required>
        {control => <Input {...control} />}
      </Field>
    );
    const input = screen.getByLabelText(/Monthly bill/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("bill-hint bill-error");
    expect(screen.getByRole("alert").textContent).toBe("Enter a number");
  });

  it("ChipGroup exposes radio semantics", async () => {
    const picked: string[] = [];
    render(<ChipGroup label="Owner" value="YES" options={[{ label: "Yes", value: "YES" }, { label: "No", value: "NO" }]} onChange={v => picked.push(v)} />);
    expect(screen.getByRole("radio", { name: "Yes" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(picked).toEqual(["NO"]);
  });

  it("SourceCitation prints provenance fields", () => {
    render(<SourceCitation source="PM Surya Ghar" jurisdiction="IN" policyVersion={3} status="VERIFIED" lastCheckedAt="2026-10-11T00:00:00Z" />);
    expect(screen.getByText(/Source: PM Surya Ghar · Jurisdiction: IN · Version 3 · Status: VERIFIED · Checked: 2026-10-11/)).toBeTruthy();
  });
});
