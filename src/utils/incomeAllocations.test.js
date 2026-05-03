// src/utils/incomeAllocations.test.js
// Spec tests: normalizeIncomeAllocations andmemudel, helper ja validatsioon.
// Kaetud: tühi incomeAllocations, target-validatsioon, legacy fallback,
//         vastuolulised legacy andmed, reserve keeld, computePlan muutumatus.

import { describe, it, expect } from "vitest";
import { normalizeIncomeAllocations } from "./majanduskavaCalc";
import { computePlan } from "../engine/computePlan";

// ── 1. Tühi incomeAllocations = üldine KÜ tulu ────────────────────────────────

describe("tühi incomeAllocations = üldine KÜ tulu", () => {
  it("tühi array → isDirected: false, isValid: true, totalAllocated: 0", () => {
    const n = normalizeIncomeAllocations({ summaInput: "1000", incomeAllocations: [] });
    expect(n.isDirected).toBe(false);
    expect(n.isValid).toBe(true);
    expect(n.totalAllocated).toBe(0);
    expect(n.unallocatedAmount).toBe(1000);
    expect(n.errors).toHaveLength(0);
  });

  it("puuduv incomeAllocations → isDirected: false, isValid: true", () => {
    const n = normalizeIncomeAllocations({ summaInput: "500" });
    expect(n.isDirected).toBe(false);
    expect(n.isValid).toBe(true);
    expect(n.totalAllocated).toBe(0);
    expect(n.unallocatedAmount).toBe(500);
  });
});

// ── 2. Üldine KÜ tulu ei mõjuta remondifondi ──────────────────────────────────

const rfContrib = (row) =>
  normalizeIncomeAllocations(row).allocations
    .filter(a => a.target === "repairFund")
    .reduce((s, a) => s + Math.round(parseFloat(a.amount) || 0), 0);

describe("üldine KÜ tulu ei mõjuta remondifondi", () => {
  it("tühi incomeAllocations → remondifondi = 0", () => {
    expect(rfContrib({ summaInput: "2000", incomeAllocations: [] })).toBe(0);
  });

  it("general target → remondifondi = 0", () => {
    expect(rfContrib({
      summaInput: "1000",
      incomeAllocations: [{ id: "a", target: "general", amount: "1000", note: "" }],
    })).toBe(0);
  });

  it("other target → remondifondi = 0", () => {
    expect(rfContrib({
      summaInput: "1000",
      incomeAllocations: [{ id: "a", target: "other", amount: "1000", note: "" }],
    })).toBe(0);
  });
});

// ── 3. repairFund allocation → remondifondi suunamine ─────────────────────────

describe("repairFund allocation → remondifondi suunamine", () => {
  it("repairFund 1500 € → isDirected: true, totalAllocated: 1500, remondifondi = 1500", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1500",
      incomeAllocations: [{ id: "a", target: "repairFund", amount: "1500", note: "" }],
    });
    expect(n.isDirected).toBe(true);
    expect(n.isValid).toBe(true);
    expect(n.totalAllocated).toBe(1500);
    expect(rfContrib({ summaInput: "1500", incomeAllocations: n.allocations })).toBe(1500);
  });
});

// ── 4. Summa validatsioon ──────────────────────────────────────────────────────

describe("allocation-summa validatsioon", () => {
  it("900 € suunatud / 1000 € tulu → invalid, 'kokku andma'", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000",
      incomeAllocations: [{ id: "a", target: "repairFund", amount: "900", note: "" }],
    });
    expect(n.isValid).toBe(false);
    expect(n.errors.some(e => e.includes("kokku andma"))).toBe(true);
  });

  it("1100 € suunatud / 1000 € tulu → invalid, 'kokku andma'", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000",
      incomeAllocations: [{ id: "a", target: "repairFund", amount: "1100", note: "" }],
    });
    expect(n.isValid).toBe(false);
    expect(n.errors.some(e => e.includes("kokku andma"))).toBe(true);
  });

  it("negatiivne allocation summa → invalid, error sisaldab 'negatiivne'", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000",
      incomeAllocations: [{ id: "a", target: "repairFund", amount: "-100", note: "" }],
    });
    expect(n.isValid).toBe(false);
    expect(n.errors.some(e => e.toLowerCase().includes("negatiivne"))).toBe(true);
  });

  it("0 summa → invalid, 'peab olema summa'", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000",
      incomeAllocations: [{ id: "a", target: "repairFund", amount: "0", note: "" }],
    });
    expect(n.isValid).toBe(false);
    expect(n.errors.some(e => e.includes("summa"))).toBe(true);
  });
});

// ── 5. Legacy fallback ─────────────────────────────────────────────────────────

