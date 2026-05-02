import { describe, it, expect } from "vitest";
import { computeReserveMin, computeRemondifondiArvutus, KOMMUNAALTEENUSED } from "./majanduskavaCalc";

// ── Helpers: simulate useEffect updaters (same logic as App.jsx) ─────────────

// Reserve auto-fill: sets plannedEUR = noutavMiinimum when !resKapManual
function applyReserveAutoFill(plan, reserveMin, resKapManual) {
  if (resKapManual) return plan;
  const min = reserveMin.noutavMiinimum;
  return {
    ...plan,
    funds: { ...plan.funds, reserve: { ...plan.funds.reserve, plannedEUR: min } },
  };
}

// RepairFund sync: sets monthlyRateEurPerM2 = maarAastasM2 / 12
function applyRepairFundSync(plan, maarAastasM2) {
  const kuuMaar = maarAastasM2 / 12;
  if (plan.funds.repairFund.monthlyRateEurPerM2 === kuuMaar) return plan;
  return { ...plan, funds: { ...plan.funds, repairFund: { monthlyRateEurPerM2: kuuMaar } } };
}

// Cost sync: syncs summaInput → calc.params.amountEUR
function applyCostSync(plan, arvutaHaldusSumma) {
  let changed = false;
  const updated = plan.budget.costRows.map(r => {
    let summa;
    if (KOMMUNAALTEENUSED.includes(r.category)) {
      summa = parseFloat(r.summaInput) || 0;
    } else if (r.arvutus !== undefined) {
      summa = arvutaHaldusSumma(r);
    } else {
      return r;
    }
    if (r.calc.params.amountEUR !== summa) {
      changed = true;
      return { ...r, calc: { type: "FIXED_PERIOD", params: { amountEUR: summa } } };
    }
    return r;
  });
  return changed ? { ...plan, budget: { ...plan.budget, costRows: updated } } : plan;
}

// Income sync: same pattern
function applyIncomeSync(plan, arvutaHaldusSumma) {
  let changed = false;
  const updated = plan.budget.incomeRows.map(r => {
    if (r.arvutus === undefined) return r;
    const summa = arvutaHaldusSumma(r);
    if (r.calc.params.amountEUR !== summa) {
      changed = true;
      return { ...r, calc: { type: "FIXED_PERIOD", params: { amountEUR: summa } } };
    }
    return r;
  });
  return changed ? { ...plan, budget: { ...plan.budget, incomeRows: updated } } : plan;
}

// Orphan cleanup
function applyOrphanCleanup(plan) {
  const orphanLoanIds = plan.loans
    .filter(l => l.sepiiriostudInvId)
    .filter(l => {
      const inv = plan.investments.items.find(i =>
        i.sourceRefId === l.sepiiriostudInvId || i.id === l.sepiiriostudInvId
      );
      if (!inv) return true;
      return !(inv.fundingPlan || []).some(fp => fp.source === "Laen");
    })
    .map(l => l.id);
  if (orphanLoanIds.length === 0) return plan;
  return { ...plan, loans: plan.loans.filter(l => !orphanLoanIds.includes(l.id)) };
}

// Year propagation
function applyYearPropagation(plan, year) {
  if (!year) return plan;
  const ys = String(year);
  const items = plan.assetCondition?.items || [];
  const updatedItems = items.map(e =>
    (!e.tegevusAasta || e.tegevusAasta === "") ? { ...e, tegevusAasta: ys } : e
  );
  const itemsChanged = updatedItems.some((e, i) => e !== items[i]);

  const updatedLoans = plan.loans.map(l =>
    (!l.algusAasta || l.algusAasta === "") ? { ...l, algusAasta: ys } : l
  );
  const loansChanged = updatedLoans.some((l, i) => l !== plan.loans[i]);

  if (!itemsChanged && !loansChanged) return plan;
  return {
    ...plan,
    assetCondition: itemsChanged ? { ...plan.assetCondition, items: updatedItems } : plan.assetCondition,
    loans: loansChanged ? updatedLoans : plan.loans,
  };
}

// Simple arvutaHaldusSumma for testing (monthEq=12)
function mkHaldusSumma(monthEq = 12) {
  return (r) => {
    const val = parseFloat(r.summaInput) || 0;
    switch (r.arvutus) {
      case "kuus": return val * monthEq;
      case "aastas": return val / 12 * monthEq;
      case "perioodis": return val;
      default: return val * monthEq;
    }
  };
}

