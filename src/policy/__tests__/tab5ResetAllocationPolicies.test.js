// src/policy/__tests__/tab5ResetAllocationPolicies.test.js
// Mirrors the `tabIdx === 4` branch of clearSection() in MajanduskavaApp.jsx
// (Tab 4 = Fondid) — only the plan-level return, not the local-state setters.
// clearSection(4) resets funds and allocationPolicies but does NOT touch loans.

import { describe, it, expect } from "vitest";
import { defaultPlan, getEffectiveAllocationBasis, patchAllocationPolicy } from "../../domain/planSchema";

function fondiTabResetPlan(p) {
  return {
    ...p,
    funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
    allocationPolicies: defaultPlan().allocationPolicies,
  };
}

describe("Tab 4 (Fondid) reset → allocationPolicies taastub defaulti, laenud jäävad", () => {
  it("override all three → reset taastab kõik kolm defaulti", () => {
    let plan = defaultPlan();
    plan = patchAllocationPolicy(plan, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri", legalBasisNote: "§12" });
    plan = patchAllocationPolicy(plan, "remondifond", { overrideBasis: "korter", legalBasis: "erikokkulepe", legalBasisNote: "leping" });
    plan = patchAllocationPolicy(plan, "reserve",     { overrideBasis: "korter", legalBasis: "pohikiri" });

    // Veendume, et enne reset'it on override tõesti kehtiv
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.maintenance)).toBe("korter");
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.remondifond)).toBe("korter");
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.reserve)).toBe("korter");

    const reset = fondiTabResetPlan(plan);

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
    const reset = fondiTabResetPlan({});
    expect(reset.allocationPolicies).toEqual(defaultPlan().allocationPolicies);
  });

  it("reset ei puutu teisi plaani välju peale funds/allocationPolicies — laenud jäävad", () => {
    const plan = {
      ...defaultPlan(),
      profile: { name: "X" },
      building: { apartments: [{ id: "a", areaM2: 50 }] },
      loans: [{ id: "loan-1", sepiiriostudInvId: "inv-1", principalEUR: 25000 }],
    };
    const reset = fondiTabResetPlan(plan);
    expect(reset.profile.name).toBe("X");
    expect(reset.building.apartments).toHaveLength(1);
    expect(reset.loans).toHaveLength(1);
  });
});
