// src/policy/__tests__/maintenanceLegacyJaotusalusCleanup.test.js
// Mirrors the maintenance cleanup branch in handleKuluKategooriaChange()
// (MajanduskavaApp.jsx ~line 1095) — legacy r.jaotusalus välja ei kanta
// maintenance-tundlikele ridadele edasi.

import { describe, it, expect } from "vitest";
import { HALDUSTEENUSED, KOMMUNAALTEENUSED, UTILITY_TYPE_BY_CATEGORY, kulureaOsa } from "../../utils/majanduskavaCalc";
import { defaultPlan, getEffectiveAllocationBasis, patchAllocationPolicy } from "../../domain/planSchema";
import { computePlan } from "../../engine/computePlan";

// Mirrors handleKuluKategooriaChange's plan-mutating branch.
function handleCategoryChange(plan, id, newKategooria) {
  const patch = { category: newKategooria, utilityType: UTILITY_TYPE_BY_CATEGORY[newKategooria] || null };
  if (KOMMUNAALTEENUSED.includes(newKategooria)) {
    Object.assign(patch, { uhik: "", kogus: "", uhikuHind: "", arvutus: undefined, summaInput: 0 });
  } else {
    Object.assign(patch, { arvutus: "aastas", summaInput: 0, kogus: undefined, uhik: undefined, uhikuHind: undefined });
  }
  if (HALDUSTEENUSED.includes(newKategooria)) {
    return {
      ...plan,
      budget: {
        ...plan.budget,
        costRows: plan.budget.costRows.map(r => {
          if (r.id !== id) return r;
          const { jaotusalus: _drop, ...rest } = r;
          return { ...rest, ...patch };
        }),
      },
    };
  }
  return {
    ...plan,
    budget: {
      ...plan.budget,
      costRows: plan.budget.costRows.map(r => r.id === id ? { ...r, ...patch } : r),
    },
  };
}

describe("Legacy r.jaotusalus puhastus maintenance-ridadelt", () => {
  it("maintenance-tundliku rea patch eemaldab olemasoleva jaotusalus välja", () => {
    const plan = {
      ...defaultPlan(),
      budget: { costRows: [{ id: "r1", category: "Soojus", jaotusalus: "korter", summaInput: 100 }], incomeRows: [] },
    };
    const next = handleCategoryChange(plan, "r1", "Haldus");
    expect("jaotusalus" in next.budget.costRows[0]).toBe(false);
    expect(next.budget.costRows[0].category).toBe("Haldus");
  });

  it("maintenance-ridale kategooria esmakordsel määramisel ei teki jaotusalus välja", () => {
    // "uus" rida: loomise hetkel category="" ja jaotusalus="m2" (mkCashflowRow default);
    // kategooria määramisel Haldus-iks peab väli puhastatama.
    const plan = {
      ...defaultPlan(),
      budget: { costRows: [{ id: "r1", category: "", jaotusalus: "m2", summaInput: 0 }], incomeRows: [] },
    };
    const next = handleCategoryChange(plan, "r1", "Hooldus");
    expect("jaotusalus" in next.budget.costRows[0]).toBe(false);
  });

  it("mittetundlik rida säilitab jaotusalus välja", () => {
    const plan = {
      ...defaultPlan(),
      budget: { costRows: [{ id: "r1", category: "Haldus", jaotusalus: "korter", summaInput: 100 }], incomeRows: [] },
    };
    // Haldus → Soojus: mittetundlik → jaotusalus jääb senise väärtusega
    const next = handleCategoryChange(plan, "r1", "Soojus");
    expect(next.budget.costRows[0].jaotusalus).toBe("korter");
  });

  it("regressioon: maintenance-rida arvutab õigesti läbi allocationPolicies, kui r.jaotusalus puudub", () => {
    let plan = {
      ...defaultPlan({ year: 2026 }),
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "A", label: "A", areaM2: 30 }, { id: "B", label: "B", areaM2: 70 }] },
      budget: {
        costRows: [
          // jaotusalus TEADLIKULT puudu — test, et policy võidab
          {
            id: "h1", category: "Haldus", name: "Haldus", summaInput: 1200, arvutus: "aastas",
            legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
            calc: { type: "ANNUAL_FIXED", params: { annualEUR: 1200 } },
          },
        ],
        incomeRows: [],
      },
    };
    plan = patchAllocationPolicy(plan, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri" });

    const res = computePlan(plan);
    const [a, b] = res.apartmentPayments;
    // override 'korter' + legalBasis 'pohikiri' → võrdne jaotus
    expect(a.operationalMonthlyEUR).toBeCloseTo(b.operationalMonthlyEUR, 2);
  });

  it("kulureaOsa tagastab m²-fallbacki, kui maintenance-real puudub jaotusalus", () => {
    // Katab üldise kaitse: kasutuskohad, mis veel legacy `kr.jaotusalus` kaudu lähevad,
    // ei tohi jaotusalus-puudumise korral kukkuda runtime veaga.
    expect(kulureaOsa(undefined, 50, 200, 4)).toBeCloseTo(0.25, 10);
  });
});