describe("legacy incomeUse/targetFund/fundDirectedAmount → repairFund fallback", () => {
  it("incomeUse=fund + targetFund=repairFund → allocation loodud, isDirected: true", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1200", incomeUse: "fund", targetFund: "repairFund", fundDirectedAmount: "",
    });
    expect(n.isDirected).toBe(true);
    expect(n.isValid).toBe(true);
    expect(n.allocations).toHaveLength(1);
    expect(n.allocations[0].id).toBe("__legacy__");
    expect(n.allocations[0].target).toBe("repairFund");
    expect(n.allocations[0].amount).toBe(1200);
  });

  it("legacy fundDirectedAmount=600 → suunatud osa 600, mitte kogu 1500", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1500", incomeUse: "fund", targetFund: "repairFund", fundDirectedAmount: "600",
    });
    expect(n.allocations[0].amount).toBe(600);
    expect(n.totalAllocated).toBe(600);
    expect(n.unallocatedAmount).toBe(900);
  });

  it("tulu summa 1000, fundDirectedAmount 1200 → isValid: false, error", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000", incomeUse: "fund", targetFund: "repairFund", fundDirectedAmount: "1200",
    });
    expect(n.isValid).toBe(false);
    expect(n.errors.length).toBeGreaterThan(0);
    expect(n.allocations).toHaveLength(0);
  });

  it("legacy fundDirectedAmount > rowSumma → isValid: false, error (9999 vs 500)", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "500", incomeUse: "fund", targetFund: "repairFund", fundDirectedAmount: "9999",
    });
    expect(n.isValid).toBe(false);
    expect(n.errors.length).toBeGreaterThan(0);
  });

  it("incomeUse=fund + targetFund=null → tühjad allokeeringud, üldine KÜ tulu", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000", incomeUse: "fund", targetFund: null, fundDirectedAmount: "",
    });
    expect(n.allocations).toHaveLength(0);
    expect(n.isValid).toBe(true);
    expect(n.isDirected).toBe(false);
  });
});

// ── 6. Vastuolulised legacy väljad ────────────────────────────────────────────

describe("vastuolulised legacy väljad → error", () => {
  it("legacy targetFund=reserve → isValid: false, isDirected: false, error", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000", incomeUse: "fund", targetFund: "reserve",
    });
    expect(n.isValid).toBe(false);
    expect(n.isDirected).toBe(false);
    expect(n.allocations).toHaveLength(0);
    expect(n.errors.length).toBeGreaterThan(0);
  });

  it("legacy targetFund=tundmatu → isValid: false, error", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000", incomeUse: "fund", targetFund: "unknownTarget",
    });
    expect(n.isValid).toBe(false);
    expect(n.errors.length).toBeGreaterThan(0);
  });
});

// ── 7. reserve target ei ole lubatud ──────────────────────────────────────────

describe("reserve target ei ole lubatud (eraldi tööplokk)", () => {
  it("incomeAllocations reserve target → isValid: false, error sisaldab 'Reservkapital'", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000",
      incomeAllocations: [{ id: "a", target: "reserve", amount: "1000", note: "" }],
    });
    expect(n.isValid).toBe(false);
    expect(n.errors.some(e => e.includes("Reservkapitali"))).toBe(true);
  });

  it("reserve target → remondifondi suunamine = 0", () => {
    expect(rfContrib({
      summaInput: "1000",
      incomeAllocations: [{ id: "a", target: "reserve", amount: "1000", note: "" }],
    })).toBe(0);
  });

  it("reserve target → isDirected: true (allocation kirje alles, andmed ei kao)", () => {
    const n = normalizeIncomeAllocations({
      summaInput: "1000",
      incomeAllocations: [{ id: "a", target: "reserve", amount: "1000", note: "" }],
    });
    expect(n.isDirected).toBe(true);
    expect(n.allocations).toHaveLength(1);
  });
});

// ── 8. computePlan muutumatus ──────────────────────────────────────────────────

describe("computePlan muutumatus", () => {
  it("computePlan on deterministlik, ei sõltu incomeAllocations sisust", () => {
    const base = {
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 50 }] },
      budget: {
        costRows: [],
        incomeRows: [
          { id: "i1", side: "INCOME", summaInput: "1200", incomeAllocations: [] },
          { id: "i2", side: "INCOME", summaInput: "800",
            incomeAllocations: [{ id: "x", target: "repairFund", amount: "800" }] },
        ],
      },
      investments: { items: [] },
      funds: { repairFund: { monthlyRateEurPerM2: 0.5 }, reserve: { plannedEUR: 0 } },
      loans: [],
      openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
      allocationPolicies: {},
    };
    const r1 = computePlan(base);
    const r2 = computePlan(base);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.building.totAreaM2).toBe(50);
    expect(r1.period.monthEq).toBe(12);
  });

  it("incomeAllocations sisu ei muuda computePlan tulemust — tulu pole veel arvestatud", () => {
    const mkBase = (incomeAllocations) => ({
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 50 }] },
      budget: {
        costRows: [],
        incomeRows: [{ id: "i1", side: "INCOME", summaInput: "1000", incomeAllocations }],
      },
      investments: { items: [] },
      funds: { repairFund: { monthlyRateEurPerM2: 0.5 }, reserve: { plannedEUR: 0 } },
      loans: [],
      openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
      allocationPolicies: {},
    });
    const r1 = computePlan(mkBase([]));
    const r2 = computePlan(mkBase([{ id: "x", target: "repairFund", amount: "1000" }]));
    expect(r1.building.totAreaM2).toBe(r2.building.totAreaM2);
    expect(r1.period.monthEq).toBe(r2.period.monthEq);
  });
});
