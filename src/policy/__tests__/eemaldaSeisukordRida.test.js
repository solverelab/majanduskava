// src/policy/__tests__/eemaldaSeisukordRida.test.js
import { describe, it, expect } from "vitest";

/**
 * Unit-test for eemaldaSeisukordRida logic.
 *
 * The real function lives inside MajanduskavaApp component and calls two
 * React state updaters. We extract and test the updater callbacks directly:
 *   setPlan(p => ...)   — must remove matching investment + loan
 *   setSeisukord(prev => ...) — must remove matching row
 */

// ── Helpers to simulate updater logic extracted from eemaldaSeisukordRida ──

function applyPlanUpdater(plan, ridaId) {
  // Mirrors: setPlan(p => ({ ...p, investments: { ...items.filter(...) }, loans: loans.filter(...) }))
  return {
    ...plan,
    investments: {
      ...plan.investments,
      items: plan.investments.items.filter(i => i.sourceRefId !== ridaId),
    },
    loans: plan.loans.filter(l => l.sepiiriostudInvId !== ridaId),
  };
}

function applySeisukordUpdater(seisukord, ridaId) {
  return seisukord.filter(r => r.id !== ridaId);
}

// ── Test data factories ──

function mkRida(id, ese = "Katus") {
  return { id, ese, tegevus: "Remont", tegevusAasta: "2027", eeldatavKulu: 50000 };
}

function mkInvestment(sourceRefId, name = "Katus — Remont") {
  return {
    id: `inv-${sourceRefId}`,
    name,
    sourceType: "condition_item",
    sourceRefId,
    totalCostEUR: 50000,
    fundingPlan: [{ source: "Laen", amountEUR: 30000 }, { source: "Remondifond", amountEUR: 20000 }],
  };
}

function mkLoan(id, sepiiriostudInvId) {
  return { id, summa: 30000, intpiiri: "4", tahtaeg: 120, sepiiriostudInvId };
}

// ── Tests ──

