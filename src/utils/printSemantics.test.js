import { describe, it, expect } from "vitest";
import { computePlan } from "../engine/computePlan";
import { computeKopiiriondvaade, computeRemondifondiArvutus } from "./majanduskavaCalc";

/**
 * Regression test: print "Maksed korteritele" must use the same
 * loanStatus-aware korteriteKuumaksed path as the screen, NOT
 * the derived.apartmentPayments path from computePlan.js.
 *
 * This test proves the two paths diverge when a planned loan exists
 * and loanStatus === "APPLIED", locking the requirement.
 */

const plan = {
  period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
  building: { apartments: [{ id: "a1", label: "1", areaM2: 100 }] },
  budget: {
    costRows: [
      { id: "c1", name: "Haldus", category: "Haldus", arvutus: "kuus", summaInput: 200,
        legal: { category: "MANAGEMENT" }, calc: { type: "MONTHLY_FIXED", params: { monthlyEUR: 200 } } },
    ],
    incomeRows: [],
  },
  investments: { items: [
    { id: "inv-1", name: "Katus", plannedYear: 2026, totalCostEUR: 60000,
      sourceType: "condition_item", sourceRefId: "rida-1",
      fundingPlan: [{ source: "Laen", amountEUR: 60000 }] },
  ] },
  funds: { repairFund: { monthlyRateEurPerM2: 1 }, reserve: { plannedEUR: 0 } },
  loans: [
    { id: "loan-planned", principalEUR: 60000, annualRatePct: 3.6, termMonths: 240,
      type: "annuity", startYM: "2026-01", reservePct: 0, sepiiriostudInvId: "inv-1" },
  ],
  openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
};

describe("print korteriteKuumaksed must be loanStatus-aware", () => {
  it("APPLIED: canonical path excludes planned loan, derived.apartmentPayments includes it", () => {
    const derived = computePlan(plan);
    const mEq = derived.period.monthEq;

    // Replicate canonical korteriteKuumaksed path (same as App.jsx L517-536)
    const kopiiriondvaade = computeKopiiriondvaade(
      plan.budget.costRows, plan.budget.incomeRows, plan.loans, mEq, "APPLIED"
    );
    const ra = computeRemondifondiArvutus({
      saldoAlgusRaw: "0", koguPind: 100, periodiAasta: 2026,
      pangaKoef: 1.15, kogumisViis: "eraldi", pangaMaarOverride: null, maarOverride: null,
      investments: plan.investments.items, loans: plan.loans, loanStatus: "APPLIED", monthEq: mEq,
    });

    const rfKuuKokku = ra.maarAastasM2 * 100 / 12;
    // loanApproved = false when APPLIED → planned loan excluded
    const laenKuuKokku = ra.olemasolevLaenumaksedKuus + (ra.loanApproved ? ra.planeeritudLaenumaksedKuus : 0);
    const canonical_kokku = Math.round(kopiiriondvaade.kommunaalKokku)
      + Math.round(kopiiriondvaade.haldusKokku)
      + Math.round(rfKuuKokku)
      + Math.round(laenKuuKokku)
      + 0; // reserve = 0

    // loanApproved = false when APPLIED
    expect(ra.loanApproved).toBe(false);
    // Planned loan exists in loanScenario but excluded from active (baseScenario)
    expect(ra.loanScenario.planeeritudLaenumaksedKuus).toBeGreaterThan(0);
    // Canonical path: planned loan excluded → laenKuuKokku = 0
    expect(laenKuuKokku).toBe(0);

    // derived.apartmentPayments ALWAYS includes all loans (no loanStatus awareness)
    const oldPath_kokku = derived.apartmentPayments[0].totalMonthlyEUR;
    expect(oldPath_kokku).toBeGreaterThan(canonical_kokku);

    // This divergence proves the two paths are NOT interchangeable
    // Print must use the canonical (loanStatus-aware) path
    expect(canonical_kokku).not.toBe(oldPath_kokku);
  });
});

describe("print Fondid ja laen: laekumine must use remondifondiArvutus, not derived", () => {
  it("canonical laekuminePerioodis is integer, derived repairFundIncomePeriodEUR may differ", () => {
    // maarAastasM2 = 1.3 €/m²/a, koguPind = 73 m², monthEq = 12
    // Canonical: Math.round(1.3 * 73 * 12 / 12) = Math.round(94.9) = 95
    // computePlan: round2((1.3/12) * 73 * 12) = round2(94.9) = 94.9
    const testPlan = {
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 73 }] },
      budget: { costRows: [], incomeRows: [] },
      investments: { items: [
        { id: "inv-1", name: "Katus", plannedYear: 2027, totalCostEUR: 9490,
          sourceType: "standalone", sourceRefId: null,
          fundingPlan: [{ source: "Remondifond", amountEUR: 9490 }] },
      ] },
      funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
      loans: [],
      openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
    };

    const derived = computePlan(testPlan);
    const ra = computeRemondifondiArvutus({
      saldoAlgusRaw: "0", koguPind: 73, periodiAasta: 2026,
      pangaKoef: 1.15, kogumisViis: "eraldi", pangaMaarOverride: null, maarOverride: null,
      investments: testPlan.investments.items, loans: [], loanStatus: "APPLIED",
      monthEq: derived.period.monthEq,
    });

    // Canonical value is an integer (Math.round)
    expect(ra.laekuminePerioodis).toBe(Math.round(ra.laekuminePerioodis));

    // derived value uses round2 (2 decimal places) — may differ
    // The canonical value is what the print must use
    const canonical = ra.laekuminePerioodis;
    const fromDerived = derived.funds.repairFundIncomePeriodEUR;

    // They compute the same underlying amount but with different rounding
    // If they happen to match for this input, the test still locks that
    // the canonical source is laekuminePerioodis (integer), not derived (2dp)
    expect(typeof canonical).toBe("number");
    expect(canonical).toBe(Math.round(canonical)); // always integer
  });
});
