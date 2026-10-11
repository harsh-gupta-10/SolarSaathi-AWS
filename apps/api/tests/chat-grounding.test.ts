import { describe, expect, it } from "vitest";
import { extractFigures, GroundingContext, groundText, GroundingStream, UNGROUNDED_REPLACEMENT } from "../src/chat/grounding";

const context = (text: string, data?: unknown) => { const value = new GroundingContext(); value.addText(text); if (data) value.addData(data); return value; };

describe("grounding post-check", () => {
  it("extracts rupee, kW, percent and payback figures with Indian formats and words", () => {
    const figures = extractFigures("Cost ₹1,50,000 or Rs. 2.5 lakh, 3.2 kW, 4 kWh, 90% and payback of 5.5 years. Warranty 25 years.");
    expect(figures.map(item => [item.kind, item.value])).toEqual([["money", 150000], ["money", 250000], ["kw", 3.2], ["kwh", 4], ["percent", 90], ["years", 5.5]]);
    expect(extractFigures("about 1.2 crore").map(item => item.value)).toEqual([12_000_000]);
    expect(extractFigures("₹45,450 per kW and INR 50000").map(item => item.value)).toEqual([45450, 50000]);
  });

  it("keeps grounded figures and replaces ungrounded ones, counting replacements", () => {
    const ground = context("Gross cost ₹1,80,000. System 3.03 kW. Payback 5.5 years.");
    const result = groundText("Your ₹1,80,000 system of 3.03 kW pays back in 5.5 years and saves ₹90,000 with a 40% subsidy.", ground);
    expect(result.text).toBe(`Your ₹1,80,000 system of 3.03 kW pays back in 5.5 years and saves ${UNGROUNDED_REPLACEMENT} with a ${UNGROUNDED_REPLACEMENT} subsidy.`);
    expect(result.replaced).toBe(2);
  });

  it("accepts lakh wording and rounding within tolerance but not a materially different figure", () => {
    const ground = context("Cost ₹1,48,500.");
    expect(groundText("About ₹1.5 lakh.", ground).replaced).toBe(0);
    expect(groundText("About ₹1 lakh.", ground).replaced).toBe(1);
    expect(groundText("About ₹2 lakh.", ground).replaced).toBe(1);
  });

  it("converts paise fields and nested card data into rupee figures", () => {
    const ground = context("", { rows: [{ label: "x", value: "₹9,000" }], totalEligibleBenefitPaise: 900000, nested: { counted: 1800000 } });
    expect(groundText("Benefit ₹9,000.", ground).replaced).toBe(0);
    expect(groundText("Benefit ₹18,000.", context("", { countedPaise: 1800000 })).replaced).toBe(0);
    expect(groundText("Benefit ₹1,00,000.", ground).replaced).toBe(1);
  });

  it("only treats years in payback sentences as financial claims", () => {
    const ground = context("Payback 5.5 years.");
    expect(groundText("Panels carry a 25 year warranty and last 30 years.", ground).replaced).toBe(0);
    expect(groundText("The payback is 3 years.", ground).replaced).toBe(1);
  });

  it("does not ground figures from user text or an empty context", () => {
    expect(groundText("You will get ₹1 lakh.", new GroundingContext()).text).toBe(`You will get ${UNGROUNDED_REPLACEMENT}.`);
  });

  it("checks a figure split across stream deltas and does not break on Rs.", () => {
    const stream = new GroundingStream(context("Cost ₹1,80,000."));
    let out = "";
    for (const delta of ["It costs ₹1,", "80,000. Subs", "idy is Rs. 50,", "000 for you. Done"]) out += stream.push(delta);
    out += stream.flush();
    expect(out).toBe(`It costs ₹1,80,000. Subsidy is ${UNGROUNDED_REPLACEMENT} for you. Done`);
    expect(stream.replaced).toBe(1);
  });
});
