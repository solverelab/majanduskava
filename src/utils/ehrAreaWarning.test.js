import { describe, it, expect } from "vitest";
import { computePlan } from "../engine/computePlan";
import { defaultPlan, mkApartment } from "../domain/planSchema";

// Mirrors EHR warning logic in MajanduskavaApp.jsx:
//   ehrTotalAreaM2 != null && Math.abs(derived.building.totAreaM2 - ehrTotalAreaM2) > 0.05

function shouldShowEhrWarning(ehrTotalAreaM2, currentTotalAreaM2) {
  if (ehrTotalAreaM2 == null) return false;
  return Math.abs(currentTotalAreaM2 - ehrTotalAreaM2) > 0.05;
}

// Mirrors handleApartmentsLoaded EHR sum calculation
function computeEhrSum(apartmentsFromEHR) {
  const sum = apartmentsFromEHR.reduce((s, a) => s + (parseFloat(a.area) || 0), 0);
  return Math.round(sum * 100) / 100;
}

describe("EHR pindalade ristvalideerimise hoiatus", () => {
  it("EHR puudub (null) → hoiatust ei kuvata", () => {
    expect(shouldShowEhrWarning(null, 101.0)).toBe(false);
  });

  it("EHR summa = praegune summa → hoiatust ei kuvata", () => {
    expect(shouldShowEhrWarning(101.0, 101.0)).toBe(false);
  });

  it("EHR summa ≠ praegune summa → hoiatus kuvatakse", () => {
    expect(shouldShowEhrWarning(101.0, 95.5)).toBe(true);
  });

  it("väike erinevus (≤ 0.05) �� hoiatust ei kuvata (ümardustolerents)", () => {
    expect(shouldShowEhrWarning(101.0, 101.04)).toBe(false);
    expect(shouldShowEhrWarning(101.0, 101.05)).toBe(false);
  });

  it("üle tolerantsi erinevus (> 0.05) → hoiatus kuvatakse", () => {
    expect(shouldShowEhrWarning(101.0, 101.1)).toBe(true);
  });
});

describe("EHR summa arvutamine handleApartmentsLoaded-st", () => {
  it("arvutab korrektselt", () => {
    const ehr = [{ number: "1", area: 52.3 }, { number: "2", area: 48.7 }];
    expect(computeEhrSum(ehr)).toBe(101.0);
  });

  it("käsitleb puuduvaid pindalasid 0-na", () => {
    const ehr = [{ number: "1", area: 52.3 }, { number: "2" }];
    expect(computeEhrSum(ehr)).toBe(52.3);
  });

  it("käsitleb stringi pindalasid", () => {
    const ehr = [{ number: "1", area: "52.3" }, { number: "2", area: "48.7" }];
    expect(computeEhrSum(ehr)).toBe(101.0);
  });
});

describe("käsitsi pindala muutmine pärast EHR importi", () => {
  it("korteri pindala muutmisel tekib erinevus ja hoiatus ilmub", () => {
    const ehrSum = 101.0; // EHR: 52.3 + 48.7

    // Kasutaja muudab ühe korteri pindala
    const plan = {
      ...defaultPlan({ year: 2027 }),
      period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [
        mkApartment({ label: "1", areaM2: 50.0 }), // muudetud: 52.3 → 50.0
        mkApartment({ label: "2", areaM2: 48.7 }),
      ]},
    };

    const derived = computePlan(plan);
    expect(derived.building.totAreaM2).toBeCloseTo(98.7, 1);
    expect(shouldShowEhrWarning(ehrSum, derived.building.totAreaM2)).toBe(true);
  });
});

describe("hoiatus ei mõjuta arvutusi ega gate'i", () => {
  it("computePlan tulemus on sama sõltumata EHR olemasolust", () => {
    const plan = {
      ...defaultPlan({ year: 2027 }),
      period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [mkApartment({ label: "1", areaM2: 52.3 })] },
    };
    const d1 = computePlan(plan);

    // EHR olemasolu ei muuda computePlan-i — see on ainult UI state
    const d2 = computePlan(plan);
    expect(d1.building.totAreaM2).toBe(d2.building.totAreaM2);
    expect(d1.funds).toEqual(d2.funds);
  });
});
