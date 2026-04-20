// src/policy/__tests__/invariants-import.test.js
import { describe, it, expect } from "vitest";
import { mkInvestmentItem } from "../../domain/planSchema";
import { normalizeInvestmentsField, cleanAssetConditionInvestmentFields } from "../../utils/importNormalize";
import { syncRepairFundRate, syncRepairFundOpeningBalance } from "../../utils/planSync";

// ── Helpers ──

/** Wraps normalizeInvestmentsField as pure function for testing */
function applyNormalizeInvestmentsField(candidateState) {
  const next = { ...candidateState };
  normalizeInvestmentsField(next);
  return next;
}

/** Mirrors import migration of condition_item investments in MajanduskavaApp.jsx */
function applyMigrateConditionItemsToCanonicalInvestments(candidateState, importedSeisukord) {
  const investments = [];

  importedSeisukord.forEach(r => {
    if (r.investeering) {
      investments.push({
        ...mkInvestmentItem({
          name: r.invNimetus || r.ese,
          plannedYear: Number(r.tegevusAasta) || (candidateState.period?.year || 2026),
          totalCostEUR: Number(r.invMaksumus || r.eeldatavKulu) || 0,
        }),
        sourceType: "condition_item",
        sourceRefId: r.id,
        fundingPlan: (r.rahpiiri || []).map(rp => ({
          source: rp.allikas,
          amountEUR: Number(rp.summa) || 0,
        })),
      });
    }
  });

  return {
    ...candidateState,
    investments: { items: investments },
  };
}

/** Uses production syncRepairFundRate */
const applyRepairFundRateSync = syncRepairFundRate;

/** Uses production syncRepairFundOpeningBalance */
const applyRepairFundOpeningBalanceSync = syncRepairFundOpeningBalance;

