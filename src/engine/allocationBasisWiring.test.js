// src/engine/allocationBasisWiring.test.js
import { describe, it, expect } from "vitest";
import { computePlan } from "./computePlan";
import { defaultPlan, mkApartment, getEffectiveAllocationBasis } from "../domain/planSchema";

function mkPlanWithTwoApartments(overrides = {}) {
  const plan = defaultPlan({ year: 2026 });
  plan.period.start = "2026-01-01";
  plan.period.end = "2026-12-31";
  plan.building.apartments = [
    mkApartment({ label: "A", areaM2: 30 }),
    mkApartment({ label: "B", areaM2: 70 }),
  ];
  plan.budget.costRows = [
    {
      id: "c1",
      side: "COST",
      name: "Haldus",
      category: "",
      jaotusalus: "m2",
      legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
      calc: { type: "ANNUAL_FIXED", params: { annualEUR: 1200 } },
    },
  ];
  plan.funds.repairFund.monthlyRateEurPerM2 = 1;
  return { ...plan, ...overrides };
}

describe("allocationPolicies → computePlan wiring", () => {
  it("maintenance policy puudub → haldus/hooldus jaotub m² põhjal", () => {
    const plan = mkPlanWithTwoApartments();
    plan.allocationPolicies = undefined;
    const res = computePlan(plan);
    const [a, b] = res.apartmentPayments;
    // A:B area ratio = 30:70 → operational ratio must match
    expect(a.operationalMonthlyEUR + b.operationalMonthlyEUR).toBeGreaterThan(0);
    expect(a.operationalMonthlyEUR / b.operationalMonthlyEUR).toBeCloseTo(30 / 70, 3);
  });

  it('maintenance overrideBasis="korter" + legalBasis="pohikiri" → jaotub korteri kaupa', () => {
    const plan = mkPlanWithTwoApartments();
    plan.allocationPolicies.maintenance.overrideBasis = "korter";
    plan.allocationPolicies.maintenance.legalBasis = "pohikiri";
    const res = computePlan(plan);
    const [a, b] = res.apartmentPayments;
    expect(a.operationalMonthlyEUR).toBeCloseTo(b.operationalMonthlyEUR, 2);
  });

  it("remondifond override puudub → jääb m² (rate × areaM2)", () => {
    const plan = mkPlanWithTwoApartments();
    // maintenance.m2 default, remondifond.m2 default
    const res = computePlan(plan);
    const [a, b] = res.apartmentPayments;
    // rfRate=1, so A = 30, B = 70
    expect(a.repairFundMonthlyEUR).toBeCloseTo(30, 2);
    expect(b.repairFundMonthlyEUR).toBeCloseTo(70, 2);
  });

  it('reserve overrideBasis="korter" ilma legalBasis → effektiivne alus jääb m2', () => {
    const plan = mkPlanWithTwoApartments();
    plan.allocationPolicies.reserve.overrideBasis = "korter";
    plan.allocationPolicies.reserve.legalBasis = null;
    expect(getEffectiveAllocationBasis(plan.allocationPolicies.reserve)).toBe("m2");
  });

  it('maintenance overrideBasis="apartment" + legalBasis="pohikiri" → jaotub korteri kaupa (sama mis "korter")', () => {
    const planKorter = mkPlanWithTwoApartments();
    planKorter.allocationPolicies.maintenance.overrideBasis = "korter";
    planKorter.allocationPolicies.maintenance.legalBasis = "pohikiri";

    const planApartment = mkPlanWithTwoApartments();
    planApartment.allocationPolicies.maintenance.overrideBasis = "apartment";
    planApartment.allocationPolicies.maintenance.legalBasis = "pohikiri";

    const resK = computePlan(planKorter);
    const resA = computePlan(planApartment);
    expect(resA.apartmentPayments[0].operationalMonthlyEUR).toBeCloseTo(resK.apartmentPayments[0].operationalMonthlyEUR, 5);
    expect(resA.apartmentPayments[1].operationalMonthlyEUR).toBeCloseTo(resK.apartmentPayments[1].operationalMonthlyEUR, 5);
  });

  it('"apartment" korral jagatakse summa korterite arvuga võrdselt', () => {
    const plan = mkPlanWithTwoApartments();
    plan.allocationPolicies.maintenance.overrideBasis = "apartment";
    plan.allocationPolicies.maintenance.legalBasis = "pohikiri";
    const res = computePlan(plan);
    const [a, b] = res.apartmentPayments;
    expect(a.operationalMonthlyEUR).toBeCloseTo(b.operationalMonthlyEUR, 2);
  });

  it('"apartment" remondifondis → jaotub korteri kaupa (sama mis "korter")', () => {
    const planKorter = mkPlanWithTwoApartments();
    planKorter.allocationPolicies.remondifond.overrideBasis = "korter";
    planKorter.allocationPolicies.remondifond.legalBasis = "pohikiri";

    const planApartment = mkPlanWithTwoApartments();
    planApartment.allocationPolicies.remondifond.overrideBasis = "apartment";
    planApartment.allocationPolicies.remondifond.legalBasis = "pohikiri";

    const resK = computePlan(planKorter);
    const resA = computePlan(planApartment);
    expect(resA.apartmentPayments[0].repairFundMonthlyEUR).toBeCloseTo(resK.apartmentPayments[0].repairFundMonthlyEUR, 5);
    expect(resA.apartmentPayments[1].repairFundMonthlyEUR).toBeCloseTo(resK.apartmentPayments[1].repairFundMonthlyEUR, 5);
  });

  it('"m2" alus jääb pindalapõhiseks — "apartment" ei mõjuta m² jaotust', () => {
    const plan = mkPlanWithTwoApartments();
    // vaikimisi m2, ei seta overrideBasis-i
    const res = computePlan(plan);
    const [a, b] = res.apartmentPayments;
    expect(a.operationalMonthlyEUR / b.operationalMonthlyEUR).toBeCloseTo(30 / 70, 3);
  });

  it('regressioon: ainult toggle ON (overrideBasis="korter", legalBasis=null) ei muuda computePlan väljundit', () => {
    // Kasutaja avab erandi UI ('toggle ON') aga ei ole veel alust kinnitanud.
    // State sisaldab overrideBasis="korter" + legalBasis=null → arithmetic peab jääma
    // bit-täpselt samaks kui vaikeseisus.
    const base = mkPlanWithTwoApartments();
    const toggleOnly = JSON.parse(JSON.stringify(base));
    toggleOnly.allocationPolicies.maintenance.overrideBasis = "korter";
    toggleOnly.allocationPolicies.maintenance.legalBasis = null;
    toggleOnly.allocationPolicies.remondifond.overrideBasis = "korter";
    toggleOnly.allocationPolicies.remondifond.legalBasis = null;
    toggleOnly.allocationPolicies.reserve.overrideBasis = "korter";
    toggleOnly.allocationPolicies.reserve.legalBasis = null;
    const r1 = computePlan(base);
    const r2 = computePlan(toggleOnly);
    expect(r2.apartmentPayments).toEqual(r1.apartmentPayments);
    expect(r2.totals).toEqual(r1.totals);
    expect(r2.funds).toEqual(r1.funds);
  });
});
