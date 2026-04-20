// src/domain/patchAllocationPolicy.test.js
import { describe, it, expect } from "vitest";
import {
  patchAllocationPolicy,
  getEffectiveAllocationBasis,
  defaultPlan,
} from "./planSchema";

describe("patchAllocationPolicy", () => {
  it("override OFF (default) → policy jääb m2 + nullid", () => {
    const plan = defaultPlan();
    const mkp = plan.allocationPolicies.maintenance;
    expect(mkp.overrideBasis).toBe(null);
    expect(mkp.legalBasis).toBe(null);
    expect(mkp.legalBasisNote).toBe("");
    expect(getEffectiveAllocationBasis(mkp)).toBe("m2");
  });

  it('override ON + legalBasis="pohikiri" + overrideBasis="korter" → state salvestub õigesti ja efektiivne alus on korter', () => {
    let plan = defaultPlan();
    plan = patchAllocationPolicy(plan, "maintenance", { overrideBasis: "korter" });
    plan = patchAllocationPolicy(plan, "maintenance", { legalBasis: "pohikiri", legalBasisNote: "§12 lg 3" });
    const m = plan.allocationPolicies.maintenance;
    expect(m.overrideBasis).toBe("korter");
    expect(m.legalBasis).toBe("pohikiri");
    expect(m.legalBasisNote).toBe("§12 lg 3");
    expect(getEffectiveAllocationBasis(m)).toBe("korter");
  });

  it("override ON, legalBasis puudub → helper fallback jääb m2 (neutraalne seis)", () => {
    let plan = defaultPlan();
    plan = patchAllocationPolicy(plan, "maintenance", { overrideBasis: "korter" });
    // legalBasis endiselt null
    expect(plan.allocationPolicies.maintenance.overrideBasis).toBe("korter");
    expect(plan.allocationPolicies.maintenance.legalBasis).toBe(null);
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.maintenance)).toBe("m2");
  });

  it("turn OFF → tühjendab override, legalBasis, legalBasisNote", () => {
    let plan = defaultPlan();
    plan = patchAllocationPolicy(plan, "maintenance", {
      overrideBasis: "korter", legalBasis: "pohikiri", legalBasisNote: "§12",
    });
    // Simuleerime UI toggle OFF: kogu kolmik tühjendatakse
    plan = patchAllocationPolicy(plan, "maintenance", {
      overrideBasis: null, legalBasis: null, legalBasisNote: "",
    });
    const m = plan.allocationPolicies.maintenance;
    expect(m.overrideBasis).toBe(null);
    expect(m.legalBasis).toBe(null);
    expect(m.legalBasisNote).toBe("");
    expect(getEffectiveAllocationBasis(m)).toBe("m2");
  });

  it("reserve policy käitub sama mustri järgi (sõltumatu remondifond/maintenance'ist)", () => {
    let plan = defaultPlan();
    plan = patchAllocationPolicy(plan, "reserve", { overrideBasis: "korter", legalBasis: "erikokkulepe" });
    const r = plan.allocationPolicies.reserve;
    const m = plan.allocationPolicies.maintenance;
    expect(getEffectiveAllocationBasis(r)).toBe("korter");
    expect(getEffectiveAllocationBasis(m)).toBe("m2");
  });

  it("allocationPolicies puudub plaanis → patch loob struktuuri üles", () => {
    const plan = { profile: { name: "X" } };
    const patched = patchAllocationPolicy(plan, "remondifond", { overrideBasis: "korter", legalBasis: "pohikiri" });
    expect(patched.allocationPolicies.remondifond.overrideBasis).toBe("korter");
    expect(patched.allocationPolicies.remondifond.legalBasis).toBe("pohikiri");
    expect(patched.allocationPolicies.remondifond.defaultBasis).toBe("m2");
  });
});
