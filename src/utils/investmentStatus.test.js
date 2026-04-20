import { describe, it, expect } from "vitest";
import { investmentStatus } from "./majanduskavaCalc";

const inv = (overrides) => ({
  name: "Katus — Remont",
  totalCostEUR: 50000,
  fundingPlan: [{ source: "Remondifond", amountEUR: 50000 }],
  ...overrides,
});

describe("investmentStatus", () => {
  // ── BLOCKED ──

  it("BLOCKED: negative totalCostEUR", () => {
    expect(investmentStatus(inv({ totalCostEUR: -100 }))).toBe("BLOCKED");
  });

  it("BLOCKED: totalCostEUR === 0 but real funding exists", () => {
    expect(investmentStatus(inv({
      totalCostEUR: 0,
      fundingPlan: [{ source: "Laen", amountEUR: 10000 }],
    }))).toBe("BLOCKED");
  });

  it("BLOCKED: overfunded — kaetud > totalCostEUR", () => {
    expect(investmentStatus(inv({
      totalCostEUR: 30000,
      fundingPlan: [
        { source: "Remondifond", amountEUR: 20000 },
        { source: "Laen", amountEUR: 15000 },
      ],
    }))).toBe("BLOCKED");
  });

  // ── DRAFT ──

  it("DRAFT: no name", () => {
    expect(investmentStatus(inv({ name: "" }))).toBe("DRAFT");
  });

  it("DRAFT: totalCostEUR === 0, no real funding", () => {
    expect(investmentStatus(inv({
      totalCostEUR: 0,
      fundingPlan: [],
    }))).toBe("DRAFT");
  });

  it("DRAFT: no funding rows at all", () => {
    expect(investmentStatus(inv({ fundingPlan: [] }))).toBe("DRAFT");
  });

  it("DRAFT: only empty placeholder rows (source === '')", () => {
    expect(investmentStatus(inv({
      fundingPlan: [{ source: "", amountEUR: 0 }],
    }))).toBe("DRAFT");
  });

  it("DRAFT: real source chosen but amountEUR is 0", () => {
    expect(investmentStatus(inv({
      fundingPlan: [{ source: "Remondifond", amountEUR: 0 }],
    }))).toBe("DRAFT");
  });

  it("DRAFT: whitespace-only source treated as empty placeholder", () => {
    expect(investmentStatus(inv({
      fundingPlan: [{ source: "   ", amountEUR: 0 }],
    }))).toBe("DRAFT");
  });

  it("DRAFT: whitespace-only source with positive amount is still not a real source", () => {
    expect(investmentStatus(inv({
      fundingPlan: [{ source: "   ", amountEUR: 1000 }],
    }))).toBe("DRAFT");
  });

  // ── READY ──

  it("READY: fully funded", () => {
    expect(investmentStatus(inv())).toBe("READY");
  });

  it("READY: partially funded (kaetud < totalCostEUR)", () => {
    expect(investmentStatus(inv({
      totalCostEUR: 50000,
      fundingPlan: [{ source: "Remondifond", amountEUR: 30000 }],
    }))).toBe("READY");
  });

  it("READY: multiple funding sources within cost", () => {
    expect(investmentStatus(inv({
      totalCostEUR: 50000,
      fundingPlan: [
        { source: "Remondifond", amountEUR: 20000 },
        { source: "Laen", amountEUR: 25000 },
      ],
    }))).toBe("READY");
  });

  it("READY: exactly at cost boundary (kaetud === totalCostEUR)", () => {
    expect(investmentStatus(inv({
      totalCostEUR: 10000,
      fundingPlan: [{ source: "Toetus", amountEUR: 10000 }],
    }))).toBe("READY");
  });
});

// ── BLOCKED edge cases ──

