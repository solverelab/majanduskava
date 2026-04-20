import { describe, it, expect } from "vitest";
import { computePlan } from "../engine/computePlan";
import { investmentStatus } from "./majanduskavaCalc";

/**
 * Regression tests: monthly/outflow calculations use ALL thisYearItems,
 * NOT filtered by investmentStatus. This is a deliberate design decision.
 *
 * thisYearCount / noteThisYear = READY only
 * costThisYearEUR / outflows   = all statuses (thisYearItems)
 *
 * These tests lock that divergence so no one accidentally "unifies" the filters.
 */

const basePlan = (investments) => ({
  period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
  building: { apartments: [{ id: "a1", label: "1", areaM2: 50 }] },
  budget: { costRows: [], incomeRows: [] },
  investments: { items: investments },
  funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
  loans: [],
  openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
});

// DRAFT: no name, zero cost — contributes 0 to outflows by math
const draftInv = {
  id: "draft-1", name: "", plannedYear: 2026, totalCostEUR: 0,
  sourceType: "standalone", sourceRefId: null, fundingPlan: [],
};

// READY: full cost, RF funding
const readyInv = {
  id: "ready-1", name: "Katus", plannedYear: 2026, totalCostEUR: 50000,
  sourceType: "standalone", sourceRefId: null,
  fundingPlan: [{ source: "Remondifond", amountEUR: 50000 }],
};

// BLOCKED: overfunded, has RF funding that flows into outflows
const blockedInv = {
  id: "blocked-1", name: "Fassaad", plannedYear: 2026, totalCostEUR: 30000,
  sourceType: "standalone", sourceRefId: null,
  fundingPlan: [{ source: "Remondifond", amountEUR: 40000 }],
};

// Sanity
describe("fixture statuses", () => {
  it("draftInv is DRAFT", () => expect(investmentStatus(draftInv)).toBe("DRAFT"));
  it("readyInv is READY", () => expect(investmentStatus(readyInv)).toBe("READY"));
  it("blockedInv is BLOCKED", () => expect(investmentStatus(blockedInv)).toBe("BLOCKED"));
});

// ── costThisYearEUR includes all statuses ──

describe("costThisYearEUR includes all thisYearItems", () => {
  it("DRAFT investment cost included in costThisYearEUR", () => {
    const draftWithCost = { ...draftInv, totalCostEUR: 5000 };
    // This is still DRAFT (no name) but cost > 0
    expect(investmentStatus(draftWithCost)).toBe("DRAFT");
    const derived = computePlan(basePlan([readyInv, draftWithCost]));
    expect(derived.investments.costThisYearEUR).toBe(50000 + 5000);
  });

  it("BLOCKED investment cost included in costThisYearEUR", () => {
    const derived = computePlan(basePlan([readyInv, blockedInv]));
    expect(derived.investments.costThisYearEUR).toBe(50000 + 30000);
  });
});

// ── rfOutflowThisYearEUR includes all statuses ──

describe("rfOutflowThisYearEUR includes all thisYearItems", () => {
  it("READY RF funding flows into outflow", () => {
    const derived = computePlan(basePlan([readyInv]));
    expect(derived.investments.rfOutflowThisYearEUR).toBe(50000);
  });

  it("BLOCKED RF funding flows into outflow (not filtered out)", () => {
    const derived = computePlan(basePlan([blockedInv]));
    expect(derived.investments.rfOutflowThisYearEUR).toBe(40000);
  });

  it("READY + BLOCKED: outflow sums both", () => {
    const derived = computePlan(basePlan([readyInv, blockedInv]));
    expect(derived.investments.rfOutflowThisYearEUR).toBe(50000 + 40000);
  });

  it("READY + DRAFT: outflow sums both (DRAFT contributes 0 by math)", () => {
    const derived = computePlan(basePlan([readyInv, draftInv]));
    // draftInv has empty fundingPlan → 0 RF outflow
    expect(derived.investments.rfOutflowThisYearEUR).toBe(50000);
  });
});

// ── Divergence: thisYearCount vs outflows on same fixture ──

describe("thisYearCount (READY only) vs outflows (all) diverge correctly", () => {
  it("READY + BLOCKED: count=1, but outflow includes both", () => {
    const derived = computePlan(basePlan([readyInv, blockedInv]));
    expect(derived.investments.thisYearCount).toBe(1);       // only READY
    expect(derived.investments.costThisYearEUR).toBe(80000); // both
    expect(derived.investments.rfOutflowThisYearEUR).toBe(90000); // both
  });

  it("READY + DRAFT: count=1, costThisYearEUR includes DRAFT cost", () => {
    const draftWithCost = { ...draftInv, totalCostEUR: 7000 };
    const derived = computePlan(basePlan([readyInv, draftWithCost]));
    expect(derived.investments.thisYearCount).toBe(1);        // only READY
    expect(derived.investments.costThisYearEUR).toBe(57000);  // both
  });

  it("only BLOCKED: count=0, noteThisYear set, but outflow still present", () => {
    const derived = computePlan(basePlan([blockedInv]));
    expect(derived.investments.thisYearCount).toBe(0);
    expect(derived.investments.noteThisYear).toBe("Perioodil ei ole valideeritud investeeringuid.");
    expect(derived.investments.rfOutflowThisYearEUR).toBe(40000); // not zero
  });

  it("only DRAFT: count=0, noteThisYear set, outflow is 0 by math", () => {
    const derived = computePlan(basePlan([draftInv]));
    expect(derived.investments.thisYearCount).toBe(0);
    expect(derived.investments.noteThisYear).toBe("Perioodil ei ole valideeritud investeeringuid.");
    expect(derived.investments.rfOutflowThisYearEUR).toBe(0); // 0 by math, not by filter
    expect(derived.investments.costThisYearEUR).toBe(0);      // 0 by math
  });
});

