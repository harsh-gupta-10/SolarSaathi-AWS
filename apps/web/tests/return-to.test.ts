import { describe, expect, it } from "vitest";
import { safeReturnTo, signInHref } from "../src/lib/return-to";

describe("return-to sanitizing", () => {
  it("accepts only same-origin app paths", () => {
    expect(safeReturnTo("/app/analyze?propertyId=p1")).toBe("/app/analyze?propertyId=p1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "app", "", undefined, "/auth/sign-in"]) {
      expect(safeReturnTo(bad)).toBeUndefined();
    }
  });
  it("builds sign-in links with an encoded return path", () => {
    expect(signInHref("/app/benefits")).toBe("/auth/sign-in?returnTo=%2Fapp%2Fbenefits");
    expect(signInHref("//evil")).toBe("/auth/sign-in");
  });
});
