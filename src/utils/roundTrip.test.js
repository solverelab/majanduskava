import { describe, it, expect, beforeEach } from "vitest";
import { checkPlanConsistency } from "./planConsistency";
import { KOMMUNAALTEENUSED } from "./majanduskavaCalc";

// ── Migration logic extracted from onImportJSON (pure, testable) ─────────────

let _uid = 0;
const uid = () => `test-uid-${++_uid}`;

function mkInvestmentItem({ name = "", plannedYear = 2026, totalCostEUR = 0 } = {}) {
  return { id: uid(), name, plannedYear, totalCostEUR, fundingPlan: [] };
}

function migrateImportState(data) {
  const candidateState = JSON.parse(JSON.stringify(data.state));

  // Strip investment quarters
  if (candidateState.investments?.items) {
    candidateState.investments.items = candidateState.investments.items.map(
      ({ quarter: _q, ...rest }) => rest
    );
  }

  // Migrate seisukord
  const rawAssetConditionItems = Array.isArray(candidateState.assetCondition?.items)
    ? candidateState.assetCondition.items : null;
  const rawLegacySeisukord =
    rawAssetConditionItems == null && Array.isArray(data.seisukord) ? data.seisukord : [];
  let importedSeisukord = (rawAssetConditionItems ?? rawLegacySeisukord).map(r => {
    const { tegevusKvartal: _t, ...rest } = r;
    return { tegevusAasta: "", eeldatavKulu: 0, tegevus: "", ...rest };
  });

  const importedMuudInv = [];
  importedSeisukord = importedSeisukord.filter(r => {
    if (r.ese === "Muu" && r.investeering) {
      importedMuudInv.push({ nimetus: r.invNimetus || "", aasta: r.tegevusAasta || "", maksumus: r.invMaksumus || 0, rahpiiri: r.rahpiiri || [] });
      return false;
    }
    return r.ese !== "Muu";
  });

  const migreeriAllikas = (a) => a === "Erakorraline makse" ? "Sihtmakse" : a === "Reservkapital" ? "Remondifond" : a;
  importedSeisukord.forEach(e => { if (e.rahpiiri) e.rahpiiri = e.rahpiiri.map(rp => ({ ...rp, allikas: migreeriAllikas(rp.allikas) })); });
  importedMuudInv.forEach(e => { if (e.rahpiiri) e.rahpiiri = e.rahpiiri.map(rp => ({ ...rp, allikas: migreeriAllikas(rp.allikas) })); });

  const newFormatMuud = Array.isArray(data.muudInvesteeringud) ? data.muudInvesteeringud : [];
  const allMuud = [...newFormatMuud, ...importedMuudInv];

  const currentInvestmentItems =
    candidateState.investments?.items ?? candidateState.investmentsPipeline?.items ?? [];

  const needsMigration = !currentInvestmentItems.length || !currentInvestmentItems[0]?.sourceType;

  if (needsMigration) {
    const investments = [];
    importedSeisukord.forEach(r => {
      if (r.investeering) {
        investments.push({
          ...mkInvestmentItem({
            name: r.invNimetus || r.ese,
            plannedYear: Number(r.tegevusAasta) || (candidateState.period?.year || 2026),
            totalCostEUR: Number(r.invMaksumus || r.eeldatavKulu) || 0,
          }),
          sourceType: "condition_item", sourceRefId: r.id,
          fundingPlan: (r.rahpiiri || []).map(rp => ({ source: rp.allikas, amountEUR: Number(rp.summa) || 0 })),
        });
      }
    });
    allMuud.forEach(m => {
      investments.push({
        ...mkInvestmentItem({ name: m.nimetus, plannedYear: Number(m.aasta) || 2026, totalCostEUR: Number(m.maksumus) || 0 }),
        sourceType: "standalone", sourceRefId: null,
        fundingPlan: (m.rahpiiri || []).map(rp => ({ source: rp.allikas, amountEUR: Number(rp.summa) || 0 })),
      });
    });
    currentInvestmentItems.forEach(inv => {
      if (!inv.sourceType && !investments.some(i => i.sourceRefId === inv.seisukordId)) {
        investments.push({
          ...mkInvestmentItem({ name: inv.name || "", plannedYear: inv.plannedYear || 0, totalCostEUR: inv.totalCostEUR || 0 }),
          sourceType: inv.seisukordId ? "condition_item" : "standalone",
          sourceRefId: inv.seisukordId || null,
          fundingPlan: (inv.fundingPlan || []).map(fp => ({ source: fp.source, amountEUR: fp.amountEUR || 0 })),
        });
      } else if (inv.sourceType && !investments.some(i => i.id === inv.id)) {
        investments.push(inv);
      }
    });
    candidateState.investments = { items: investments };
  }

  candidateState.investments = {
    items: candidateState.investments?.items ?? candidateState.investmentsPipeline?.items ?? [],
  };
  delete candidateState.investmentsPipeline;

  const cleanSeisukord = importedSeisukord.map(
    ({ investeering: _, invNimetus: __, invMaksumus: ___, rahpiiri: ____, ...rest }) => rest
  );
  candidateState.assetCondition = { items: cleanSeisukord };

  return candidateState;
}

