import { describe, it, expect } from "vitest";
import { computePlan } from "./computePlan";

// ══════════════════════════════════════════════════════════════════════
// computePlan p2 RF-väljavoolu filtri invariandid
//
// p2RfOutflowEUR = fundingSource==="remondifond" ja
//                  !KOMMUNAALTEENUSED && !LAENUMAKSED
// rfOutflowThisYearEUR = invRfOutflowThisYearEUR + p2RfOutflowEUR
// ══════════════════════════════════════════════════════════════════════

function mkPlan({ rfOpening = 0, costRows = [], invItems = [] } = {}) {
  return {
    period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
    building: { apartments: [{ id: "a1", label: "1", areaM2: 100 }] },
    openingBalances: { repairFundEUR: rfOpening, reserveEUR: 0 },
    funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
    budget: { costRows, incomeRows: [] },
    investments: { items: invItems },
    loans: [],
  };
}

function mkRow(category, fundingSource, amountEUR) {
  return {
    id: String(Math.random()),
    category,
    fundingSource,
    legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
    calc: { type: "FIXED_PERIOD", params: { amountEUR } },
  };
}

// ── 1. Mitte-kommunaal RF-rida suurendab rfOutflowThisYearEUR-i ───────

describe("p2 RF mitte-kommunaal kulu suurendab rfOutflowThisYearEUR-i", () => {
  it("haldusrida fundingSource=remondifond → rfOutflowThisYearEUR suureneb", () => {
    const plan = mkPlan({
      rfOpening: 20000,
      costRows: [mkRow("Haldus", "remondifond", 5000)],
    });
    const r = computePlan(plan);
    expect(r.investments.p2RfOutflowEUR).toBe(5000);
    expect(r.investments.rfOutflowThisYearEUR).toBe(5000);
    expect(r.funds.repairFundClosingEUR).toBe(15000);
  });

  it("Tab1 + p2 mitte-kommunaal kumuleeruvad rfOutflowThisYearEUR-s", () => {
    const inv = {
      id: "i1", name: "Katus", plannedYear: 2026, totalCostEUR: 8000, status: "READY",
      fundingPlan: [{ source: "Remondifond", amountEUR: 8000 }],
    };
    const plan = mkPlan({
      rfOpening: 20000,
      invItems: [inv],
      costRows: [mkRow("Haldus", "remondifond", 3000)],
    });
    const r = computePlan(plan);
    expect(r.investments.invRfOutflowThisYearEUR).toBe(8000);
    expect(r.investments.p2RfOutflowEUR).toBe(3000);
    expect(r.investments.rfOutflowThisYearEUR).toBe(11000);
  });
});

// ── 2. Kommunaalrida ei suurenda rfOutflowThisYearEUR-i ───────────────

describe("p2 RF kommunaal ei suurenda rfOutflowThisYearEUR-i", () => {
  const KOMMUNAAL_CATEGORIES = [
    "Soojus", "Vesi", "Kanalisatsioon", "Elekter", "Kütus", "Muu kommunaalteenus",
  ];

  for (const cat of KOMMUNAAL_CATEGORIES) {
    it(`kommunaalrida "${cat}" fundingSource=remondifond → p2RfOutflowEUR=0`, () => {
      const plan = mkPlan({
        rfOpening: 10000,
        costRows: [mkRow(cat, "remondifond", 4000)],
      });
      const r = computePlan(plan);
      expect(r.investments.p2RfOutflowEUR).toBe(0);
      expect(r.investments.rfOutflowThisYearEUR).toBe(0);
      expect(r.funds.repairFundClosingEUR).toBe(10000);
    });
  }
});

// ── 3. Laenumakserida ei suurenda rfOutflowThisYearEUR-i ─────────────

describe("p2 RF laenumakse ei suurenda rfOutflowThisYearEUR-i", () => {
  it('laenumakserida ("Laenumakse") fundingSource=remondifond → p2RfOutflowEUR=0', () => {
    const plan = mkPlan({
      rfOpening: 10000,
      costRows: [mkRow("Laenumakse", "remondifond", 6000)],
    });
    const r = computePlan(plan);
    expect(r.investments.p2RfOutflowEUR).toBe(0);
    expect(r.investments.rfOutflowThisYearEUR).toBe(0);
    expect(r.funds.repairFundClosingEUR).toBe(10000);
  });
});

// ── 4. RF_NEG kasutab uut rfOutflowThisYearEUR-i ─────────────────────

describe("RF_NEG kasutab p2-d sisaldavat rfOutflowThisYearEUR-i", () => {
  it("p2 RF-kulu tekitab negatiivse saldo → RF_NEG", () => {
    const plan = mkPlan({
      rfOpening: 3000,
      costRows: [mkRow("Haldus", "remondifond", 5000)],
    });
    const r = computePlan(plan);
    expect(r.funds.repairFundClosingEUR).toBe(-2000);
    expect(r.controls.issues.some(i => i.code === "RF_NEG")).toBe(true);
  });

  it("kommunaal RF-rida sama summaga ei tekita RF_NEG", () => {
    const plan = mkPlan({
      rfOpening: 3000,
      costRows: [mkRow("Soojus", "remondifond", 5000)],
    });
    const r = computePlan(plan);
    expect(r.funds.repairFundClosingEUR).toBe(3000);
    expect(r.controls.issues.some(i => i.code === "RF_NEG")).toBe(false);
  });

  it("laenumakse RF-rida sama summaga ei tekita RF_NEG", () => {
    const plan = mkPlan({
      rfOpening: 3000,
      costRows: [mkRow("Laenumakse", "remondifond", 5000)],
    });
    const r = computePlan(plan);
    expect(r.funds.repairFundClosingEUR).toBe(3000);
    expect(r.controls.issues.some(i => i.code === "RF_NEG")).toBe(false);
  });
});