// ── 1. Reserve auto-fill ─────────────────────────────────────────────────────

describe("reservi auto-täitmine", () => {
  const basePlan = {
    budget: { costRows: [{ summaInput: "1200" }] },
    funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
  };

  it("täidab reservi automaatselt kui resKapManual=false", () => {
    const reserveMin = computeReserveMin(basePlan.budget.costRows, 12);
    const result = applyReserveAutoFill(basePlan, reserveMin, false);
    expect(result.funds.reserve.plannedEUR).toBe(100); // 1200/12
  });

  it("EI kirjuta üle kui resKapManual=true", () => {
    const planWithManual = {
      ...basePlan,
      funds: { ...basePlan.funds, reserve: { plannedEUR: 500 } },
    };
    const reserveMin = computeReserveMin(basePlan.budget.costRows, 12);
    const result = applyReserveAutoFill(planWithManual, reserveMin, true);
    expect(result.funds.reserve.plannedEUR).toBe(500); // unchanged
    expect(result).toBe(planWithManual); // same reference — no mutation
  });
});

// ── 2. RepairFund sync ───────────────────────────────────────────────────────

describe("remondifondi määra sünkroon", () => {
  it("uuendab monthlyRateEurPerM2 kui maarAastasM2 muutub", () => {
    const plan = { funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: {} } };
    const result = applyRepairFundSync(plan, 24); // 24/12 = 2
    expect(result.funds.repairFund.monthlyRateEurPerM2).toBe(2);
  });

  it("ei tee muudatust kui väärtus on juba sama (idempotentne)", () => {
    const plan = { funds: { repairFund: { monthlyRateEurPerM2: 2 }, reserve: {} } };
    const result = applyRepairFundSync(plan, 24);
    expect(result).toBe(plan); // same reference — no new object
  });

  it("korduv rakendamine annab sama tulemuse", () => {
    const plan = { funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: {} } };
    const r1 = applyRepairFundSync(plan, 24);
    const r2 = applyRepairFundSync(r1, 24);
    expect(r2).toBe(r1); // second call is no-op
  });
});

// ── 3. Cost sync ─────────────────────────────────────────────────────────────

describe("costRows calc.params.amountEUR sünkroon", () => {
  const haldusSumma = mkHaldusSumma(12);

  it("sünkroonib summaInput → amountEUR kui need erinevad", () => {
    const plan = {
      budget: {
        costRows: [{
          category: "Haldus", summaInput: "1200", arvutus: "aastas",
          calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } },
        }],
        incomeRows: [],
      },
    };
    const result = applyCostSync(plan, haldusSumma);
    expect(result.budget.costRows[0].calc.params.amountEUR).toBe(1200);
  });

  it("ei tee muudatust kui amountEUR on juba õige", () => {
    const plan = {
      budget: {
        costRows: [{
          category: "Haldus", summaInput: "1200", arvutus: "aastas",
          calc: { type: "FIXED_PERIOD", params: { amountEUR: 1200 } },
        }],
        incomeRows: [],
      },
    };
    const result = applyCostSync(plan, haldusSumma);
    expect(result).toBe(plan); // same reference
  });

  it("korduv rakendamine on idempotentne", () => {
    const plan = {
      budget: {
        costRows: [{
          category: "Haldus", summaInput: "600", arvutus: "perioodis",
          calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } },
        }],
        incomeRows: [],
      },
    };
    const r1 = applyCostSync(plan, haldusSumma);
    const r2 = applyCostSync(r1, haldusSumma);
    expect(r2).toBe(r1); // second pass is no-op
  });
});

// ── 4. Income sync ───────────────────────────────────────────────────────────

describe("incomeRows calc.params.amountEUR sünkroon", () => {
  const haldusSumma = mkHaldusSumma(12);

  it("sünkroonib summaInput → amountEUR kui need erinevad", () => {
    const plan = {
      budget: {
        costRows: [],
        incomeRows: [{
          summaInput: "100", arvutus: "kuus",
          calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } },
        }],
      },
    };
    const result = applyIncomeSync(plan, haldusSumma);
    expect(result.budget.incomeRows[0].calc.params.amountEUR).toBe(1200); // 100*12
  });

  it("ei tee muudatust kui amountEUR on juba õige", () => {
    const plan = {
      budget: {
        costRows: [],
        incomeRows: [{
          summaInput: "100", arvutus: "kuus",
          calc: { type: "FIXED_PERIOD", params: { amountEUR: 1200 } },
        }],
      },
    };
    const result = applyIncomeSync(plan, haldusSumma);
    expect(result).toBe(plan);
  });
});