// Simulate export: produces the bundle.state like onExportJSON
function simulateExport(plan) {
  const cleanState = { ...plan, investments: { items: plan.investments?.items || [] } };
  delete cleanState.investmentsPipeline;
  return JSON.parse(JSON.stringify(cleanState));
}

// Simulate full round-trip: export → wrap as bundle → import
function roundTrip(plan, schemaVersion = "majanduskavaExport/v2") {
  const exported = simulateExport(plan);
  const bundle = { schemaVersion, moduleId: "majanduskava", state: exported };
  return migrateImportState(bundle);
}

// ── Semantic comparison helpers ──────────────────────────────────────────────

function semanticInvestments(items) {
  return items.map(i => ({
    name: i.name, sourceType: i.sourceType, sourceRefId: i.sourceRefId,
    plannedYear: i.plannedYear, totalCostEUR: i.totalCostEUR,
    fundingPlan: (i.fundingPlan || []).map(fp => ({ source: fp.source, amountEUR: fp.amountEUR })),
  })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function semanticLoans(loans) {
  return loans.map(l => ({
    principalEUR: l.principalEUR, sepiiriostudInvId: l.sepiiriostudInvId,
  })).sort((a, b) => (a.sepiiriostudInvId || "").localeCompare(b.sepiiriostudInvId || ""));
}

function semanticCondition(items) {
  return items.map(i => ({
    id: i.id, ese: i.ese, tegevus: i.tegevus, tegevusAasta: i.tegevusAasta, eeldatavKulu: i.eeldatavKulu,
  })).sort((a, b) => (a.id || "").localeCompare(b.id || ""));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function mkCanonicalPlan() {
  return {
    period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
    building: { apartments: [] },
    budget: { costRows: [], incomeRows: [] },
    funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 100 } },
    loans: [
      { id: "loan-1", principalEUR: 30000, annualRatePct: 3.6, termMonths: 240, sepiiriostudInvId: "r1" },
    ],
    investments: {
      items: [
        {
          id: "inv-1", name: "Katus — Remont", sourceType: "condition_item", sourceRefId: "r1",
          plannedYear: 2028, totalCostEUR: 50000,
          fundingPlan: [{ source: "Laen", amountEUR: 30000 }, { source: "Remondifond", amountEUR: 20000 }],
        },
        {
          id: "inv-2", name: "Lift", sourceType: "standalone", sourceRefId: null,
          plannedYear: 2030, totalCostEUR: 80000,
          fundingPlan: [{ source: "Remondifond", amountEUR: 80000 }],
        },
      ],
    },
    assetCondition: {
      items: [
        { id: "r1", ese: "Katus", tegevus: "Remont", tegevusAasta: "2028", eeldatavKulu: 50000 },
      ],
    },
  };
}

function mkV1LegacyBundle() {
  return {
    schemaVersion: "majanduskavaExport/v1",
    moduleId: "majanduskava",
    state: {
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [] },
      budget: { costRows: [], incomeRows: [] },
      funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
      loans: [],
    },
    seisukord: [
      {
        id: "sk-1", ese: "Katus", tegevus: "Remont", tegevusAasta: "2028", eeldatavKulu: 50000,
        investeering: true, invNimetus: "Katus — Remont", invMaksumus: 50000,
        rahpiiri: [{ allikas: "Remondifond", summa: 20000 }],
      },
    ],
  };
}

function mkPipelineBundle() {
  return {
    schemaVersion: "majanduskavaExport/v1",
    moduleId: "majanduskava",
    state: {
      period: { year: 2026 },
      building: { apartments: [] },
      budget: { costRows: [], incomeRows: [] },
      funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
      loans: [],
      investmentsPipeline: {
        items: [{
          id: "pipe-1", name: "Vana investeering", sourceType: "standalone", sourceRefId: null,
          plannedYear: 2027, totalCostEUR: 15000, fundingPlan: [{ source: "Remondifond", amountEUR: 15000 }],
        }],
      },
    },
    seisukord: [],
  };
}

// ── TESTS ────────────────────────────────────────────────────────────────────

describe("round-trip: export → import → export", () => {
  beforeEach(() => { _uid = 0; });

  it("canonical state survives round-trip semantically", () => {
    const plan = mkCanonicalPlan();
    const afterRT = roundTrip(plan);

    expect(semanticInvestments(afterRT.investments.items)).toEqual(semanticInvestments(plan.investments.items));
    expect(semanticLoans(afterRT.loans)).toEqual(semanticLoans(plan.loans));
    expect(semanticCondition(afterRT.assetCondition.items)).toEqual(semanticCondition(plan.assetCondition.items));
    expect(afterRT.funds.reserve.plannedEUR).toBe(plan.funds.reserve.plannedEUR);
  });

  it("double round-trip is stable", () => {
    const plan = mkCanonicalPlan();
    const rt1 = roundTrip(plan);
    const rt2 = roundTrip(rt1);

    expect(semanticInvestments(rt2.investments.items)).toEqual(semanticInvestments(rt1.investments.items));
    expect(semanticLoans(rt2.loans)).toEqual(semanticLoans(rt1.loans));
    expect(semanticCondition(rt2.assetCondition.items)).toEqual(semanticCondition(rt1.assetCondition.items));
  });
});

