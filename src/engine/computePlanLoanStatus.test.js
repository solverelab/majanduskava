import { describe, it, expect } from "vitest";
import { computePlan } from "./computePlan";

// ══════════════════════════════════════════════════════════════════════
// computePlan laenustaatuse invariandid
//
// loanStatus parameeter computePlan-ile:
//   "APPLIED"  → baseLoans = loans.filter(l => !l.sepiiriostudInvId)
//   "APPROVED" → baseLoans = loans (kõik)
//
// baseLoans → loanServicePeriodEUR, reserveRequiredEUR, OWNERS_BURDEN_*
// allLoans  → totalLoanMonthlyEUR, LOAN_BURDEN_* (§36)
// ══════════════════════════════════════════════════════════════════════

function mkPlan({ loans = [], costRows = [] } = {}) {
  return {
    period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
    building: { apartments: [{ id: "a1", label: "1", areaM2: 100 }] },
    openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
    funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 10000 } },
    budget: { costRows, incomeRows: [] },
    investments: { items: [] },
    loans,
  };
}

function mkExistingLoan(principalEUR) {
  return {
    id: "existing-1",
    sepiiriostudInvId: null,
    principalEUR,
    annualRatePct: 5,
    termMonths: 120,
    type: "annuity",
    startYM: "2024-01",
    reservePct: 0,
  };
}

function mkPlannedLoan(principalEUR) {
  return {
    id: "planned-1",
    sepiiriostudInvId: "inv-ref-123",
    principalEUR,
    annualRatePct: 5,
    termMonths: 120,
    type: "annuity",
    startYM: "2026-01",
    reservePct: 0,
  };
}

// ── 1. APPLIED: planeeritav laen ei suurenda loanServicePeriodEUR ─────

describe("APPLIED: planeeritav laen ei mõjuta loanServicePeriodEUR", () => {
  it("sepiiriostudInvId laen APPLIED-is → loanServicePeriodEUR = 0", () => {
    const plan = mkPlan({ loans: [mkPlannedLoan(50000)] });
    const r = computePlan(plan, { loanStatus: "APPLIED" });
    expect(r.loans.servicePeriodEUR).toBe(0);
    expect(r.loans.serviceMonthlyEUR).toBe(0);
  });

  it("APPLIED + mõlemad laenud → servicePeriodEUR võrdub ainult olemasolevaga", () => {
    const plan = mkPlan({ loans: [mkExistingLoan(20000), mkPlannedLoan(50000)] });
    const baseline = computePlan(mkPlan({ loans: [mkExistingLoan(20000)] }), { loanStatus: "APPLIED" });
    const r = computePlan(plan, { loanStatus: "APPLIED" });
    expect(r.loans.servicePeriodEUR).toBe(baseline.loans.servicePeriodEUR);
    expect(r.loans.servicePeriodEUR).toBeGreaterThan(0);
  });
});

// ── 2. Olemasolev laen on APPLIED-is baseLoans hulgas ─────────────────

describe("olemasolev laen (sepiiriostudInvId=null) on APPLIED korral sees", () => {
  it("APPLIED + olemasolev laen → loanServicePeriodEUR > 0", () => {
    const plan = mkPlan({ loans: [mkExistingLoan(30000)] });
    const r = computePlan(plan, { loanStatus: "APPLIED" });
    expect(r.loans.servicePeriodEUR).toBeGreaterThan(0);
  });
});

// ── 3. APPROVED: planeeritav laen läheb loanServicePeriodEUR-i ────────

describe("APPROVED: planeeritav laen lisandub loanServicePeriodEUR-i", () => {
  it("APPROVED → planeeritud laen sees, APPLIED → mitte", () => {
    const plan = mkPlan({ loans: [mkPlannedLoan(50000)] });
    const approved = computePlan(plan, { loanStatus: "APPROVED" });
    const applied = computePlan(plan, { loanStatus: "APPLIED" });
    expect(approved.loans.servicePeriodEUR).toBeGreaterThan(0);
    expect(applied.loans.servicePeriodEUR).toBe(0);
  });

  it("APPROVED + mõlemad laenud → servicePeriodEUR = olemasolev + planeeritud", () => {
    const plan = mkPlan({ loans: [mkExistingLoan(20000), mkPlannedLoan(50000)] });
    const onlyExisting = computePlan(mkPlan({ loans: [mkExistingLoan(20000)] }), { loanStatus: "APPROVED" });
    const onlyPlanned = computePlan(mkPlan({ loans: [mkPlannedLoan(50000)] }), { loanStatus: "APPROVED" });
    const both = computePlan(plan, { loanStatus: "APPROVED" });
    expect(both.loans.servicePeriodEUR).toBeCloseTo(
      onlyExisting.loans.servicePeriodEUR + onlyPlanned.loans.servicePeriodEUR, 1
    );
  });
});

