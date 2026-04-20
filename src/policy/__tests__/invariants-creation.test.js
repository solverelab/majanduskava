// src/policy/__tests__/invariants-creation.test.js
import { describe, it, expect } from "vitest";
import { mkInvestmentItem } from "../../domain/planSchema";
import { fillMissingYearsFromPeriod, syncConditionItemPlannedYears } from "../../utils/planSync";

// ── Helpers ──

/** Mirrors handleLooInvesteering (lines 1153-1168) — current version with stale-read guard */
function handleLooInvesteeringCurrent(plan, rida) {
  const olemas = plan.investments.items.some(i => i.sourceRefId === rida.id);
  if (olemas) return plan;
  const nimi = rida.ese + (rida.tegevus ? " — " + rida.tegevus : "");
  const newInv = {
    ...mkInvestmentItem({
      name: nimi,
      plannedYear: Number(rida.tegevusAasta) || plan.period.year,
      totalCostEUR: rida.eeldatavKulu || 0,
    }),
    sourceType: "condition_item",
    sourceRefId: rida.id,
    fundingPlan: [],
  };
  return { ...plan, investments: { ...plan.investments, items: [...plan.investments.items, newInv] } };
}

/** Mirrors uuendaSeisukord in MajanduskavaApp.jsx */
function applyUuendaSeisukord(plan, id, field, value) {
  const updatedCondition = (plan.assetCondition?.items || []).map(r =>
    r.id !== id ? r : { ...r, [field]: value }
  );

  const invPatch = {};
  if (field === "eeldatavKulu") invPatch.totalCostEUR = Math.max(0, Number(value) || 0);
  if (field === "tegevusAasta") invPatch.plannedYear = Number(value) || 0;
  if (field === "ese" || field === "tegevus") {
    const rida = updatedCondition.find(r => r.id === id);
    if (rida) invPatch.name = rida.ese + (rida.tegevus ? " — " + rida.tegevus : "");
  }

  const hasInvPatch = Object.keys(invPatch).length > 0;
  const updatedInvestments = hasInvPatch
    ? {
        ...plan.investments,
        items: plan.investments.items.map(inv =>
          inv.sourceRefId !== id ? inv : { ...inv, ...invPatch }
        ),
      }
    : plan.investments;

  return {
    ...plan,
    assetCondition: { ...plan.assetCondition, items: updatedCondition },
    investments: updatedInvestments,
  };
}

/** Uses production fillMissingYearsFromPeriod */
const applyPeriodYearFill = fillMissingYearsFromPeriod;