describe("v1 legacy import stabilization", () => {
  beforeEach(() => { _uid = 0; });

  it("v1 import produces canonical investments with sourceType", () => {
    const result = migrateImportState(mkV1LegacyBundle());
    expect(result.investments.items).toHaveLength(1);
    expect(result.investments.items[0].sourceType).toBe("condition_item");
    expect(result.investments.items[0].sourceRefId).toBe("sk-1");
    expect(result.investments.items[0].totalCostEUR).toBe(50000);
  });

  it("v1 import cleans assetCondition of inv fields", () => {
    const result = migrateImportState(mkV1LegacyBundle());
    const item = result.assetCondition.items[0];
    expect(item).not.toHaveProperty("investeering");
    expect(item).not.toHaveProperty("invNimetus");
    expect(item).not.toHaveProperty("rahpiiri");
  });

  it("re-importing v1 result does not drift", () => {
    _uid = 0;
    const first = migrateImportState(mkV1LegacyBundle());
    const exported = simulateExport(first);
    _uid = 0; // reset to get same IDs
    const bundle2 = { schemaVersion: "majanduskavaExport/v2", moduleId: "majanduskava", state: exported };
    const second = migrateImportState(bundle2);

    expect(semanticInvestments(second.investments.items)).toEqual(semanticInvestments(first.investments.items));
    expect(second.investments.items.length).toBe(first.investments.items.length);
  });
});

describe("v2 import stability", () => {
  it("v2 canonical import does not mutate structure", () => {
    const plan = mkCanonicalPlan();
    const bundle = { schemaVersion: "majanduskavaExport/v2", moduleId: "majanduskava", state: JSON.parse(JSON.stringify(plan)) };
    const result = migrateImportState(bundle);

    expect(result.investments.items.length).toBe(plan.investments.items.length);
    expect(semanticInvestments(result.investments.items)).toEqual(semanticInvestments(plan.investments.items));
  });
});

describe("investmentsPipeline cleanup", () => {
  it("pipeline input is migrated and removed from canonical export", () => {
    const result = migrateImportState(mkPipelineBundle());
    expect(result.investmentsPipeline).toBeUndefined();
    expect(result.investments.items).toHaveLength(1);
    expect(result.investments.items[0].name).toBe("Vana investeering");

    const exported = simulateExport(result);
    expect(exported.investmentsPipeline).toBeUndefined();
    expect(exported.investments.items).toHaveLength(1);
  });
});

describe("import does not create orphans or duplicates", () => {
  beforeEach(() => { _uid = 0; });

  it("no orphan loans after v1 import", () => {
    const result = migrateImportState(mkV1LegacyBundle());
    const orphans = result.loans.filter(l =>
      l.sepiiriostudInvId && !result.investments.items.some(i =>
        i.sourceRefId === l.sepiiriostudInvId || i.id === l.sepiiriostudInvId
      )
    );
    expect(orphans).toHaveLength(0);
  });

  it("no duplicate investments after re-import", () => {
    const plan = mkCanonicalPlan();
    const rt = roundTrip(plan);
    const ids = rt.investments.items.map(i => i.sourceRefId || i.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it("canonical plan passes consistency check after round-trip", () => {
    const plan = mkCanonicalPlan();
    const rt = roundTrip(plan);
    // Manually verify consistency of the round-tripped state
    const warnings = checkPlanConsistency(rt);
    expect(warnings).toEqual([]);
  });
});

describe("stabilization halts", () => {
  beforeEach(() => { _uid = 0; });

  it("repeated migration of same canonical state is idempotent", () => {
    const plan = mkCanonicalPlan();
    _uid = 0;
    const rt1 = roundTrip(plan);
    _uid = 0;
    const rt2 = roundTrip(rt1);

    // Structural equality (same field count, same values)
    expect(rt2.investments.items.length).toBe(rt1.investments.items.length);
    expect(rt2.assetCondition.items.length).toBe(rt1.assetCondition.items.length);
    expect(rt2.loans.length).toBe(rt1.loans.length);
    expect(semanticInvestments(rt2.investments.items)).toEqual(semanticInvestments(rt1.investments.items));
  });

  it("v1 → canonical → re-import converges in one step", () => {
    _uid = 0;
    const first = migrateImportState(mkV1LegacyBundle());
    const exported1 = simulateExport(first);

    _uid = 0;
    const second = migrateImportState({
      schemaVersion: "majanduskavaExport/v2", moduleId: "majanduskava", state: exported1,
    });
    const exported2 = simulateExport(second);

    // exported1 and exported2 should be semantically identical
    expect(semanticInvestments(JSON.parse(JSON.stringify(exported2)).investments.items))
      .toEqual(semanticInvestments(JSON.parse(JSON.stringify(exported1)).investments.items));
  });
});
