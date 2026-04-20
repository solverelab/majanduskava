// src/policy/__tests__/tab5ResetAllocationPolicies.test.js
// Mirrors the `tabIdx === 4` branch of clearSection() in MajanduskavaApp.jsx
// (around line 1577) — only the plan-level return, not the local-state setters.

import { describe, it, expect } from "vitest";
import { defaultPlan, getEffectiveAllocationBasis, patchAllocationPolicy } from "../../domain/planSchema";

function tab5ResetPlan(p) {
  return {
    ...p,
    funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
    loans: [],
    allocationPolicies: defaultPlan().allocationPolicies,
  };
}

describe("Tab 5 reset → allocationPolicies taastub defaulti", () => {
  it("override all three → reset taastab kõik kolm defaulti", () => {
    let plan = defaultPlan();
    plan = patchAllocationPolicy(plan, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri", legalBasisNote: "§12" });
    plan = patchAllocationPolicy(plan, "remondifond", { overrideBasis: "korter", legalBasis: "erikokkulepe", legalBasisNote: "leping" });
    plan = patchAllocationPolicy(plan, "reserve",     { overrideBasis: "korter", legalBasis: "pohikiri" });

    // Veendume, et enne reset'it on override tõesti kehtiv
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.maintenance)).toBe("korter");
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.remondifond)).toBe("korter");
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.reserve)).toBe("korter");

    const reset = tab5ResetPlan(plan);

    for (const key of ["maintenance", "remondifond", "reserve"]) {
      const pol = reset.allocationPolicies[key];
      expect(pol.defaultBasis).toBe("m2");
      expect(pol.overrideBasis).toBe(null);
      expect(pol.legalBasis).toBe(null);
      expect(pol.legalBasisNote).toBe("");
      expect(getEffectiveAllocationBasis(pol)).toBe("m2");
    }
  });

  it("reset'i allikas on defaultPlan() — struktuur peab ühtima", () => {
    const reset = tab5ResetPlan({});
    expect(reset.allocationPolicies).toEqual(defaultPlan().allocationPolicies);
  });

  it("reset ei puutu teisi plaani välju peale funds/loans/allocationPolicies", () => {
    const plan = { ...defaultPlan(), profile: { name: "X" }, building: { apartments: [{ id: "a", areaM2: 50 }] } };
    const reset = tab5ResetPlan(plan);
    expect(reset.profile.name).toBe("X");
    expect(reset.building.apartments).toHaveLength(1);
  });
});
