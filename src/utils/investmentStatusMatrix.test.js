import { describe, it, expect } from "vitest";
import { computePlan } from "../engine/computePlan";
import { investmentStatus } from "./majanduskavaCalc";

// ── Fixtures ──

const basePlan = (investments) => ({
  period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
  building: { apartments: [{ id: "a1", label: "1", areaM2: 50 }] },
  budget: { costRows: [], incomeRows: [] },
  investments: { items: investments },
  funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
  loans: [],
  openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
});

const draftInv = {
  id: "draft-1", name: "", plannedYear: 2026, totalCostEUR: 0,
  sourceType: "standalone", sourceRefId: null, fundingPlan: [],
};

const readyInv = {
  id: "ready-1", name: "Katus", plannedYear: 2026, totalCostEUR: 50000,
  sourceType: "standalone", sourceRefId: null,
  fundingPlan: [{ source: "Remondifond", amountEUR: 50000 }],
};

const blockedInv = {
  id: "blocked-1", name: "Fassaad", plannedYear: 2026, totalCostEUR: 30000,
  sourceType: "standalone", sourceRefId: null,
  fundingPlan: [{ source: "Remondifond", amountEUR: 40000 }], // overfunded
};

// Verify fixture statuses
describe("fixture sanity check", () => {
  it("draftInv is DRAFT", () => expect(investmentStatus(draftInv)).toBe("DRAFT"));
  it("readyInv is READY", () => expect(investmentStatus(readyInv)).toBe("READY"));
  it("blockedInv is BLOCKED", () => expect(investmentStatus(blockedInv)).toBe("BLOCKED"));
});

// ── 1. Aggregate totals / counts ──

describe("aggregate totals: DRAFT excluded, READY and BLOCKED included", () => {
  // Mirrors MajanduskavaApp.jsx aggregate summary:
  //   const counted = plan.investments.items.filter(i => investmentStatus(i) !== "DRAFT");

  const allItems = [draftInv, readyInv, blockedInv];
  const counted = allItems.filter(i => investmentStatus(i) !== "DRAFT");

  it("DRAFT not counted in aggregate item count", () => {
    expect(counted.find(i => i.id === "draft-1")).toBeUndefined();
  });

  it("READY counted in aggregate", () => {
    expect(counted.find(i => i.id === "ready-1")).toBeDefined();
  });

  it("BLOCKED counted in aggregate", () => {
    expect(counted.find(i => i.id === "blocked-1")).toBeDefined();
  });

  it("aggregate count is 2 (READY + BLOCKED), not 3", () => {
    expect(counted.length).toBe(2);
  });

  it("aggregate koguMaksumus excludes DRAFT", () => {
    const koguMaksumus = counted.reduce((s, i) => s + (i.totalCostEUR || 0), 0);
    expect(koguMaksumus).toBe(50000 + 30000); // READY + BLOCKED
  });
});

// ── 2. Recommendations: only READY ──

describe("recommendations: only READY investments produce findings", () => {
  it("READY investment with underfunding produces INV_UNDER", () => {
    const inv = { ...readyInv, fundingPlan: [{ source: "Remondifond", amountEUR: 30000 }] };
    expect(investmentStatus(inv)).toBe("READY"); // still READY (partial funding is valid)
    const derived = computePlan(basePlan([inv]));
    const codes = derived.controls.issues.map(i => i.code);
    expect(codes).toContain("INV_UNDER");
  });

  it("DRAFT investment does not produce INV_COST_ZERO or INV_NAME_MISSING", () => {
    const derived = computePlan(basePlan([draftInv]));
    const codes = derived.controls.issues.map(i => i.code);
    expect(codes).not.toContain("INV_COST_ZERO");
    expect(codes).not.toContain("INV_NAME_MISSING");
  });

  it("BLOCKED investment does not produce INV_OVER", () => {
    const derived = computePlan(basePlan([blockedInv]));
    const codes = derived.controls.issues.map(i => i.code);
    expect(codes).not.toContain("INV_OVER");
  });

  it("mix of DRAFT + BLOCKED produces no investment findings", () => {
    const derived = computePlan(basePlan([draftInv, blockedInv]));
    const invCodes = derived.controls.issues
      .filter(i => i.code.startsWith("INV_") && i.code !== "INV_NONE_THIS_YEAR")
      .map(i => i.code);
    expect(invCodes).toEqual([]);
  });
});

// ── 3. thisYearCount and noteThisYear ──

describe("thisYearCount and noteThisYear based on READY only", () => {
  it("only DRAFT investments: thisYearCount is 0", () => {
    const derived = computePlan(basePlan([draftInv]));
    expect(derived.investments.thisYearCount).toBe(0);
  });

  it("only BLOCKED investments: thisYearCount is 0", () => {
    const derived = computePlan(basePlan([blockedInv]));
    expect(derived.investments.thisYearCount).toBe(0);
  });

  it("one READY investment: thisYearCount is 1", () => {
    const derived = computePlan(basePlan([readyInv]));
    expect(derived.investments.thisYearCount).toBe(1);
  });

  it("mix of all three: thisYearCount counts only READY", () => {
    const derived = computePlan(basePlan([draftInv, readyInv, blockedInv]));
    expect(derived.investments.thisYearCount).toBe(1);
  });

  it("no READY investments: noteThisYear shows validation text", () => {
    const derived = computePlan(basePlan([draftInv, blockedInv]));
    expect(derived.investments.noteThisYear).toBe("Perioodil ei ole valideeritud investeeringuid.");
  });

  it("READY investment present: noteThisYear is null", () => {
    const derived = computePlan(basePlan([readyInv]));
    expect(derived.investments.noteThisYear).toBeNull();
  });

  it("INV_NONE_THIS_YEAR fires when no READY investments exist", () => {
    const derived = computePlan(basePlan([draftInv]));
    const codes = derived.controls.issues.map(i => i.code);
    expect(codes).toContain("INV_NONE_THIS_YEAR");
  });

  it("INV_NONE_THIS_YEAR does not fire when READY investment exists", () => {
    const derived = computePlan(basePlan([readyInv]));
    const codes = derived.controls.issues.map(i => i.code);
    expect(codes).not.toContain("INV_NONE_THIS_YEAR");
  });
});
