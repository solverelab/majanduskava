// src/domain/allocationBasisDisplay.test.js
import { describe, it, expect } from "vitest";
import { describeAllocationPolicy, formatBasisLabel } from "./allocationBasisDisplay";

describe("describeAllocationPolicy", () => {
  it("policy puudub → m², hasOverride=false", () => {
    const d = describeAllocationPolicy(undefined);
    expect(d.basis).toBe("m2");
    expect(d.basisLabel).toBe("m²");
    expect(d.hasOverride).toBe(false);
    expect(d.legalBasis).toBe(null);
  });

  it("policy default ilma override → m², hasOverride=false", () => {
    const d = describeAllocationPolicy({
      defaultBasis: "m2",
      overrideBasis: null,
      legalBasis: null,
    });
    expect(d.hasOverride).toBe(false);
    expect(d.basisLabel).toBe("m²");
  });

  it("override ilma legalBasis → ignoreeritakse, hasOverride=false", () => {
    const d = describeAllocationPolicy({
      defaultBasis: "m2",
      overrideBasis: "korter",
      legalBasis: null,
    });
    expect(d.hasOverride).toBe(false);
    expect(d.basisLabel).toBe("m²");
  });

  it("override + legalBasis → hasOverride=true, basis=korter", () => {
    const d = describeAllocationPolicy({
      defaultBasis: "m2",
      overrideBasis: "korter",
      legalBasis: "pohikiri",
      legalBasisNote: "§12 lg 3",
    });
    expect(d.hasOverride).toBe(true);
    expect(d.basis).toBe("korter");
    expect(d.basisLabel).toBe("korteri kohta");
    expect(d.legalBasis).toBe("pohikiri");
    expect(d.legalBasisNote).toBe("§12 lg 3");
  });

  it("formatBasisLabel fallback → m²", () => {
    expect(formatBasisLabel(undefined)).toBe("m²");
    expect(formatBasisLabel("whatever")).toBe("m²");
    expect(formatBasisLabel("korter")).toBe("korteri kohta");
  });
});