// ── 5. Orphan cleanup ────────────────────────────────────────────────────────

describe("orphan cleanup", () => {
  it("eemaldab ainult päris orphan-laenu", () => {
    const plan = {
      investments: {
        items: [{
          id: "inv-1", sourceRefId: "r1",
          fundingPlan: [{ source: "Laen", amountEUR: 10000 }],
        }],
      },
      loans: [
        { id: "valid-loan", sepiiriostudInvId: "r1" },    // valid — inv exists with Laen
        { id: "orphan-loan", sepiiriostudInvId: "gone" },  // orphan — inv missing
        { id: "manual-loan", sepiiriostudInvId: null },     // manual — not linked
      ],
    };
    const result = applyOrphanCleanup(plan);
    expect(result.loans.find(l => l.id === "valid-loan")).toBeDefined();
    expect(result.loans.find(l => l.id === "orphan-loan")).toBeUndefined();
    expect(result.loans.find(l => l.id === "manual-loan")).toBeDefined();
  });

  it("ei tee muudatust kui orphane pole (idempotentne)", () => {
    const plan = {
      investments: {
        items: [{
          id: "inv-1", sourceRefId: "r1",
          fundingPlan: [{ source: "Laen", amountEUR: 10000 }],
        }],
      },
      loans: [{ id: "valid", sepiiriostudInvId: "r1" }],
    };
    const result = applyOrphanCleanup(plan);
    expect(result).toBe(plan); // same reference
  });

  it("halts after one pass (no infinite loop)", () => {
    const plan = {
      investments: { items: [] },
      loans: [{ id: "orphan", sepiiriostudInvId: "gone" }],
    };
    const r1 = applyOrphanCleanup(plan);
    expect(r1.loans).toHaveLength(0);
    const r2 = applyOrphanCleanup(r1);
    expect(r2).toBe(r1); // second pass is no-op
  });
});

// ── 6. Year propagation ─────────────────────────────────────────────────────

describe("perioodi aasta propageerimine", () => {
  it("täidab tühjad tegevusAasta väljad", () => {
    const plan = {
      assetCondition: { items: [
        { id: "1", tegevusAasta: "" },
        { id: "2", tegevusAasta: "2025" },
      ]},
      loans: [
        { id: "l1", algusAasta: "" },
        { id: "l2", algusAasta: "2024" },
      ],
    };
    const result = applyYearPropagation(plan, 2027);
    expect(result.assetCondition.items[0].tegevusAasta).toBe("2027");
    expect(result.assetCondition.items[1].tegevusAasta).toBe("2025"); // unchanged
    expect(result.loans[0].algusAasta).toBe("2027");
    expect(result.loans[1].algusAasta).toBe("2024"); // unchanged
  });

  it("ei kirjuta olemasolevaid aastaid üle", () => {
    const plan = {
      assetCondition: { items: [{ id: "1", tegevusAasta: "2025" }] },
      loans: [{ id: "l1", algusAasta: "2024" }],
    };
    const result = applyYearPropagation(plan, 2027);
    expect(result).toBe(plan); // same reference — nothing changed
  });
});

// ── 7. Auto-add idempotency ─────────────────────────────────────────────────

describe("auto-add effect idempotency", () => {
  // Simulate: if items.length > 0, do nothing; if 0, add one
  function applyAutoAdd(items) {
    if (items.length > 0) return items;
    return [{ id: "auto-1", value: "" }];
  }

  it("ei tekita topeltridu korduvate kutsete korral", () => {
    const empty = [];
    const r1 = applyAutoAdd(empty);
    expect(r1).toHaveLength(1);
    const r2 = applyAutoAdd(r1);
    expect(r2).toBe(r1); // same reference — guard caught it
    expect(r2).toHaveLength(1);
  });

  it("ei muuda olemasolevaid ridu", () => {
    const existing = [{ id: "x", value: "data" }];
    const result = applyAutoAdd(existing);
    expect(result).toBe(existing);
  });
});
