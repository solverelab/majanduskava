// src/domain/summarizeAllocationPolicy.test.js
import { describe, it, expect } from "vitest";
import { summarizeAllocationPolicy } from "./allocationBasisDisplay";

describe("summarizeAllocationPolicy", () => {
  it("default (policy puudub) → `Jaotusalus: Kaasomandi osa suurus · Vaikimisi alus`", () => {
    expect(summarizeAllocationPolicy(undefined))
      .toBe("Jaotusalus: Kaasomandi osa suurus · Vaikimisi alus");
  });

  it("default policy (override null) → `Jaotusalus: Kaasomandi osa suurus · Vaikimisi alus`", () => {
    expect(summarizeAllocationPolicy({
      defaultBasis: "m2", overrideBasis: null, legalBasis: null, legalBasisNote: "",
    })).toBe("Jaotusalus: Kaasomandi osa suurus · Vaikimisi alus");
  });

  it("override ilma legalBasis → endiselt `Vaikimisi alus` (helper fallback)", () => {
    // UI näitab neutraalset märget, kokkuvõte peegeldab fallback-olekut.
    expect(summarizeAllocationPolicy({
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: null, legalBasisNote: "",
    })).toBe("Jaotusalus: Kaasomandi osa suurus · Vaikimisi alus");
  });

  it("override + legalBasis=pohikiri → `Jaotusalus: korteri kohta · Õiguslik alus: pohikiri`", () => {
    expect(summarizeAllocationPolicy({
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: "pohikiri", legalBasisNote: "",
    })).toBe("Jaotusalus: korteri kohta · Õiguslik alus: pohikiri");
  });

  it("override + legalBasis + legalBasisNote → kuvatakse ka viide", () => {
    expect(summarizeAllocationPolicy({
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: "pohikiri", legalBasisNote: "põhikiri p 6.2",
    })).toBe("Jaotusalus: korteri kohta · Õiguslik alus: pohikiri · Viide: põhikiri p 6.2");
  });

  it("reserve käitub sama mustri järgi (policy struktuur on kolme võtme vahel sama)", () => {
    const reservePolicy = {
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: "erikokkulepe", legalBasisNote: "",
    };
    expect(summarizeAllocationPolicy(reservePolicy))
      .toBe("Jaotusalus: korteri kohta · Õiguslik alus: erikokkulepe");
  });
});
