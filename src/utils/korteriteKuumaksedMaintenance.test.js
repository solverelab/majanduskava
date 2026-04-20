// src/utils/korteriteKuumaksedMaintenance.test.js
// Mirrors the maintenance-row basis resolution block in
// MajanduskavaApp.jsx `korteriteKuumaksed` (around lines 556-580).
// Purpose: maintenance-sensitive rows must come from a single source of
// truth (plan.allocationPolicies.maintenance), not the row's own
// legacy `r.jaotusalus` field.

import { describe, it, expect } from "vitest";
import { getEffectiveAllocationBasis } from "../domain/planSchema";
import { kulureaOsa, KOMMUNAALTEENUSED, HALDUSTEENUSED } from "./majanduskavaCalc";

function effectiveBasisForRow(r, plan) {
  if (HALDUSTEENUSED.includes(r.category)) {
    return getEffectiveAllocationBasis(plan.allocationPolicies?.maintenance);
  }
  return r.jaotusalus || "m2";
}

// Mirrors the per-apartment haldus split in korteriteKuumaksed.
function computeHaldusShareForApt(plan, apt, koguPind, aptCount) {
  let haldus = 0;
  for (const r of plan.budget.costRows) {
    const kuus = Number(r.summaInput) / 12;
    const basis = effectiveBasisForRow(r, plan);
    const osa = kulureaOsa(basis, Number(apt.areaM2), koguPind, aptCount);
    if (HALDUSTEENUSED.includes(r.category)) haldus += kuus * osa;
    // Not maintenance — ignored for this focused test.
    if (KOMMUNAALTEENUSED.includes(r.category)) { /* irrelevant here */ }
  }
  return haldus;
}

function mkPlan({ policy, rowJaotusalus }) {
  return {
    building: {
      apartments: [
        { id: "A", label: "A", areaM2: 30 },
        { id: "B", label: "B", areaM2: 70 },
      ],
    },
    budget: {
      costRows: [
        {
          id: "h1",
          category: "Haldus",
          summaInput: 1200,          // €/aasta
          arvutus: "aastas",
          jaotusalus: rowJaotusalus, // legacy, must be ignored for maintenance
        },
      ],
    },
    allocationPolicies: policy,
  };
}

describe("maintenance-tundlike ridade alus tuleb policy-st, mitte r.jaotusalus-est", () => {
  it("r.jaotusalus='korter' kuid policy puudub → alus on m² (pind määrab)", () => {
    const plan = mkPlan({ policy: undefined, rowJaotusalus: "korter" });
    const [a, b] = plan.building.apartments;
    const kogu = 100;
    const haldusA = computeHaldusShareForApt(plan, a, kogu, 2);
    const haldusB = computeHaldusShareForApt(plan, b, kogu, 2);
    // m²-põhine: 30/70
    expect(haldusA / haldusB).toBeCloseTo(30 / 70, 3);
  });

  it("regressioon: policy override 'korter'+legalBasis → haldus jaotub võrdselt, ignoreerides r.jaotusalus='m2'", () => {
    const plan = mkPlan({
      policy: {
        maintenance: {
          defaultBasis: "m2",
          overrideBasis: "korter",
          legalBasis: "pohikiri",
          legalBasisNote: "",
        },
      },
      rowJaotusalus: "m2",
    });
    const [a, b] = plan.building.apartments;
    const kogu = 100;
    const haldusA = computeHaldusShareForApt(plan, a, kogu, 2);
    const haldusB = computeHaldusShareForApt(plan, b, kogu, 2);
    expect(haldusA).toBeCloseTo(haldusB, 6);
  });

  it("mittetundlik rida (kommunaal) kasutab endiselt oma r.jaotusalus väärtust", () => {
    const plan = {
      building: { apartments: [{ id: "A", areaM2: 30 }, { id: "B", areaM2: 70 }] },
      budget: {
        costRows: [
          { id: "k1", category: "Soojus", summaInput: 1200, arvutus: "aastas", jaotusalus: "korter" },
        ],
      },
      allocationPolicies: {
        maintenance: { defaultBasis: "m2", overrideBasis: "korter", legalBasis: "pohikiri" },
      },
    };
    // Kommunaal ei ole maintenance-tundlik → helper tagastab rea enda 'korter' aluse.
    const basis = effectiveBasisForRow(plan.budget.costRows[0], plan);
    expect(basis).toBe("korter");
  });
});