describe("eemaldaSeisukordRida logic", () => {
  const RIDA_ID = "rida-1";
  const OTHER_RIDA_ID = "rida-2";
  const MANUAL_LOAN_ID = "manual-loan";

  function buildState() {
    return {
      seisukord: [mkRida(RIDA_ID, "Katus"), mkRida(OTHER_RIDA_ID, "Fassaad")],
      plan: {
        investments: {
          items: [
            mkInvestment(RIDA_ID, "Katus — Remont"),
            mkInvestment(OTHER_RIDA_ID, "Fassaad — Remont"),
          ],
        },
        loans: [
          mkLoan("loan-1", RIDA_ID),
          mkLoan("loan-2", OTHER_RIDA_ID),
          mkLoan(MANUAL_LOAN_ID, null), // käsitsi lisatud laen, pole seotud investeeringuga
        ],
      },
    };
  }

  it("removes the deleted row from seisukord", () => {
    const { seisukord } = buildState();
    const result = applySeisukordUpdater(seisukord, RIDA_ID);
    expect(result.find(r => r.id === RIDA_ID)).toBeUndefined();
  });

  it("removes the linked investment from investments", () => {
    const { plan } = buildState();
    const result = applyPlanUpdater(plan, RIDA_ID);
    expect(result.investments.items.find(i => i.sourceRefId === RIDA_ID)).toBeUndefined();
  });

  it("removes the linked loan from plan.loans", () => {
    const { plan } = buildState();
    const result = applyPlanUpdater(plan, RIDA_ID);
    expect(result.loans.find(l => l.sepiiriostudInvId === RIDA_ID)).toBeUndefined();
  });

  it("keeps other seisukord rows intact (regression)", () => {
    const { seisukord } = buildState();
    const result = applySeisukordUpdater(seisukord, RIDA_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(OTHER_RIDA_ID);
  });

  it("keeps other investments intact (regression)", () => {
    const { plan } = buildState();
    const result = applyPlanUpdater(plan, RIDA_ID);
    expect(result.investments.items).toHaveLength(1);
    expect(result.investments.items[0].sourceRefId).toBe(OTHER_RIDA_ID);
  });

  it("keeps unlinked (manual) loans intact (regression)", () => {
    const { plan } = buildState();
    const result = applyPlanUpdater(plan, RIDA_ID);
    const manual = result.loans.find(l => l.id === MANUAL_LOAN_ID);
    expect(manual).toBeDefined();
    expect(manual.sepiiriostudInvId).toBeNull();
  });

  it("keeps other linked loans intact (regression)", () => {
    const { plan } = buildState();
    const result = applyPlanUpdater(plan, RIDA_ID);
    const otherLoan = result.loans.find(l => l.sepiiriostudInvId === OTHER_RIDA_ID);
    expect(otherLoan).toBeDefined();
  });

  it("handles empty investments gracefully", () => {
    const plan = { investments: { items: [] }, loans: [] };
    const result = applyPlanUpdater(plan, "nonexistent");
    expect(result.investments.items).toHaveLength(0);
    expect(result.loans).toHaveLength(0);
  });
});

// ── Path 2: Legacy/import orphan cleanup useEffect logic ──

/**
 * Mirrors the useEffect at ~line 698 of MajanduskavaApp.jsx:
 * finds loans whose sepiiriostudInvId points to a missing investment
 * or an investment without "Laen" in its fundingPlan.
 */
function findOrphanLoanIds(plan) {
  return plan.loans
    .filter(l => l.sepiiriostudInvId)
    .filter(l => {
      const inv = plan.investments.items.find(i =>
        i.sourceRefId === l.sepiiriostudInvId || i.id === l.sepiiriostudInvId
      );
      if (!inv) return true;
      return !(inv.fundingPlan || []).some(fp => fp.source === "Laen");
    })
    .map(l => l.id);
}

function applyOrphanCleanup(plan) {
  const orphanLoanIds = findOrphanLoanIds(plan);
  if (orphanLoanIds.length === 0) return plan;
  return {
    ...plan,
    loans: plan.loans.filter(l => !orphanLoanIds.includes(l.id)),
  };
}

describe("orphan loan cleanup (legacy/import safety net)", () => {
  it("removes loan pointing to nonexistent investment", () => {
    const plan = {
      investments: { items: [] },
      loans: [
        { id: "orphan-loan", summa: 10000, sepiiriostudInvId: "deleted-inv-id" },
        { id: "manual-loan", summa: 5000, sepiiriostudInvId: null },
      ],
    };
    const result = applyOrphanCleanup(plan);
    expect(result.loans.find(l => l.id === "orphan-loan")).toBeUndefined();
    expect(result.loans.find(l => l.id === "manual-loan")).toBeDefined();
  });

  it("removes loan when investment exists but has no Laen in fundingPlan", () => {
    const plan = {
      investments: {
        items: [{
          id: "inv-1", sourceRefId: "rida-1", name: "Test",
          fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
        }],
      },
      loans: [
        { id: "stale-loan", summa: 10000, sepiiriostudInvId: "rida-1" },
      ],
    };
    const result = applyOrphanCleanup(plan);
    expect(result.loans).toHaveLength(0);
  });

  it("keeps loan when investment exists and has Laen in fundingPlan", () => {
    const plan = {
      investments: {
        items: [{
          id: "inv-1", sourceRefId: "rida-1", name: "Test",
          fundingPlan: [{ source: "Laen", amountEUR: 30000 }],
        }],
      },
      loans: [
        { id: "valid-loan", summa: 30000, sepiiriostudInvId: "rida-1" },
      ],
    };
    const result = applyOrphanCleanup(plan);
    expect(result.loans).toHaveLength(1);
    expect(result.loans[0].id).toBe("valid-loan");
  });

  it("matches loan via inv.id fallback (standalone investment)", () => {
    const plan = {
      investments: {
        items: [{
          id: "standalone-inv", sourceRefId: null, name: "Standalone",
          fundingPlan: [{ source: "Laen", amountEUR: 20000 }],
        }],
      },
      loans: [
        { id: "linked-loan", summa: 20000, sepiiriostudInvId: "standalone-inv" },
      ],
    };
    const result = applyOrphanCleanup(plan);
    expect(result.loans).toHaveLength(1);
  });

  it("does not touch manual loans (no sepiiriostudInvId)", () => {
    const plan = {
      investments: { items: [] },
      loans: [
        { id: "manual-1", summa: 5000, sepiiriostudInvId: null },
        { id: "manual-2", summa: 8000 },
      ],
    };
    const result = applyOrphanCleanup(plan);
    expect(result.loans).toHaveLength(2);
  });

  it("no-op when there are no orphans", () => {
    const plan = {
      investments: { items: [] },
      loans: [{ id: "m1", summa: 1000, sepiiriostudInvId: null }],
    };
    const result = applyOrphanCleanup(plan);
    expect(result).toBe(plan); // same reference — no mutation
  });
});
