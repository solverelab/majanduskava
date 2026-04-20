import { describe, it, expect } from "vitest";
import { sortInvestmentsCanonical, compareInvestmentsCanonical } from "./sortInvestments";

// ── Canonical READY investment sort — shared util ──
// Order: plannedYear ASC, totalCostEUR DESC, name ASC

const canonicalSort = sortInvestmentsCanonical;

const inv = (name, plannedYear, totalCostEUR) => ({
  id: `${name}-${plannedYear}`,
  name,
  plannedYear,
  totalCostEUR,
  sourceType: "standalone",
  sourceRefId: null,
  fundingPlan: [{ source: "Remondifond", amountEUR: totalCostEUR }],
});

describe("standalone print table sort (canonical READY order)", () => {
  it("sorts by plannedYear ASC as primary key", () => {
    const items = [
      inv("Katus", 2028, 50000),
      inv("Fassaad", 2026, 30000),
      inv("Aknad", 2027, 40000),
    ];
    const sorted = canonicalSort(items);
    expect(sorted.map(i => i.plannedYear)).toEqual([2026, 2027, 2028]);
  });

  it("within same year, sorts by totalCostEUR DESC", () => {
    const items = [
      inv("Audit", 2026, 5000),
      inv("Katus", 2026, 80000),
      inv("Fassaad", 2026, 30000),
    ];
    const sorted = canonicalSort(items);
    expect(sorted.map(i => i.totalCostEUR)).toEqual([80000, 30000, 5000]);
  });

  it("when plannedYear and totalCostEUR are equal, sorts by name ASC", () => {
    const items = [
      inv("Turvasüsteem", 2027, 10000),
      inv("Energiaaudit", 2027, 10000),
      inv("Lift", 2027, 10000),
    ];
    const sorted = canonicalSort(items);
    expect(sorted.map(i => i.name)).toEqual(["Energiaaudit", "Lift", "Turvasüsteem"]);
  });

  it("full tiebreak: year -> cost -> name", () => {
    const items = [
      inv("Lift", 2027, 10000),
      inv("Katus", 2026, 80000),
      inv("Aknad", 2027, 10000),
      inv("Fassaad", 2026, 30000),
      inv("Audit", 2026, 80000),
    ];
    const sorted = canonicalSort(items);
    expect(sorted.map(i => i.name)).toEqual([
      "Audit",     // 2026, 80000 (A < K)
      "Katus",     // 2026, 80000
      "Fassaad",   // 2026, 30000
      "Aknad",     // 2027, 10000 (A < L)
      "Lift",      // 2027, 10000
    ]);
  });
});

describe("compareInvestmentsCanonical comparator", () => {
  it("returns negative when a.plannedYear < b.plannedYear", () => {
    expect(compareInvestmentsCanonical(inv("A", 2026, 1000), inv("B", 2027, 1000))).toBeLessThan(0);
  });

  it("returns positive when a.totalCostEUR < b.totalCostEUR (DESC)", () => {
    expect(compareInvestmentsCanonical(inv("A", 2026, 1000), inv("B", 2026, 5000))).toBeGreaterThan(0);
  });

  it("returns negative when a.name < b.name and year/cost equal", () => {
    expect(compareInvestmentsCanonical(inv("Aknad", 2026, 1000), inv("Katus", 2026, 1000))).toBeLessThan(0);
  });

  it("returns 0 for identical fields", () => {
    expect(compareInvestmentsCanonical(inv("A", 2026, 1000), inv("A", 2026, 1000))).toBe(0);
  });
});

describe("editable standalone list stays in insertion order", () => {
  it("no-sort filter preserves original array order", () => {
    // Mirrors MajanduskavaApp.jsx editable list: .filter(...).map(...)  — no .sort()
    const items = [
      inv("Lift", 2028, 10000),
      inv("Audit", 2026, 5000),
      inv("Katus", 2027, 80000),
    ];
    const editable = items.filter(i => i.sourceType === "standalone");
    expect(editable.map(i => i.name)).toEqual(["Lift", "Audit", "Katus"]);
  });
});
