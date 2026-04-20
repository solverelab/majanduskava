// src/domain/allocationBasis.test.js
import { describe, it, expect } from "vitest";
import { getEffectiveAllocationBasis } from "./planSchema";

describe("getEffectiveAllocationBasis", () => {
  it("returns defaultBasis when override is absent", () => {
    expect(
      getEffectiveAllocationBasis({
        defaultBasis: "m2",
        overrideBasis: null,
        legalBasis: null,
      })
    ).toBe("m2");
  });

  it("ignores override when legalBasis is missing", () => {
    expect(
      getEffectiveAllocationBasis({
        defaultBasis: "m2",
        overrideBasis: "korter",
        legalBasis: null,
      })
    ).toBe("m2");
  });

  it("applies override when legalBasis is present", () => {
    expect(
      getEffectiveAllocationBasis({
        defaultBasis: "m2",
        overrideBasis: "korter",
        legalBasis: "pohikiri",
      })
    ).toBe("korter");
  });

  it("falls back to 'm2' when policy is missing", () => {
    expect(getEffectiveAllocationBasis(undefined)).toBe("m2");
    expect(getEffectiveAllocationBasis(null)).toBe("m2");
  });
});
