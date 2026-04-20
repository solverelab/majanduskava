// src/domain/allocationExceptionSemantics.test.js
// Lukustab jaotusaluse erandi LÕPLIKU semantika.
//
// Reegel: "Jaotusaluse erand mõjutab arvutust ainult siis, kui erandi
// rakendamiseks vajalikud väljad (overrideBasis JA legalBasis) on tegelikult
// sisuliselt määratud. Pelgalt erandi avamine (ainult overrideBasis) või
// aluse märkimine (ainult legalBasis) ei tohi vaikimisi arvutust muuta."
//
// See fail katab viie juhu (vaikeseis / toggle-ON / ainult legalBasis /
// mõlemad / puhastus) käitumise nii helperi kui computePlan-i tasandil.

import { describe, it, expect } from "vitest";
import {
  defaultPlan,
  getEffectiveAllocationBasis,
  patchAllocationPolicy,
  mkApartment,
} from "./planSchema";
import { computePlan } from "../engine/computePlan";

function mkTestPlan() {
  return {
    ...defaultPlan({ year: 2026 }),
    period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
    building: {
      apartments: [
        { id: "A", label: "A", areaM2: 30 },
        { id: "B", label: "B", areaM2: 70 },
      ],
    },
    budget: {
      costRows: [{
        id: "h1", category: "Haldus", summaInput: 1200, arvutus: "aastas",
        legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
        calc: { type: "ANNUAL_FIXED", params: { annualEUR: 1200 } },
      }],
      incomeRows: [],
    },
  };
}

describe("Jaotusaluse erandi lõplik semantika (helper-tasand)", () => {
  it("1. vaikeseis (override ja legalBasis mõlemad null) → m²", () => {
    const p = defaultPlan().allocationPolicies.maintenance;
    expect(getEffectiveAllocationBasis(p)).toBe("m2");
  });

  it("2. toggle ON ainult (overrideBasis='korter', legalBasis=null) → m² (erand ei rakendu)", () => {
    expect(getEffectiveAllocationBasis({
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: null,
    })).toBe("m2");
  });

  it("3. ainult alus valitud (overrideBasis=null, legalBasis='pohikiri') → m² (konservatiivne)", () => {
    expect(getEffectiveAllocationBasis({
      defaultBasis: "m2", overrideBasis: null, legalBasis: "pohikiri",
    })).toBe("m2");
  });

  it("4. alus + erandi jaotus mõlemad valitud → erand rakendub (korter)", () => {
    expect(getEffectiveAllocationBasis({
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: "pohikiri",
    })).toBe("korter");
  });

  it("5. pärast puhastust (mõlemad tagasi null-iks) → m²", () => {
    let plan = defaultPlan();
    plan = patchAllocationPolicy(plan, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri" });
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.maintenance)).toBe("korter");
    plan = patchAllocationPolicy(plan, "maintenance", { overrideBasis: null, legalBasis: null, legalBasisNote: "" });
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.maintenance)).toBe("m2");
  });

  it("erikokkulepe annab sama rakendumisreegli kui pohikiri", () => {
    expect(getEffectiveAllocationBasis({
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: "erikokkulepe",
    })).toBe("korter");
  });
});

describe("Jaotusaluse erandi lõplik semantika (computePlan-i tasand)", () => {
  it("juht 2: toggle ON ilma legalBasis'eta → apartmentPayments sama kui default", () => {
    const base = mkTestPlan();
    const toggleOnly = JSON.parse(JSON.stringify(base));
    toggleOnly.allocationPolicies.maintenance.overrideBasis = "korter";
    toggleOnly.allocationPolicies.maintenance.legalBasis = null;
    const r1 = computePlan(base);
    const r2 = computePlan(toggleOnly);
    expect(r2.apartmentPayments).toEqual(r1.apartmentPayments);
    expect(r2.totals).toEqual(r1.totals);
  });

  it("juht 3: ainult legalBasis ilma overrideBasis'eta → apartmentPayments sama kui default", () => {
    const base = mkTestPlan();
    const onlyBasis = JSON.parse(JSON.stringify(base));
    onlyBasis.allocationPolicies.maintenance.overrideBasis = null;
    onlyBasis.allocationPolicies.maintenance.legalBasis = "pohikiri";
    const r1 = computePlan(base);
    const r2 = computePlan(onlyBasis);
    expect(r2.apartmentPayments).toEqual(r1.apartmentPayments);
    expect(r2.totals).toEqual(r1.totals);
  });

  it("juht 4: override + legalBasis mõlemad → haldus jaotub VÕRDSELT kahe korteri vahel", () => {
    const base = mkTestPlan();
    const full = JSON.parse(JSON.stringify(base));
    full.allocationPolicies.maintenance.overrideBasis = "korter";
    full.allocationPolicies.maintenance.legalBasis = "pohikiri";
    const r = computePlan(full);
    const [a, b] = r.apartmentPayments;
    expect(a.operationalMonthlyEUR).toBeCloseTo(b.operationalMonthlyEUR, 2);
  });

  it("juht 5: puhastus pärast rakendumist → tagasi m²-jaotusele (30/70 suhe)", () => {
    const base = mkTestPlan();
    const full = JSON.parse(JSON.stringify(base));
    full.allocationPolicies.maintenance.overrideBasis = "korter";
    full.allocationPolicies.maintenance.legalBasis = "pohikiri";
    // Veendu, et vahepeal erand tõesti rakendus
    const rActive = computePlan(full);
    expect(rActive.apartmentPayments[0].operationalMonthlyEUR)
      .toBeCloseTo(rActive.apartmentPayments[1].operationalMonthlyEUR, 2);
    // Puhasta
    const cleaned = JSON.parse(JSON.stringify(full));
    cleaned.allocationPolicies.maintenance.overrideBasis = null;
    cleaned.allocationPolicies.maintenance.legalBasis = null;
    cleaned.allocationPolicies.maintenance.legalBasisNote = "";
    const r1 = computePlan(base);
    const r2 = computePlan(cleaned);
    expect(r2.apartmentPayments).toEqual(r1.apartmentPayments);
    expect(r2.totals).toEqual(r1.totals);
  });

  it("regressioon: kolme kihi (maintenance / remondifond / reserve) 'poolrakendunud' olekud kõik annavad sama tulemuse kui default", () => {
    const base = mkTestPlan();
    const halfA = JSON.parse(JSON.stringify(base));
    // Kolm kihti, igaüks ainult override ON
    halfA.allocationPolicies.maintenance.overrideBasis = "korter";
    halfA.allocationPolicies.remondifond.overrideBasis = "korter";
    halfA.allocationPolicies.reserve.overrideBasis = "korter";
    const halfB = JSON.parse(JSON.stringify(base));
    // Kolm kihti, igaüks ainult legalBasis
    halfB.allocationPolicies.maintenance.legalBasis = "pohikiri";
    halfB.allocationPolicies.remondifond.legalBasis = "pohikiri";
    halfB.allocationPolicies.reserve.legalBasis = "pohikiri";

    const r0 = computePlan(base);
    const rA = computePlan(halfA);
    const rB = computePlan(halfB);
    expect(rA.apartmentPayments).toEqual(r0.apartmentPayments);
    expect(rB.apartmentPayments).toEqual(r0.apartmentPayments);
    expect(rA.totals).toEqual(r0.totals);
    expect(rB.totals).toEqual(r0.totals);
  });
});
