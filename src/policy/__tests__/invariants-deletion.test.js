// src/policy/__tests__/invariants-deletion.test.js
import { describe, it, expect } from "vitest";
import { cleanupOrphanLinkedLoans } from "../../utils/planCleanup";
import { KOMMUNAALTEENUSED } from "../../utils/majanduskavaCalc";

// ── Helpers ──

/** Mirrors removeLoan (lines 1398-1424) */
function applyRemoveLoan(plan, loanId) {
  const loan = plan.loans.find(l => l.id === loanId);
  const linkedInvId = loan?.sepiiriostudInvId ?? null;
  const updatedLoans = plan.loans.filter(l => l.id !== loanId);
  const updatedInvestments = linkedInvId
    ? {
        ...plan.investments,
        items: plan.investments.items.map(inv => {
          if (inv.id !== linkedInvId && inv.sourceRefId !== linkedInvId) return inv;
          return { ...inv, fundingPlan: (inv.fundingPlan || []).filter(fp => fp.source !== "Laen") };
        }),
      }
    : plan.investments;
  return { ...plan, loans: updatedLoans, investments: updatedInvestments };
}

/** Mirrors eemaldaSeisukordRida (lines 1138-1151) */
function applyEemaldaSeisukordRida(plan, id) {
  return {
    ...plan,
    assetCondition: {
      ...plan.assetCondition,
      items: (plan.assetCondition?.items || []).filter(r => r.id !== id),
    },
    investments: {
      ...plan.investments,
      items: plan.investments.items.filter(i => i.sourceRefId !== id),
    },
    loans: plan.loans.filter(l => l.sepiiriostudInvId !== id),
  };
}

/** Mirrors eemaldaInvesteering in MajanduskavaApp.jsx, without confirm */
function applyEemaldaInvesteering(plan, sourceRefId) {
  const inv = plan.investments.items.find(i => i.sourceRefId === sourceRefId);
  const hasLoan = (inv?.fundingPlan || []).some(fp => fp.source === "Laen");

  return {
    ...plan,
    investments: {
      ...plan.investments,
      items: plan.investments.items.filter(i => i.sourceRefId !== sourceRefId),
    },
    loans: hasLoan ? plan.loans.filter(l => l.sepiiriostudInvId !== sourceRefId) : plan.loans,
  };
}

/** Mirrors eemaldaStandaloneInvesteering in MajanduskavaApp.jsx */
function applyEemaldaStandaloneInvesteering(plan, invId) {
  const inv = plan.investments.items.find(i => i.id === invId);
  const hasLoan = (inv?.fundingPlan || []).some(fp => fp.source === "Laen");

  return {
    ...plan,
    investments: {
      ...plan.investments,
      items: plan.investments.items.filter(i => i.id !== invId),
    },
    loans: hasLoan ? plan.loans.filter(l => l.sepiiriostudInvId !== invId) : plan.loans,
  };
}

/** Mirrors eemaldaRahpiiriRida in MajanduskavaApp.jsx */
function applyEemaldaRahpiiriRida(plan, sourceRefId, ri) {
  const inv = plan.investments.items.find(i => i.sourceRefId === sourceRefId);
  const eemaldatav = inv?.fundingPlan?.[ri];

  const updatedItems = plan.investments.items.map(i =>
    i.sourceRefId === sourceRefId
      ? { ...i, fundingPlan: (i.fundingPlan || []).filter((_, fi) => fi !== ri) }
      : i
  );

  const loans = eemaldatav?.source === "Laen"
    ? plan.loans.filter(l => l.sepiiriostudInvId !== sourceRefId)
    : plan.loans;

  return { ...plan, investments: { ...plan.investments, items: updatedItems }, loans };
}