// ── RF closing balance: opening + income - outflow ──

describe("repairFundClosingEUR aligns with UI canonical path", () => {
  it("closing = opening + income - Remondifond outflow", () => {
    // Scenario: opening 5000, rfRate 2 €/m²/kuu, 50 m², 12 months
    // → income = 2 * 50 * 12 = 1200
    // Investment: 80000 funded by Remondifond
    // → outflow = 80000
    // → closing = 5000 + 1200 - 80000 = -73800
    const plan = {
      ...basePlan([{
        id: "inv-rf", name: "Katus", plannedYear: 2026, totalCostEUR: 80000,
        sourceType: "standalone", sourceRefId: null,
        fundingPlan: [{ source: "Remondifond", amountEUR: 80000 }],
      }]),
      funds: { repairFund: { monthlyRateEurPerM2: 2 }, reserve: { plannedEUR: 0 } },
      openingBalances: { repairFundEUR: 5000, reserveEUR: 0 },
    };
    const derived = computePlan(plan);
    expect(derived.funds.repairFundClosingEUR).toBe(-73800);
  });

  it("negative closing triggers RF_NEG finding", () => {
    const plan = {
      ...basePlan([{
        id: "inv-rf", name: "Katus", plannedYear: 2026, totalCostEUR: 80000,
        sourceType: "standalone", sourceRefId: null,
        fundingPlan: [{ source: "Remondifond", amountEUR: 80000 }],
      }]),
      funds: { repairFund: { monthlyRateEurPerM2: 2 }, reserve: { plannedEUR: 0 } },
      openingBalances: { repairFundEUR: 5000, reserveEUR: 0 },
    };
    const derived = computePlan(plan);
    const rfNeg = derived.controls.issues.find(i => i.code === "RF_NEG");
    expect(rfNeg).toBeDefined();
    expect(rfNeg.severity).toBe("ERROR");
  });
});

// ── Loan outflow: "Laen" vocabulary active ──

describe("loanOutflowThisYearEUR uses canonical Laen vocabulary", () => {
  it("fundingPlan source Laen flows into loanOutflowThisYearEUR", () => {
    const plan = basePlan([{
      id: "inv-loan", name: "Fassaad", plannedYear: 2026, totalCostEUR: 60000,
      sourceType: "standalone", sourceRefId: null,
      fundingPlan: [{ source: "Laen", amountEUR: 60000 }],
    }]);
    const derived = computePlan(plan);
    expect(derived.investments.loanOutflowThisYearEUR).toBe(60000);
  });

  it("no Model B loan findings for Laen entry without loanId", () => {
    const plan = basePlan([{
      id: "inv-loan", name: "Fassaad", plannedYear: 2026, totalCostEUR: 60000,
      sourceType: "standalone", sourceRefId: null,
      fundingPlan: [{ source: "Laen", amountEUR: 60000 }],
      // NB: no loanId field — Model B validation removed
    }]);
    const derived = computePlan(plan);
    const loanCodes = derived.controls.issues
      .filter(i => ["INV_LOAN_NO_ID", "INV_LOAN_NOT_FOUND", "INV_LOAN_OVER_PRINCIPAL"].includes(i.code));
    expect(loanCodes).toHaveLength(0);
  });
});

// ── Single-year snapshot: future-year investments excluded (design rule) ──

describe("closing balance is single-year snapshot", () => {
  it("future-year investment does not affect repairFundClosingEUR", () => {
    // Period year: 2026. Two investments:
    // - 2026: 20000 Remondifond → deducted from closing
    // - 2028: 80000 Remondifond → NOT deducted (future year)
    // Opening 5000, rfRate 2 €/m²/kuu, 50 m², 12 months → income 1200
    // Closing = 5000 + 1200 - 20000 = -13800 (only 2026 outflow)
    const plan = {
      ...basePlan([
        {
          id: "inv-now", name: "Aknad", plannedYear: 2026, totalCostEUR: 20000,
          sourceType: "standalone", sourceRefId: null,
          fundingPlan: [{ source: "Remondifond", amountEUR: 20000 }],
        },
        {
          id: "inv-future", name: "Katus", plannedYear: 2028, totalCostEUR: 80000,
          sourceType: "standalone", sourceRefId: null,
          fundingPlan: [{ source: "Remondifond", amountEUR: 80000 }],
        },
      ]),
      funds: { repairFund: { monthlyRateEurPerM2: 2 }, reserve: { plannedEUR: 0 } },
      openingBalances: { repairFundEUR: 5000, reserveEUR: 0 },
    };
    const derived = computePlan(plan);
    // Only 2026 investment's 20000 is deducted, not 2028's 80000
    expect(derived.investments.rfOutflowThisYearEUR).toBe(20000);
    expect(derived.funds.repairFundClosingEUR).toBe(-13800);
  });
});