// ══════════════════════════════════════════════════════════════════════
// 5. Import normalization: canonical investment source
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 5: import normalization keeps investments only in canonical field", () => {
  it("uses investments.items when already present and removes investmentsPipeline", () => {
    const state = {
      investments: {
        items: [{ id: "inv-1", name: "Katus" }],
      },
      investmentsPipeline: {
        items: [{ id: "old-pipeline-inv", name: "Should be ignored" }],
      },
    };

    const result = applyNormalizeInvestmentsField(state);

    expect(result.investments.items).toHaveLength(1);
    expect(result.investments.items[0].id).toBe("inv-1");
    expect("investmentsPipeline" in result).toBe(false);
  });

  it("falls back to investmentsPipeline.items when investments.items is missing, then removes investmentsPipeline", () => {
    const state = {
      investmentsPipeline: {
        items: [{ id: "pipeline-inv-1", name: "Legacy investment" }],
      },
    };

    const result = applyNormalizeInvestmentsField(state);

    expect(result.investments.items).toHaveLength(1);
    expect(result.investments.items[0].id).toBe("pipeline-inv-1");
    expect("investmentsPipeline" in result).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. Import cleanup: investment fields removed from assetCondition
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 6: assetCondition cleanup removes embedded investment fields", () => {
  it("removes embedded investment fields from migrated assetCondition rows", () => {
    const importedSeisukord = [
      {
        id: "rida-1",
        ese: "Katus",
        seisukordVal: "Mitterahuldav",
        puudused: "Lekked",
        prioriteet: "Kõrge",
        tegevus: "Katuse remont",
        tegevusAasta: "2027",
        investeering: true,
        invNimetus: "Katus — Katuse remont",
        invMaksumus: 50000,
        rahpiiri: [{ allikas: "Laen", summa: 30000 }],
      },
    ];

    const result = cleanAssetConditionInvestmentFields(importedSeisukord);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rida-1");
    expect(result[0].ese).toBe("Katus");
    expect("investeering" in result[0]).toBe(false);
    expect("invNimetus" in result[0]).toBe(false);
    expect("invMaksumus" in result[0]).toBe(false);
    expect("rahpiiri" in result[0]).toBe(false);
  });

  it("keeps non-investment assetCondition fields intact", () => {
    const importedSeisukord = [
      {
        id: "rida-2",
        ese: "Fassaad",
        seisukordVal: "Rahuldav",
        puudused: "Praod",
        prioriteet: "Keskmine",
        tegevus: "Parandus",
        tegevusAasta: "2028",
        eeldatavKulu: 12000,
      },
    ];

    const result = cleanAssetConditionInvestmentFields(importedSeisukord);

    expect(result[0]).toEqual({
      id: "rida-2",
      ese: "Fassaad",
      seisukordVal: "Rahuldav",
      puudused: "Praod",
      prioriteet: "Keskmine",
      tegevus: "Parandus",
      tegevusAasta: "2028",
      eeldatavKulu: 12000,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5b. Import migration: seisukord → canonical condition_item investments
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 5b: import migration creates canonical condition_item investments from assetCondition rows", () => {
  it("creates a condition_item investment from imported assetCondition investment data", () => {
    const state = {
      period: { year: 2028 },
      investments: { items: [] },
    };

    const importedSeisukord = [
      {
        id: "rida-1",
        ese: "Katus",
        investeering: true,
        invNimetus: "Katus — Remont",
        invMaksumus: 50000,
        tegevusAasta: "2030",
        rahpiiri: [
          { allikas: "Laen", summa: 30000 },
          { allikas: "Remondifond", summa: 20000 },
        ],
      },
    ];

    const result = applyMigrateConditionItemsToCanonicalInvestments(state, importedSeisukord);
    const inv = result.investments.items[0];

    expect(result.investments.items).toHaveLength(1);
    expect(inv.sourceType).toBe("condition_item");
    expect(inv.sourceRefId).toBe("rida-1");
    expect(inv.name).toBe("Katus — Remont");
    expect(inv.plannedYear).toBe(2030);
    expect(inv.totalCostEUR).toBe(50000);
    expect(inv.fundingPlan).toEqual([
      { source: "Laen", amountEUR: 30000 },
      { source: "Remondifond", amountEUR: 20000 },
    ]);
  });

  it("falls back to ese and candidateState.period.year when invNimetus or tegevusAasta is missing", () => {
    const state = {
      period: { year: 2029 },
      investments: { items: [] },
    };

    const importedSeisukord = [
      {
        id: "rida-2",
        ese: "Fassaad",
        investeering: true,
        eeldatavKulu: 12000,
      },
    ];

    const result = applyMigrateConditionItemsToCanonicalInvestments(state, importedSeisukord);
    const inv = result.investments.items[0];

    expect(inv.name).toBe("Fassaad");
    expect(inv.plannedYear).toBe(2029);
    expect(inv.totalCostEUR).toBe(12000);
    expect(inv.fundingPlan).toEqual([]);
  });

  it("ignores assetCondition rows where investeering is not true", () => {
    const state = {
      period: { year: 2029 },
      investments: { items: [] },
    };

    const importedSeisukord = [
      {
        id: "rida-3",
        ese: "Aknad",
        investeering: false,
        invNimetus: "Aknad — Vahetus",
        invMaksumus: 18000,
        tegevusAasta: "2031",
      },
    ];

    const result = applyMigrateConditionItemsToCanonicalInvestments(state, importedSeisukord);

    expect(result.investments.items).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5c. Repair fund sync writes computed monthlyRateEurPerM2 canonically
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 5c: repair fund sync writes computed monthlyRateEurPerM2 canonically", () => {
  function buildPlan() {
    return {
      funds: {
        repairFund: { monthlyRateEurPerM2: 1.5 },
        reserve: { plannedEUR: 3000 },
      },
      loans: [{ id: "loan-1", principalEUR: 10000 }],
      investments: { items: [{ id: "inv-1", name: "Katus" }] },
    };
  }

  it("writes monthlyRateEurPerM2 as maarAastasM2 divided by 12", () => {
    const result = applyRepairFundRateSync(buildPlan(), 24);

    expect(result.funds.repairFund.monthlyRateEurPerM2).toBe(2);
  });

  it("returns the same plan reference when monthlyRateEurPerM2 is already in sync", () => {
    const plan = buildPlan();
    const result = applyRepairFundRateSync(plan, 18);

    expect(result).toBe(plan);
  });

  it("leaves reserve, loans, and investments untouched when syncing repair fund rate", () => {
    const result = applyRepairFundRateSync(buildPlan(), 24);

    expect(result.funds.reserve.plannedEUR).toBe(3000);
    expect(result.loans).toHaveLength(1);
    expect(result.investments.items).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5d. Repair fund opening balance sync from saldoAlgus to plan state
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 5d: repair fund opening balance sync writes rounded canonical openingBalances.repairFundEUR", () => {
  function buildPlan() {
    return {
      openingBalances: { repairFundEUR: 1000, otherFundEUR: 200 },
      funds: {
        repairFund: { monthlyRateEurPerM2: 1.5 },
        reserve: { plannedEUR: 3000 },
      },
      loans: [{ id: "loan-1", principalEUR: 10000 }],
    };
  }

  it("writes rounded repairFundEUR from saldoAlgusRaw", () => {
    const result = applyRepairFundOpeningBalanceSync(buildPlan(), "1234,6");

    expect(result.openingBalances.repairFundEUR).toBe(1235);
  });

  it("returns the same plan reference when repairFundEUR is already in sync", () => {
    const plan = buildPlan();
    const result = applyRepairFundOpeningBalanceSync(plan, "1000");

    expect(result).toBe(plan);
  });

  it("leaves other openingBalances fields, funds, and loans untouched", () => {
    const result = applyRepairFundOpeningBalanceSync(buildPlan(), "1500");

    expect(result.openingBalances.otherFundEUR).toBe(200);
    expect(result.funds.repairFund.monthlyRateEurPerM2).toBe(1.5);
    expect(result.funds.reserve.plannedEUR).toBe(3000);
    expect(result.loans).toHaveLength(1);
  });
});