/** Mirrors eemaldaStandaloneRahpiiriRida in MajanduskavaApp.jsx */
function applyEemaldaStandaloneRahpiiriRida(plan, invId, ridaIdx) {
  const inv = plan.investments.items.find(i => i.id === invId);
  const eemaldatav = inv?.fundingPlan?.[ridaIdx];

  const updatedItems = plan.investments.items.map(i =>
    i.id === invId
      ? { ...i, fundingPlan: (i.fundingPlan || []).filter((_, ri) => ri !== ridaIdx) }
      : i
  );

  const loans = eemaldatav?.source === "Laen"
    ? plan.loans.filter(l => l.sepiiriostudInvId !== invId)
    : plan.loans;

  return { ...plan, investments: { ...plan.investments, items: updatedItems }, loans };
}

/** Mirrors clearSection(tabIdx === 0) plan-state branch in MajanduskavaApp.jsx */
function applyClearSectionZero(plan) {
  return {
    ...plan,
    period: { ...plan.period, start: "", end: "" },
    building: { ...plan.building, apartments: [] },
  };
}

/** Mirrors clearSection(tabIdx === 1) in MajanduskavaApp.jsx, without confirm */
function applyClearSectionOne(plan) {
  const removedInvIds = new Set(
    plan.investments.items
      .filter(i => i.sourceType === "condition_item")
      .flatMap(i => [i.id, i.sourceRefId].filter(Boolean))
  );

  return {
    ...plan,
    assetCondition: { items: [] },
    investments: {
      ...plan.investments,
      items: plan.investments.items.filter(i => i.sourceType !== "condition_item"),
    },
    loans: plan.loans.filter(l => !removedInvIds.has(l.sepiiriostudInvId)),
  };
}

/** Mirrors clearSection(tabIdx === 2) in MajanduskavaApp.jsx — keeps kommunaal costRows, clears incomeRows */
function applyClearSectionTwo(plan) {
  return {
    ...plan,
    budget: {
      ...plan.budget,
      costRows: plan.budget.costRows.filter(r => KOMMUNAALTEENUSED.includes(r.category)),
      incomeRows: [],
    },
  };
}

/** Mirrors clearKommunaalid() in MajanduskavaApp.jsx — removes kommunaal costRows, keeps non-kommunaal */
function applyClearKommunaalid(plan) {
  return {
    ...plan,
    budget: {
      ...plan.budget,
      costRows: plan.budget.costRows.filter(r => !KOMMUNAALTEENUSED.includes(r.category)),
    },
  };
}

/** Mirrors clearSection(tabIdx === 4) plan-state branch in MajanduskavaApp.jsx — resets funds, does not touch loans */
function applyClearSectionFour(plan) {
  return {
    ...plan,
    funds: {
      repairFund: { monthlyRateEurPerM2: 0 },
      reserve: { plannedEUR: 0 },
    },
  };
}

/** Uses production cleanupOrphanLinkedLoans */
const applyOrphanLoanCleanup = cleanupOrphanLinkedLoans;