// ── 4. APPLIED planeeritav laen ei mõjuta RESERVE_LOW / OWNERS_BURDEN ─

describe("APPLIED planeeritav laen ei mõjuta RESERVE_LOW ega OWNERS_BURDEN", () => {
  it("planeeritav laen APPLIED-is ei suurenda reserveRequiredEUR", () => {
    const withPlanned = computePlan(mkPlan({ loans: [mkPlannedLoan(80000)] }), { loanStatus: "APPLIED" });
    const withoutLoans = computePlan(mkPlan({ loans: [] }), { loanStatus: "APPLIED" });
    expect(withPlanned.funds.reserveRequiredEUR).toBe(withoutLoans.funds.reserveRequiredEUR);
  });

  it("planeeritav laen APPLIED-is ei lisa OWNERS_BURDEN_* leidu", () => {
    const plan = mkPlan({ loans: [mkPlannedLoan(500000)] });
    const r = computePlan(plan, { loanStatus: "APPLIED" });
    expect(r.controls.issues.some(i => i.code === "OWNERS_BURDEN_HIGH")).toBe(false);
    expect(r.controls.issues.some(i => i.code === "OWNERS_BURDEN_WARN")).toBe(false);
  });

  it("sama laen APPROVED-s tekitab OWNERS_BURDEN hoiatuse", () => {
    const plan = mkPlan({ loans: [mkPlannedLoan(500000)] });
    const r = computePlan(plan, { loanStatus: "APPROVED" });
    const hasBurden = r.controls.issues.some(
      i => i.code === "OWNERS_BURDEN_HIGH" || i.code === "OWNERS_BURDEN_WARN"
    );
    expect(hasBurden).toBe(true);
  });
});

// ── 5. APPLIED planeeritav laen jääb LOAN_BURDEN_* (§36) kontrolli ───

describe("APPLIED planeeritav laen jääb LOAN_BURDEN_* §36 kontrolli", () => {
  it("APPLIED + suur planeeritav laen → LOAN_BURDEN_HIGH tuleneb allLoanItems-ist", () => {
    const plan = mkPlan({ loans: [mkPlannedLoan(500000)] });
    const r = computePlan(plan, { loanStatus: "APPLIED" });
    // loanServicePeriodEUR = 0 (base), aga loanBurdenEurPerM2 > 0 (all)
    expect(r.loans.servicePeriodEUR).toBe(0);
    expect(r.risks.loanBurdenEurPerM2).toBeGreaterThan(0);
    expect(r.controls.issues.some(i => i.code === "LOAN_BURDEN_HIGH")).toBe(true);
  });

  it("olemasolev suur laen APPLIED-s annab samuti LOAN_BURDEN hoiatuse", () => {
    const plan = mkPlan({ loans: [mkExistingLoan(500000)] });
    const r = computePlan(plan, { loanStatus: "APPLIED" });
    const hasBurden = r.controls.issues.some(
      i => i.code === "LOAN_BURDEN_HIGH" || i.code === "LOAN_BURDEN_WARN"
    );
    expect(hasBurden).toBe(true);
  });

  it("APPLIED: loanBurdenEurPerM2 on suurem kui base scenario ownersNeedEurPerM2 laenuosa", () => {
    const plan = mkPlan({ loans: [mkPlannedLoan(50000)] });
    const r = computePlan(plan, { loanStatus: "APPLIED" });
    // ownersNeedMonthlyEUR ei sisalda planeeritud laenu (base = 0)
    // totalLoanMonthlyEUR sisaldab planeeritud laenu (all)
    expect(r.risks.totalLoanMonthlyEUR).toBeGreaterThan(0);
    expect(r.loans.serviceMonthlyEUR).toBe(0);
  });
});