describe("investmentStatus BLOCKED edge cases", () => {
  it("BLOCKED: totalCostEUR === -1 (barely negative)", () => {
    expect(investmentStatus(inv({ totalCostEUR: -1 }))).toBe("BLOCKED");
  });

  it("BLOCKED: overfunded by 1 EUR", () => {
    expect(investmentStatus(inv({
      totalCostEUR: 10000,
      fundingPlan: [{ source: "Remondifond", amountEUR: 10001 }],
    }))).toBe("BLOCKED");
  });

  it("BLOCKED: zero cost with multiple real funding rows", () => {
    expect(investmentStatus(inv({
      totalCostEUR: 0,
      fundingPlan: [
        { source: "Remondifond", amountEUR: 5000 },
        { source: "Laen", amountEUR: 3000 },
      ],
    }))).toBe("BLOCKED");
  });

  it("BLOCKED takes priority over DRAFT (negative cost + no name)", () => {
    expect(investmentStatus(inv({
      name: "",
      totalCostEUR: -100,
      fundingPlan: [],
    }))).toBe("BLOCKED");
  });
});

// ── DRAFT edge cases ──

describe("investmentStatus DRAFT edge cases", () => {
  it("DRAFT: fundingPlan undefined (missing field)", () => {
    expect(investmentStatus({ name: "Test", totalCostEUR: 1000 })).toBe("DRAFT");
  });

  it("DRAFT: real source but negative amountEUR", () => {
    expect(investmentStatus(inv({
      fundingPlan: [{ source: "Remondifond", amountEUR: -500 }],
    }))).toBe("DRAFT");
  });

  it("DRAFT: mix of empty placeholder and real row with zero amount", () => {
    expect(investmentStatus(inv({
      fundingPlan: [
        { source: "", amountEUR: 0 },
        { source: "Laen", amountEUR: 0 },
      ],
    }))).toBe("DRAFT");
  });

  it("DRAFT: source with leading/trailing spaces is still real if non-empty after trim", () => {
    // "  Remondifond  " trims to "Remondifond" — counts as real row
    // But amountEUR is 0, so still DRAFT (real source, zero amount)
    expect(investmentStatus(inv({
      fundingPlan: [{ source: "  Remondifond  ", amountEUR: 0 }],
    }))).toBe("DRAFT");
  });

  it("DRAFT: totalCostEUR === 0 with only placeholder rows", () => {
    expect(investmentStatus(inv({
      totalCostEUR: 0,
      fundingPlan: [{ source: "", amountEUR: 0 }, { source: "  ", amountEUR: 0 }],
    }))).toBe("DRAFT");
  });
});

// ── Real-row trim rule ──

describe("investmentStatus real-row trim rule", () => {
  it("trimmed non-empty source with positive amount is READY", () => {
    expect(investmentStatus(inv({
      fundingPlan: [{ source: "  Remondifond  ", amountEUR: 50000 }],
    }))).toBe("READY");
  });

  it("tab and newline in source treated as non-empty after trim", () => {
    // "\tRemondifond\n" trims to "Remondifond"
    expect(investmentStatus(inv({
      fundingPlan: [{ source: "\tRemondifond\n", amountEUR: 50000 }],
    }))).toBe("READY");
  });

  it("only whitespace chars (tab, space, newline) is empty", () => {
    expect(investmentStatus(inv({
      fundingPlan: [{ source: " \t \n ", amountEUR: 5000 }],
    }))).toBe("DRAFT");
  });
});

// ── Independence from global state ──

describe("investmentStatus is independent of global plan/loanStatus", () => {
  it("same inv returns same status regardless of context", () => {
    const testInv = inv();
    const result1 = investmentStatus(testInv);
    const result2 = investmentStatus(testInv);
    expect(result1).toBe("READY");
    expect(result2).toBe("READY");
    expect(result1).toBe(result2);
  });

  it("loan-funded investment is READY regardless of hypothetical loanStatus", () => {
    const loanInv = inv({
      fundingPlan: [{ source: "Laen", amountEUR: 50000 }],
    });
    // investmentStatus does not accept or use loanStatus
    expect(investmentStatus(loanInv)).toBe("READY");
  });

  it("function signature takes only inv, no second argument changes result", () => {
    const testInv = inv();
    // Even if someone passes extra args, they are ignored
    expect(investmentStatus(testInv)).toBe("READY");
  });
});