// ══════════════════════════════════════════════════════════════════════
// 4. Deletion cleans up all linked records
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4a: removeLoan cleans up linked investment fundingPlan", () => {
  function buildPlan() {
    return {
      assetCondition: { items: [{ id: "rida-1", ese: "Katus" }] },
      investments: {
        items: [
          { id: "inv-linked", sourceRefId: "rida-1", name: "Katus — Remont", fundingPlan: [{ source: "Laen", amountEUR: 30000 }, { source: "Remondifond", amountEUR: 20000 }] },
          { id: "inv-standalone", sourceRefId: null, name: "Standalone", fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }] },
        ],
      },
      loans: [
        { id: "loan-1", sepiiriostudInvId: "rida-1", principalEUR: 30000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  it("removes loan and strips Laen from linked investment fundingPlan", () => {
    const result = applyRemoveLoan(buildPlan(), "loan-1");
    expect(result.loans.find(l => l.id === "loan-1")).toBeUndefined();
    const inv = result.investments.items.find(i => i.id === "inv-linked");
    expect(inv.fundingPlan.some(fp => fp.source === "Laen")).toBe(false);
    expect(inv.fundingPlan.some(fp => fp.source === "Remondifond")).toBe(true);
  });

  it("does not affect standalone investment", () => {
    const result = applyRemoveLoan(buildPlan(), "loan-1");
    const standalone = result.investments.items.find(i => i.id === "inv-standalone");
    expect(standalone).toBeDefined();
    expect(standalone.fundingPlan).toHaveLength(1);
  });

  it("does not affect manual loan", () => {
    const result = applyRemoveLoan(buildPlan(), "loan-1");
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });

  it("removes Laen funding row from standalone investment linked by investment.id", () => {
    const plan = {
      assetCondition: { items: [] },
      investments: {
        items: [
          {
            id: "inv-standalone-linked",
            sourceRefId: null,
            name: "Energiaaudit",
            fundingPlan: [
              { source: "Laen", amountEUR: 12000 },
              { source: "Remondifond", amountEUR: 3000 },
            ],
          },
        ],
      },
      loans: [
        { id: "loan-standalone", sepiiriostudInvId: "inv-standalone-linked", principalEUR: 12000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };

    const result = applyRemoveLoan(plan, "loan-standalone");

    expect(result.loans.find(l => l.id === "loan-standalone")).toBeUndefined();

    const inv = result.investments.items.find(i => i.id === "inv-standalone-linked");
    expect(inv).toBeDefined();
    expect(inv.fundingPlan.some(fp => fp.source === "Laen")).toBe(false);
    expect(inv.fundingPlan.some(fp => fp.source === "Remondifond")).toBe(true);

    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });

  it("removes only Laen row from condition_item fundingPlan and keeps other funding rows intact", () => {
    const plan = {
      assetCondition: { items: [{ id: "rida-1", ese: "Katus" }] },
      investments: {
        items: [
          {
            id: "inv-linked",
            sourceRefId: "rida-1",
            name: "Katus — Remont",
            fundingPlan: [
              { source: "Laen", amountEUR: 30000 },
              { source: "Remondifond", amountEUR: 15000 },
              { source: "Toetus", amountEUR: 5000 },
            ],
          },
        ],
      },
      loans: [
        { id: "loan-1", sepiiriostudInvId: "rida-1", principalEUR: 30000 },
      ],
    };

    const result = applyRemoveLoan(plan, "loan-1");
    const inv = result.investments.items.find(i => i.id === "inv-linked");

    expect(inv).toBeDefined();
    expect(inv.fundingPlan).toHaveLength(2);
    expect(inv.fundingPlan.some(fp => fp.source === "Laen")).toBe(false);
    expect(inv.fundingPlan).toEqual([
      { source: "Remondifond", amountEUR: 15000 },
      { source: "Toetus", amountEUR: 5000 },
    ]);
  });
});

describe("Invariant 4b: eemaldaSeisukordRida removes investment + loan, keeps standalone", () => {
  function buildPlan() {
    return {
      assetCondition: { items: [{ id: "rida-1", ese: "Katus" }, { id: "rida-2", ese: "Fassaad" }] },
      investments: {
        items: [
          { id: "inv-linked", sourceRefId: "rida-1", name: "Katus — Remont", fundingPlan: [{ source: "Laen", amountEUR: 30000 }] },
          { id: "inv-standalone", sourceRefId: null, name: "Standalone", fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }] },
        ],
      },
      loans: [
        { id: "loan-1", sepiiriostudInvId: "rida-1", principalEUR: 30000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  it("removes condition item, linked investment, and linked loan", () => {
    const result = applyEemaldaSeisukordRida(buildPlan(), "rida-1");
    expect(result.assetCondition.items.find(r => r.id === "rida-1")).toBeUndefined();
    expect(result.investments.items.find(i => i.sourceRefId === "rida-1")).toBeUndefined();
    expect(result.loans.find(l => l.sepiiriostudInvId === "rida-1")).toBeUndefined();
  });

  it("standalone investment is untouched", () => {
    const result = applyEemaldaSeisukordRida(buildPlan(), "rida-1");
    const standalone = result.investments.items.find(i => i.id === "inv-standalone");
    expect(standalone).toBeDefined();
    expect(standalone.fundingPlan).toHaveLength(1);
    expect(standalone.name).toBe("Standalone");
  });

  it("manual loan is untouched", () => {
    const result = applyEemaldaSeisukordRida(buildPlan(), "rida-1");
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4d. eemaldaInvesteering removes linked loan only when fundingPlan has Laen
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4d: eemaldaInvesteering removes linked loan only when fundingPlan contains Laen", () => {
  function buildPlanWithLinkedLoan() {
    return {
      assetCondition: { items: [{ id: "rida-1", ese: "Katus" }] },
      investments: {
        items: [
          { id: "inv-1", sourceType: "condition_item", sourceRefId: "rida-1", name: "Katus — Remont", fundingPlan: [{ source: "Laen", amountEUR: 30000 }, { source: "Remondifond", amountEUR: 20000 }] },
          { id: "inv-standalone", sourceType: "standalone", sourceRefId: null, name: "Energiaaudit", fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }] },
        ],
      },
      loans: [
        { id: "loan-linked", sepiiriostudInvId: "rida-1", principalEUR: 30000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  function buildPlanWithoutLoanFunding() {
    return {
      assetCondition: { items: [{ id: "rida-2", ese: "Fassaad" }] },
      investments: {
        items: [{ id: "inv-2", sourceType: "condition_item", sourceRefId: "rida-2", name: "Fassaad — Parandus", fundingPlan: [{ source: "Remondifond", amountEUR: 12000 }] }],
      },
      loans: [
        { id: "loan-linked-stale", sepiiriostudInvId: "rida-2", principalEUR: 12000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  it("removes condition_item investment and its linked loan when fundingPlan contains Laen", () => {
    const result = applyEemaldaInvesteering(buildPlanWithLinkedLoan(), "rida-1");
    expect(result.investments.items.find(i => i.sourceRefId === "rida-1")).toBeUndefined();
    expect(result.loans.find(l => l.sepiiriostudInvId === "rida-1")).toBeUndefined();
  });

  it("keeps manual loan untouched when removing condition_item investment", () => {
    const result = applyEemaldaInvesteering(buildPlanWithLinkedLoan(), "rida-1");
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
    expect(result.investments.items.find(i => i.id === "inv-standalone")).toBeDefined();
  });

  it("does not remove linked loan when fundingPlan does not contain Laen", () => {
    const result = applyEemaldaInvesteering(buildPlanWithoutLoanFunding(), "rida-2");
    expect(result.investments.items.find(i => i.sourceRefId === "rida-2")).toBeUndefined();
    expect(result.loans.find(l => l.id === "loan-linked-stale")).toBeDefined();
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4e. eemaldaStandaloneInvesteering removes linked loan only when fundingPlan contains Laen
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4e: eemaldaStandaloneInvesteering removes linked loan only when fundingPlan contains Laen", () => {
  function buildPlanWithLinkedLoan() {
    return {
      investments: {
        items: [
          { id: "inv-standalone-1", sourceType: "standalone", sourceRefId: null, name: "Energiaaudit", fundingPlan: [{ source: "Laen", amountEUR: 12000 }, { source: "Remondifond", amountEUR: 3000 }] },
          { id: "inv-other", sourceType: "standalone", sourceRefId: null, name: "Turvasüsteem", fundingPlan: [{ source: "Remondifond", amountEUR: 8000 }] },
        ],
      },
      loans: [
        { id: "loan-linked", sepiiriostudInvId: "inv-standalone-1", principalEUR: 12000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  function buildPlanWithoutLoanFunding() {
    return {
      investments: {
        items: [{ id: "inv-standalone-2", sourceType: "standalone", sourceRefId: null, name: "Projektijuhtimine", fundingPlan: [{ source: "Remondifond", amountEUR: 7000 }] }],
      },
      loans: [
        { id: "loan-linked-stale", sepiiriostudInvId: "inv-standalone-2", principalEUR: 7000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  it("removes standalone investment and its linked loan when fundingPlan contains Laen", () => {
    const result = applyEemaldaStandaloneInvesteering(buildPlanWithLinkedLoan(), "inv-standalone-1");
    expect(result.investments.items.find(i => i.id === "inv-standalone-1")).toBeUndefined();
    expect(result.loans.find(l => l.sepiiriostudInvId === "inv-standalone-1")).toBeUndefined();
  });

  it("keeps manual loan and unrelated standalone investment untouched", () => {
    const result = applyEemaldaStandaloneInvesteering(buildPlanWithLinkedLoan(), "inv-standalone-1");
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
    expect(result.investments.items.find(i => i.id === "inv-other")).toBeDefined();
  });

  it("does not remove linked loan when fundingPlan does not contain Laen", () => {
    const result = applyEemaldaStandaloneInvesteering(buildPlanWithoutLoanFunding(), "inv-standalone-2");
    expect(result.investments.items.find(i => i.id === "inv-standalone-2")).toBeUndefined();
    expect(result.loans.find(l => l.id === "loan-linked-stale")).toBeDefined();
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4f. clearSection(1) removes condition_item investments and linked loans
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4f: clearSection(1) removes only condition_item data and linked loans", () => {
  function buildPlan() {
    return {
      assetCondition: { items: [{ id: "rida-1", ese: "Katus" }, { id: "rida-2", ese: "Fassaad" }] },
      investments: {
        items: [
          { id: "inv-cond-1", sourceType: "condition_item", sourceRefId: "rida-1", name: "Katus — Remont", fundingPlan: [{ source: "Laen", amountEUR: 30000 }] },
          { id: "inv-cond-2", sourceType: "condition_item", sourceRefId: "rida-2", name: "Fassaad — Parandus", fundingPlan: [{ source: "Remondifond", amountEUR: 12000 }] },
          { id: "inv-standalone-1", sourceType: "standalone", sourceRefId: null, name: "Energiaaudit", fundingPlan: [{ source: "Laen", amountEUR: 10000 }] },
        ],
      },
      loans: [
        { id: "loan-cond", sepiiriostudInvId: "rida-1", principalEUR: 30000 },
        { id: "loan-standalone", sepiiriostudInvId: "inv-standalone-1", principalEUR: 10000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  it("removes all assetCondition rows and all condition_item investments", () => {
    const result = applyClearSectionOne(buildPlan());
    expect(result.assetCondition.items).toHaveLength(0);
    expect(result.investments.items.find(i => i.id === "inv-cond-1")).toBeUndefined();
    expect(result.investments.items.find(i => i.id === "inv-cond-2")).toBeUndefined();
  });

  it("removes loans linked to removed condition_item investments", () => {
    const result = applyClearSectionOne(buildPlan());
    expect(result.loans.find(l => l.id === "loan-cond")).toBeUndefined();
  });

  it("keeps standalone investment, its linked loan, and manual loan", () => {
    const result = applyClearSectionOne(buildPlan());
    expect(result.investments.items.find(i => i.id === "inv-standalone-1")).toBeDefined();
    expect(result.loans.find(l => l.id === "loan-standalone")).toBeDefined();
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4g. eemaldaRahpiiriRida removes linked loan only when removed row is Laen
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4g: eemaldaRahpiiriRida removes linked loan only when removed funding row is Laen", () => {
  function buildPlan() {
    return {
      investments: {
        items: [{ id: "inv-1", sourceType: "condition_item", sourceRefId: "rida-1", name: "Katus — Remont", fundingPlan: [{ source: "Laen", amountEUR: 30000 }, { source: "Remondifond", amountEUR: 15000 }, { source: "Toetus", amountEUR: 5000 }] }],
      },
      loans: [
        { id: "loan-linked", sepiiriostudInvId: "rida-1", principalEUR: 30000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  it("removes linked loan when removed funding row is Laen", () => {
    const result = applyEemaldaRahpiiriRida(buildPlan(), "rida-1", 0);
    const inv = result.investments.items.find(i => i.sourceRefId === "rida-1");
    expect(inv.fundingPlan).toEqual([{ source: "Remondifond", amountEUR: 15000 }, { source: "Toetus", amountEUR: 5000 }]);
    expect(result.loans.find(l => l.sepiiriostudInvId === "rida-1")).toBeUndefined();
  });

  it("keeps linked loan when removed funding row is not Laen", () => {
    const result = applyEemaldaRahpiiriRida(buildPlan(), "rida-1", 1);
    const inv = result.investments.items.find(i => i.sourceRefId === "rida-1");
    expect(inv.fundingPlan).toEqual([{ source: "Laen", amountEUR: 30000 }, { source: "Toetus", amountEUR: 5000 }]);
    expect(result.loans.find(l => l.id === "loan-linked")).toBeDefined();
  });

  it("keeps manual loan regardless of which funding row is removed", () => {
    const result = applyEemaldaRahpiiriRida(buildPlan(), "rida-1", 0);
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4h. eemaldaStandaloneRahpiiriRida removes linked loan only when removed funding row is Laen
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4h: eemaldaStandaloneRahpiiriRida removes linked loan only when removed funding row is Laen", () => {
  function buildPlan() {
    return {
      investments: {
        items: [{ id: "inv-standalone-1", sourceType: "standalone", sourceRefId: null, name: "Energiaaudit", fundingPlan: [{ source: "Laen", amountEUR: 12000 }, { source: "Remondifond", amountEUR: 3000 }, { source: "Toetus", amountEUR: 2000 }] }],
      },
      loans: [
        { id: "loan-linked", sepiiriostudInvId: "inv-standalone-1", principalEUR: 12000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  it("removes linked loan when removed funding row is Laen", () => {
    const result = applyEemaldaStandaloneRahpiiriRida(buildPlan(), "inv-standalone-1", 0);
    const inv = result.investments.items.find(i => i.id === "inv-standalone-1");
    expect(inv.fundingPlan).toEqual([{ source: "Remondifond", amountEUR: 3000 }, { source: "Toetus", amountEUR: 2000 }]);
    expect(result.loans.find(l => l.sepiiriostudInvId === "inv-standalone-1")).toBeUndefined();
  });

  it("keeps linked loan when removed funding row is not Laen", () => {
    const result = applyEemaldaStandaloneRahpiiriRida(buildPlan(), "inv-standalone-1", 1);
    const inv = result.investments.items.find(i => i.id === "inv-standalone-1");
    expect(inv.fundingPlan).toEqual([{ source: "Laen", amountEUR: 12000 }, { source: "Toetus", amountEUR: 2000 }]);
    expect(result.loans.find(l => l.id === "loan-linked")).toBeDefined();
  });

  it("keeps manual loan regardless of which funding row is removed", () => {
    const result = applyEemaldaStandaloneRahpiiriRida(buildPlan(), "inv-standalone-1", 0);
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4i. clearSection(4) resets funds and removes all loans
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4i: clearSection(4) clears funds but keeps loans", () => {
  function buildPlan() {
    return {
      funds: { repairFund: { monthlyRateEurPerM2: 1.75 }, reserve: { plannedEUR: 12000 } },
      loans: [
        { id: "loan-1", sepiiriostudInvId: "rida-1", principalEUR: 30000 },
        { id: "loan-2", sepiiriostudInvId: "inv-standalone-1", principalEUR: 12000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
      investments: {
        items: [
          { id: "inv-1", sourceType: "condition_item", sourceRefId: "rida-1", fundingPlan: [{ source: "Laen", amountEUR: 30000 }] },
          { id: "inv-standalone-1", sourceType: "standalone", sourceRefId: null, fundingPlan: [{ source: "Laen", amountEUR: 12000 }] },
        ],
      },
      assetCondition: { items: [{ id: "rida-1", ese: "Katus" }] },
    };
  }

  it("sets repairFund monthlyRateEurPerM2 to 0", () => {
    const result = applyClearSectionFour(buildPlan());
    expect(result.funds.repairFund.monthlyRateEurPerM2).toBe(0);
  });

  it("sets reserve plannedEUR to 0", () => {
    const result = applyClearSectionFour(buildPlan());
    expect(result.funds.reserve.plannedEUR).toBe(0);
  });

  it("keeps all loans and leaves investments and assetCondition untouched", () => {
    const result = applyClearSectionFour(buildPlan());
    expect(result.loans).toHaveLength(3);
    expect(result.investments.items).toHaveLength(2);
    expect(result.assetCondition.items).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4j. clearSection(2) and clearSection(3) clear only their budget branch
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4j: clearSection(2) removes non-kommunaal budget; clearKommunaalid removes kommunaal costRows", () => {
  function buildPlan() {
    return {
      budget: {
        costRows: [{ id: "cost-1", category: "Haldus", summaInput: 1000 }, { id: "cost-2", category: "Elekter", summaInput: 2000 }],
        incomeRows: [{ id: "income-1", category: "Muu tulu", summaInput: 500 }],
      },
      loans: [{ id: "loan-1", principalEUR: 10000 }],
      investments: { items: [{ id: "inv-1", name: "Katus" }] },
      assetCondition: { items: [{ id: "rida-1", ese: "Katus" }] },
      funds: { repairFund: { monthlyRateEurPerM2: 1.5 }, reserve: { plannedEUR: 3000 } },
    };
  }

  it("clearSection(2) keeps kommunaal costRows and clears incomeRows", () => {
    const result = applyClearSectionTwo(buildPlan());
    // "Haldus" ei ole kommunaalteenus → eemaldatakse; "Elekter" on → jääb alles
    expect(result.budget.costRows).toHaveLength(1);
    expect(result.budget.costRows[0].category).toBe("Elekter");
    expect(result.budget.incomeRows).toEqual([]);
  });

  it("clearSection(2) leaves loans, investments, assetCondition, and funds untouched", () => {
    const result = applyClearSectionTwo(buildPlan());
    expect(result.loans).toHaveLength(1);
    expect(result.investments.items).toHaveLength(1);
    expect(result.assetCondition.items).toHaveLength(1);
    expect(result.funds.repairFund.monthlyRateEurPerM2).toBe(1.5);
    expect(result.funds.reserve.plannedEUR).toBe(3000);
  });

  it("clearKommunaalid removes kommunaal costRows, keeps non-kommunaal and incomeRows", () => {
    const result = applyClearKommunaalid(buildPlan());
    // "Elekter" on kommunaalteenus → eemaldatakse; "Haldus" ei ole → jääb alles
    expect(result.budget.costRows).toHaveLength(1);
    expect(result.budget.costRows[0].category).toBe("Haldus");
    expect(result.budget.incomeRows).toHaveLength(1);
  });

  it("clearKommunaalid leaves loans, investments, assetCondition, and funds untouched", () => {
    const result = applyClearKommunaalid(buildPlan());
    expect(result.loans).toHaveLength(1);
    expect(result.investments.items).toHaveLength(1);
    expect(result.assetCondition.items).toHaveLength(1);
    expect(result.funds.repairFund.monthlyRateEurPerM2).toBe(1.5);
    expect(result.funds.reserve.plannedEUR).toBe(3000);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4k. clearSection(0) clears period dates and apartments only
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4k: clearSection(0) clears only period bounds and apartments", () => {
  function buildPlan() {
    return {
      period: { start: "2026-01-01", end: "2026-12-31", year: 2026 },
      building: { apartments: [{ id: "apt-1", label: "1", areaM2: 45.5 }, { id: "apt-2", label: "2", areaM2: 55.0 }] },
      assetCondition: { items: [{ id: "rida-1", ese: "Katus" }] },
      investments: { items: [{ id: "inv-1", sourceType: "condition_item", sourceRefId: "rida-1", name: "Katus — Remont" }] },
      loans: [{ id: "loan-1", principalEUR: 10000 }],
      budget: { costRows: [{ id: "cost-1", category: "Haldus", summaInput: 1000 }], incomeRows: [{ id: "income-1", category: "Muu tulu", summaInput: 500 }] },
      funds: { repairFund: { monthlyRateEurPerM2: 1.5 }, reserve: { plannedEUR: 3000 } },
    };
  }

  it("clears period start and end but keeps period.year", () => {
    const result = applyClearSectionZero(buildPlan());
    expect(result.period.start).toBe("");
    expect(result.period.end).toBe("");
    expect(result.period.year).toBe(2026);
  });

  it("clears all apartments", () => {
    const result = applyClearSectionZero(buildPlan());
    expect(result.building.apartments).toEqual([]);
  });

  it("leaves assetCondition, investments, loans, budget, and funds untouched", () => {
    const result = applyClearSectionZero(buildPlan());
    expect(result.assetCondition.items).toHaveLength(1);
    expect(result.investments.items).toHaveLength(1);
    expect(result.loans).toHaveLength(1);
    expect(result.budget.costRows).toHaveLength(1);
    expect(result.budget.incomeRows).toHaveLength(1);
    expect(result.funds.repairFund.monthlyRateEurPerM2).toBe(1.5);
    expect(result.funds.reserve.plannedEUR).toBe(3000);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4c. Orphan loan cleanup (legacy/import safety net)
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 4c: orphan loan cleanup removes broken linked loans only", () => {
  it("removes loan when linked investment no longer exists", () => {
    const plan = {
      investments: { items: [{ id: "inv-ok", sourceRefId: null, name: "OK", fundingPlan: [{ source: "Laen", amountEUR: 5000 }] }] },
      loans: [
        { id: "loan-orphan", sepiiriostudInvId: "missing-inv", principalEUR: 12000 },
        { id: "loan-ok", sepiiriostudInvId: "inv-ok", principalEUR: 5000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 3000 },
      ],
    };
    const result = applyOrphanLoanCleanup(plan);
    expect(result.loans.find(l => l.id === "loan-orphan")).toBeUndefined();
    expect(result.loans.find(l => l.id === "loan-ok")).toBeDefined();
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });

  it("removes loan when linked investment exists but fundingPlan no longer contains Laen", () => {
    const plan = {
      investments: { items: [{ id: "inv-standalone", sourceRefId: null, name: "Energiaaudit", fundingPlan: [{ source: "Remondifond", amountEUR: 12000 }] }] },
      loans: [
        { id: "loan-broken-link", sepiiriostudInvId: "inv-standalone", principalEUR: 12000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 3000 },
      ],
    };
    const result = applyOrphanLoanCleanup(plan);
    expect(result.loans.find(l => l.id === "loan-broken-link")).toBeUndefined();
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });

  it("keeps linked loan when investment exists and fundingPlan still contains Laen", () => {
    const plan = {
      investments: { items: [{ id: "inv-standalone", sourceRefId: null, name: "Energiaaudit", fundingPlan: [{ source: "Laen", amountEUR: 12000 }, { source: "Remondifond", amountEUR: 3000 }] }] },
      loans: [
        { id: "loan-valid", sepiiriostudInvId: "inv-standalone", principalEUR: 12000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 3000 },
      ],
    };
    const result = applyOrphanLoanCleanup(plan);
    expect(result.loans.find(l => l.id === "loan-valid")).toBeDefined();
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});