// ══════════════════════════════════════════════════════════════════════
// 1. assetCondition → investment mapping: 1:1 and deterministic
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 1: assetCondition → investment 1:1", () => {
  const rida = { id: "rida-1", ese: "Katus", tegevus: "Remont", tegevusAasta: "2027", eeldatavKulu: 50000 };
  const emptyPlan = { investments: { items: [] }, loans: [], period: { year: 2026 } };

  it("calling handleLooInvesteering twice produces exactly one investment", () => {
    const after1 = handleLooInvesteeringCurrent(emptyPlan, rida);
    const after2 = handleLooInvesteeringCurrent(after1, rida);
    const matching = after2.investments.items.filter(i => i.sourceRefId === rida.id);
    expect(matching).toHaveLength(1);
  });

  it("investment fields are deterministic for the same input row", () => {
    const after1 = handleLooInvesteeringCurrent(emptyPlan, rida);
    const inv1 = after1.investments.items.find(i => i.sourceRefId === rida.id);
    // Create a fresh plan and call again
    const after2 = handleLooInvesteeringCurrent({ ...emptyPlan }, rida);
    const inv2 = after2.investments.items.find(i => i.sourceRefId === rida.id);
    expect(inv1.name).toBe(inv2.name);
    expect(inv1.plannedYear).toBe(inv2.plannedYear);
    expect(inv1.totalCostEUR).toBe(inv2.totalCostEUR);
    expect(inv1.sourceRefId).toBe(inv2.sourceRefId);
  });

  it("investment name, totalCostEUR, plannedYear match input row", () => {
    const after = handleLooInvesteeringCurrent(emptyPlan, rida);
    const inv = after.investments.items.find(i => i.sourceRefId === rida.id);
    expect(inv.name).toBe("Katus — Remont");
    expect(inv.totalCostEUR).toBe(50000);
    expect(inv.plannedYear).toBe(2027);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 1b. handleLooInvesteering plannedYear fallback
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 1b: handleLooInvesteering uses period.year as plannedYear fallback", () => {
  const basePlan = {
    investments: { items: [] },
    loans: [],
    period: { year: 2029 },
  };

  it("uses period.year when tegevusAasta is empty string", () => {
    const rida = {
      id: "rida-empty-year",
      ese: "Katus",
      tegevus: "Remont",
      tegevusAasta: "",
      eeldatavKulu: 50000,
    };

    const result = handleLooInvesteeringCurrent(basePlan, rida);
    const inv = result.investments.items.find(i => i.sourceRefId === rida.id);

    expect(inv.plannedYear).toBe(2029);
  });

  it("uses period.year when tegevusAasta is missing", () => {
    const rida = {
      id: "rida-missing-year",
      ese: "Fassaad",
      tegevus: "Parandus",
      eeldatavKulu: 12000,
    };

    const result = handleLooInvesteeringCurrent(basePlan, rida);
    const inv = result.investments.items.find(i => i.sourceRefId === rida.id);

    expect(inv.plannedYear).toBe(2029);
  });

  it("uses period.year when tegevusAasta is not numeric", () => {
    const rida = {
      id: "rida-invalid-year",
      ese: "Aknad",
      tegevus: "Vahetus",
      tegevusAasta: "abc",
      eeldatavKulu: 18000,
    };

    const result = handleLooInvesteeringCurrent(basePlan, rida);
    const inv = result.investments.items.find(i => i.sourceRefId === rida.id);

    expect(inv.plannedYear).toBe(2029);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 1c. handleLooInvesteering name building
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 1c: handleLooInvesteering builds investment name deterministically", () => {
  const basePlan = {
    investments: { items: [] },
    loans: [],
    period: { year: 2029 },
  };

  it("uses only ese when tegevus is empty string", () => {
    const rida = {
      id: "rida-empty-tegevus",
      ese: "Katus",
      tegevus: "",
      tegevusAasta: "2029",
      eeldatavKulu: 50000,
    };

    const result = handleLooInvesteeringCurrent(basePlan, rida);
    const inv = result.investments.items.find(i => i.sourceRefId === rida.id);

    expect(inv.name).toBe("Katus");
  });

  it("uses only ese when tegevus is missing", () => {
    const rida = {
      id: "rida-missing-tegevus",
      ese: "Fassaad",
      tegevusAasta: "2029",
      eeldatavKulu: 12000,
    };

    const result = handleLooInvesteeringCurrent(basePlan, rida);
    const inv = result.investments.items.find(i => i.sourceRefId === rida.id);

    expect(inv.name).toBe("Fassaad");
  });

  it("uses ese and tegevus joined by em dash when tegevus exists", () => {
    const rida = {
      id: "rida-with-tegevus",
      ese: "Aknad",
      tegevus: "Vahetus",
      tegevusAasta: "2029",
      eeldatavKulu: 18000,
    };

    const result = handleLooInvesteeringCurrent(basePlan, rida);
    const inv = result.investments.items.find(i => i.sourceRefId === rida.id);

    expect(inv.name).toBe("Aknad — Vahetus");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 1d. uuendaSeisukord syncs linked investment fields
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 1d: uuendaSeisukord keeps linked condition_item investment in sync", () => {
  function buildPlan() {
    return {
      assetCondition: {
        items: [
          {
            id: "rida-1",
            ese: "Katus",
            tegevus: "Remont",
            tegevusAasta: "2027",
            eeldatavKulu: 50000,
          },
        ],
      },
      investments: {
        items: [
          {
            id: "inv-1",
            sourceType: "condition_item",
            sourceRefId: "rida-1",
            name: "Katus — Remont",
            plannedYear: 2027,
            totalCostEUR: 50000,
            fundingPlan: [],
          },
        ],
      },
      loans: [],
    };
  }

  it("updates linked investment totalCostEUR when eeldatavKulu changes", () => {
    const result = applyUuendaSeisukord(buildPlan(), "rida-1", "eeldatavKulu", 65000);
    const inv = result.investments.items.find(i => i.sourceRefId === "rida-1");

    expect(inv.totalCostEUR).toBe(65000);
  });

  it("updates linked investment plannedYear when tegevusAasta changes", () => {
    const result = applyUuendaSeisukord(buildPlan(), "rida-1", "tegevusAasta", "2030");
    const inv = result.investments.items.find(i => i.sourceRefId === "rida-1");

    expect(inv.plannedYear).toBe(2030);
  });

  it("updates linked investment name when ese changes", () => {
    const result = applyUuendaSeisukord(buildPlan(), "rida-1", "ese", "Fassaad");
    const inv = result.investments.items.find(i => i.sourceRefId === "rida-1");

    expect(inv.name).toBe("Fassaad — Remont");
  });

  it("updates linked investment name when tegevus changes", () => {
    const result = applyUuendaSeisukord(buildPlan(), "rida-1", "tegevus", "Vahetus");
    const inv = result.investments.items.find(i => i.sourceRefId === "rida-1");

    expect(inv.name).toBe("Katus — Vahetus");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 1e. period.year change fills only empty tegevusAasta and algusAasta
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 1e: period.year fills only empty tegevusAasta and algusAasta fields", () => {
  function buildPlan() {
    return {
      period: { year: 2026 },
      assetCondition: {
        items: [
          { id: "rida-1", ese: "Katus", tegevusAasta: "" },
          { id: "rida-2", ese: "Fassaad", tegevusAasta: "2030" },
          { id: "rida-3", ese: "Aknad" },
        ],
      },
      loans: [
        { id: "loan-1", algusAasta: "" },
        { id: "loan-2", algusAasta: "2031" },
        { id: "loan-3" },
      ],
      investments: { items: [] },
    };
  }

  it("fills empty and missing tegevusAasta values with the new period year", () => {
    const result = applyPeriodYearFill(buildPlan(), 2029);

    expect(result.assetCondition.items.find(i => i.id === "rida-1").tegevusAasta).toBe("2029");
    expect(result.assetCondition.items.find(i => i.id === "rida-3").tegevusAasta).toBe("2029");
  });

  it("fills empty and missing algusAasta values with the new period year", () => {
    const result = applyPeriodYearFill(buildPlan(), 2029);

    expect(result.loans.find(l => l.id === "loan-1").algusAasta).toBe("2029");
    expect(result.loans.find(l => l.id === "loan-3").algusAasta).toBe("2029");
  });

  it("does not overwrite already set tegevusAasta or algusAasta values", () => {
    const result = applyPeriodYearFill(buildPlan(), 2029);

    expect(result.assetCondition.items.find(i => i.id === "rida-2").tegevusAasta).toBe("2030");
    expect(result.loans.find(l => l.id === "loan-2").algusAasta).toBe("2031");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 1f. period.year change fills only empty plannedYear on investments
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 1f: period.year fills only empty plannedYear on investments", () => {
  function buildPlan() {
    return {
      period: { year: 2026 },
      assetCondition: { items: [] },
      loans: [],
      investments: {
        items: [
          { id: "inv-empty", name: "Fassaad", totalCostEUR: 10000 },
          { id: "inv-set", name: "Katus", totalCostEUR: 50000, plannedYear: 2026 },
        ],
      },
    };
  }

  it("fills missing plannedYear with the new period year", () => {
    const result = applyPeriodYearFill(buildPlan(), 2027);
    expect(result.investments.items.find(i => i.id === "inv-empty").plannedYear).toBe(2027);
  });

  it("does not overwrite already set plannedYear", () => {
    const result = applyPeriodYearFill(buildPlan(), 2027);
    expect(result.investments.items.find(i => i.id === "inv-set").plannedYear).toBe(2026);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 1g. handleLooInvesteering does not fall back to system year
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 1g: handleLooInvesteering has no system-year fallback", () => {
  it("uses period.year = 2027 when tegevusAasta is empty", () => {
    const plan = { investments: { items: [] }, loans: [], period: { year: 2027 } };
    const rida = { id: "rida-1", ese: "Katus", tegevus: "Remont", tegevusAasta: "", eeldatavKulu: 10000 };
    const result = handleLooInvesteeringCurrent(plan, rida);
    const inv = result.investments.items.find(i => i.sourceRefId === rida.id);
    expect(inv.plannedYear).toBe(2027);
  });

  it("does not fall back to new Date().getFullYear() when period.year is missing", () => {
    const plan = { investments: { items: [] }, loans: [], period: {} };
    const rida = { id: "rida-2", ese: "Fassaad", tegevus: "Parandus", tegevusAasta: "", eeldatavKulu: 5000 };
    const result = handleLooInvesteeringCurrent(plan, rida);
    const inv = result.investments.items.find(i => i.sourceRefId === rida.id);
    expect(inv.plannedYear).not.toBe(new Date().getFullYear());
    expect(inv.plannedYear).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 1h. syncConditionItemPlannedYears resyncs drifted condition_item years
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 1h: condition_item plannedYear resync from linked tegevusAasta", () => {
  function buildPlan() {
    return {
      assetCondition: {
        items: [
          { id: "rida-1", ese: "Katus", tegevusAasta: "2027" },
        ],
      },
      investments: {
        items: [
          { id: "inv-cond", sourceType: "condition_item", sourceRefId: "rida-1", name: "Katus", plannedYear: 2026, totalCostEUR: 50000 },
          { id: "inv-standalone", sourceType: "standalone", sourceRefId: null, name: "Lift", plannedYear: 2026, totalCostEUR: 80000 },
        ],
      },
      loans: [],
    };
  }

  it("resyncs condition_item plannedYear from linked row's tegevusAasta when drifted", () => {
    const result = syncConditionItemPlannedYears(buildPlan());
    expect(result.investments.items.find(i => i.id === "inv-cond").plannedYear).toBe(2027);
  });

  it("does not touch standalone investments", () => {
    const result = syncConditionItemPlannedYears(buildPlan());
    expect(result.investments.items.find(i => i.id === "inv-standalone").plannedYear).toBe(2026);
  });
});
