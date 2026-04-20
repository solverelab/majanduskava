import { describe, it, expect } from "vitest";
import {
  computeKopiiriondvaade,
  computeRemondifondiArvutus,
} from "./majanduskavaCalc";

// ── Test fixtures ────────────────────────────────────────────────────────────

const mkLoan = (id, invId, principal = 100000, rate = 3.6, term = 240) => ({
  id,
  principalEUR: principal,
  annualRatePct: rate,
  termMonths: term,
  sepiiriostudInvId: invId,
});

const mkInvestment = (id, sourceRefId, fundingSources) => ({
  id,
  name: `Inv-${id}`,
  sourceType: sourceRefId ? "condition_item" : "standalone",
  sourceRefId,
  plannedYear: 2028,
  totalCostEUR: 50000,
  fundingPlan: fundingSources.map(([source, amount]) => ({ source, amountEUR: amount })),
});

// ── 1. Tingimuslik laen (loanStatus = APPLIED) ──────────────────────────────

describe("Tingimuslik laen — loanStatus = APPLIED", () => {
  const linkedLoan = mkLoan("loan-1", "rida-1");
  const loans = [linkedLoan];

  it("kopiiriondvaade: laenumaksed ei sisaldu kokkuvõttes", () => {
    const costRows = [{ category: "Haldus", summaInput: "600", arvutus: "aastas" }];
    const r = computeKopiiriondvaade(costRows, [], loans, 12, "APPLIED");

    expect(r.planeeritudLaenudKuus).toBeGreaterThan(0); // loan exists
    expect(r.laenumaksedKokku).toBe(0); // but excluded from totals
    expect(r.tuludKokku).toBe(r.haldusKokku + r.muudTuludKokku); // no loan component
    expect(r.valjaminekudKokku).toBe(r.kuludKokku); // no loan component
  });

  it("remondifondiArvutus baseScenario: planeeritud laenumaksed = 0", () => {
    const inv = mkInvestment("inv-1", "rida-1", [["Laen", 30000], ["Remondifond", 20000]]);
    const r = computeRemondifondiArvutus({
      saldoAlgusRaw: "0",
      koguPind: 100,
      periodiAasta: 2026,
      pangaKoef: 1.15,
      kogumisViis: "eraldi",
      pangaMaarOverride: null,
      maarOverride: null,
      investments: [inv],
      loans,
      loanStatus: "APPLIED",
      monthEq: 12,
    });

    // Active scenario is baseScenario when APPLIED
    expect(r.loanApproved).toBe(false);
    // baseScenario excludes conditional investments, so no planned loan payments
    expect(r.baseScenario.planeeritudLaenumaksedKuus).toBe(0);
    expect(r.planeeritudLaenumaksedKuus).toBe(0);
  });
});

// ── 2. Kinnitatud laen (loanStatus = APPROVED) ──────────────────────────────

describe("Kinnitatud laen — loanStatus = APPROVED", () => {
  const linkedLoan = mkLoan("loan-1", "rida-1");
  const loans = [linkedLoan];

  it("kopiiriondvaade: laenumaksed sisalduvad kokkuvõttes", () => {
    const costRows = [{ category: "Haldus", summaInput: "600", arvutus: "aastas" }];
    const r = computeKopiiriondvaade(costRows, [], loans, 12, "APPROVED");

    expect(r.planeeritudLaenudKuus).toBeGreaterThan(0);
    expect(r.laenumaksedKokku).toBe(r.planeeritudLaenudKuus); // included
    expect(r.tuludKokku).toBe(r.haldusKokku + r.laenumaksedKokku + r.muudTuludKokku);
    expect(r.valjaminekudKokku).toBe(r.kuludKokku + r.laenumaksedKokku);
  });

  it("remondifondiArvutus loanScenario: planeeritud laenumaksed > 0", () => {
    const inv = mkInvestment("inv-1", "rida-1", [["Laen", 30000], ["Remondifond", 20000]]);
    const r = computeRemondifondiArvutus({
      saldoAlgusRaw: "0",
      koguPind: 100,
      periodiAasta: 2026,
      pangaKoef: 1.15,
      kogumisViis: "eraldi",
      pangaMaarOverride: null,
      maarOverride: null,
      investments: [inv],
      loans,
      loanStatus: "APPROVED",
      monthEq: 12,
    });

    expect(r.loanApproved).toBe(true);
    expect(r.loanScenario.planeeritudLaenumaksedKuus).toBeGreaterThan(0);
    expect(r.planeeritudLaenumaksedKuus).toBeGreaterThan(0);
    expect(r.onLaen).toBe(true);
  });
});

// ── 3. Seotud laenu kustutamine ──────────────────────────────────────────────

describe("Seotud laenu kustutamine — removeLoan loogika", () => {
  // Simulate the removeLoan setPlan updater
  function applyRemoveLoan(plan, loanId) {
    const loan = plan.loans.find(l => l.id === loanId);
    const linkedInvId = loan?.sepiiriostudInvId ?? null;
    const updatedLoans = plan.loans.filter(l => l.id !== loanId);
    const updatedInvestments = linkedInvId
      ? {
          ...plan.investments,
          items: plan.investments.items.map(inv => {
            if (inv.id !== linkedInvId && inv.sourceRefId !== linkedInvId) return inv;
            return {
              ...inv,
              fundingPlan: (inv.fundingPlan || []).filter(fp => fp.source !== "Laen"),
            };
          }),
        }
      : plan.investments;
    return { ...plan, loans: updatedLoans, investments: updatedInvestments };
  }

  it("eemaldab laenu ja puhastab investeeringu fundingPlan", () => {
    const inv = mkInvestment("inv-1", "rida-1", [["Laen", 30000], ["Remondifond", 20000]]);
    const plan = {
      loans: [mkLoan("loan-1", "rida-1")],
      investments: { items: [inv] },
    };

    const result = applyRemoveLoan(plan, "loan-1");

    expect(result.loans).toHaveLength(0);
    const updatedInv = result.investments.items[0];
    expect(updatedInv.fundingPlan).toHaveLength(1);
    expect(updatedInv.fundingPlan[0].source).toBe("Remondifond");
    expect(updatedInv.fundingPlan.some(fp => fp.source === "Laen")).toBe(false);
  });

  it("jätab teised investeeringud puutumata", () => {
    const inv1 = mkInvestment("inv-1", "rida-1", [["Laen", 30000], ["Remondifond", 20000]]);
    const inv2 = mkInvestment("inv-2", "rida-2", [["Laen", 15000], ["Toetus", 10000]]);
    const plan = {
      loans: [mkLoan("loan-1", "rida-1"), mkLoan("loan-2", "rida-2")],
      investments: { items: [inv1, inv2] },
    };

    const result = applyRemoveLoan(plan, "loan-1");

    expect(result.loans).toHaveLength(1);
    expect(result.loans[0].id).toBe("loan-2");
    // inv-2 untouched
    const untouched = result.investments.items.find(i => i.id === "inv-2");
    expect(untouched.fundingPlan).toHaveLength(2);
    expect(untouched.fundingPlan.some(fp => fp.source === "Laen")).toBe(true);
  });

  it("mittesiduslaenu kustutamine ei muuda investeeringuid", () => {
    const inv = mkInvestment("inv-1", "rida-1", [["Laen", 30000]]);
    const manualLoan = mkLoan("manual-loan", null, 50000);
    const plan = {
      loans: [manualLoan],
      investments: { items: [inv] },
    };

    const result = applyRemoveLoan(plan, "manual-loan");

    expect(result.loans).toHaveLength(0);
    expect(result.investments.items[0].fundingPlan).toHaveLength(1);
    expect(result.investments.items[0].fundingPlan[0].source).toBe("Laen");
  });
});

// ── 4. Vana faili import ─────────────────────────────────────────────────────

describe("Vana faili import — migratsiooni loogika", () => {
  // Simulate the migration logic from onImportJSON
  function migrateImport(data) {
    const candidateState = { ...data.state };

    // Strip investment quarters
    if (candidateState.investments?.items) {
      candidateState.investments.items = candidateState.investments.items.map(
        ({ quarter: _ignored, ...rest }) => rest
      );
    }

    // Migrate seisukord
    const rawAssetConditionItems = Array.isArray(candidateState.assetCondition?.items)
      ? candidateState.assetCondition.items
      : null;
    const rawLegacySeisukord =
      rawAssetConditionItems == null && Array.isArray(data.seisukord)
        ? data.seisukord
        : [];
    let importedSeisukord = (rawAssetConditionItems ?? rawLegacySeisukord).map(r => {
      const { tegevusKvartal: _ignored, ...rest } = r;
      return { tegevusAasta: "", eeldatavKulu: 0, tegevus: "", ...rest };
    });

    // Migrate "Muu" items out
    const importedMuudInv = [];
    importedSeisukord = importedSeisukord.filter(r => {
      if (r.ese === "Muu" && r.investeering) {
        importedMuudInv.push({
          nimetus: r.invNimetus || r.muuNimetus || "",
          aasta: r.tegevusAasta || "",
          maksumus: r.invMaksumus || 0,
          rahpiiri: r.rahpiiri || [],
        });
        return false;
      }
      return r.ese !== "Muu";
    });

    // Normalize investments
    const currentInvestmentItems =
      candidateState.investments?.items ??
      candidateState.investmentsPipeline?.items ??
      [];

    const needsMigration =
      !currentInvestmentItems.length ||
      !currentInvestmentItems[0]?.sourceType;

    if (needsMigration) {
      const investments = [];
      importedSeisukord.forEach(r => {
        if (r.investeering) {
          investments.push({
            id: `inv-${r.id}`,
            name: r.invNimetus || r.ese,
            plannedYear: Number(r.tegevusAasta) || 2026,
            totalCostEUR: Number(r.invMaksumus || r.eeldatavKulu) || 0,
            sourceType: "condition_item",
            sourceRefId: r.id,
            fundingPlan: (r.rahpiiri || []).map(rp => ({
              source: rp.allikas,
              amountEUR: Number(rp.summa) || 0,
            })),
          });
        }
      });
      importedMuudInv.forEach(m => {
        investments.push({
          id: `inv-muu-${Math.random()}`,
          name: m.nimetus,
          plannedYear: Number(m.aasta) || 2026,
          totalCostEUR: Number(m.maksumus) || 0,
          sourceType: "standalone",
          sourceRefId: null,
          fundingPlan: (m.rahpiiri || []).map(rp => ({
            source: rp.allikas,
            amountEUR: Number(rp.summa) || 0,
          })),
        });
      });
      candidateState.investments = { items: investments };
    }

    // Always normalize
    candidateState.investments = {
      items:
        candidateState.investments?.items ??
        candidateState.investmentsPipeline?.items ??
        [],
    };
    delete candidateState.investmentsPipeline;

    // Clean seisukord
    const cleanSeisukord = importedSeisukord.map(
      ({ investeering: _, invNimetus: __, invMaksumus: ___, rahpiiri: ____, ...rest }) => rest
    );
    candidateState.assetCondition = { items: cleanSeisukord };

    return candidateState;
  }

  it("v1 export ilma investments väljata → migreerib seisukorrast", () => {
    const data = {
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
          id: "sk-1", ese: "Katus", seisukordVal: "Halb", puudused: "Lekib",
          tegevus: "Remont", tegevusAasta: "2028", eeldatavKulu: 50000,
          investeering: true, invNimetus: "Katus — Remont", invMaksumus: 50000,
          rahpiiri: [{ allikas: "Remondifond", summa: 20000 }, { allikas: "Laen", summa: 30000 }],
        },
      ],
    };

    const result = migrateImport(data);

    // Investments migrated
    expect(result.investments.items).toHaveLength(1);
    expect(result.investments.items[0].sourceType).toBe("condition_item");
    expect(result.investments.items[0].sourceRefId).toBe("sk-1");
    expect(result.investments.items[0].fundingPlan).toHaveLength(2);

    // AssetCondition cleaned — no inv fields
    expect(result.assetCondition.items).toHaveLength(1);
    expect(result.assetCondition.items[0]).not.toHaveProperty("investeering");
    expect(result.assetCondition.items[0]).not.toHaveProperty("invNimetus");
    expect(result.assetCondition.items[0]).not.toHaveProperty("rahpiiri");

    // investmentsPipeline removed
    expect(result.investmentsPipeline).toBeUndefined();
  });

  it("v2 export koos investments.items-iga → ei migreeruks üle", () => {
    const data = {
      schemaVersion: "majanduskavaExport/v2",
      moduleId: "majanduskava",
      state: {
        period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
        building: { apartments: [] },
        budget: { costRows: [], incomeRows: [] },
        funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
        loans: [],
        investments: {
          items: [{
            id: "inv-1", name: "Fassaad", sourceType: "standalone", sourceRefId: null,
            plannedYear: 2027, totalCostEUR: 30000,
            fundingPlan: [{ source: "Remondifond", amountEUR: 30000 }],
          }],
        },
        assetCondition: { items: [] },
      },
    };

    const result = migrateImport(data);

    // Investment preserved as-is
    expect(result.investments.items).toHaveLength(1);
    expect(result.investments.items[0].id).toBe("inv-1");
    expect(result.investments.items[0].name).toBe("Fassaad");
  });

  it("vana investmentsPipeline väli → migreeritakse investments-iks", () => {
    const data = {
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
            id: "old-inv", name: "Vana", sourceType: "standalone", sourceRefId: null,
            plannedYear: 2027, totalCostEUR: 10000, fundingPlan: [],
          }],
        },
      },
      seisukord: [],
    };

    const result = migrateImport(data);

    expect(result.investmentsPipeline).toBeUndefined();
    expect(result.investments.items).toHaveLength(1);
    expect(result.investments.items[0].name).toBe("Vana");
  });
});

// ── 5. clearSection(1) — seisukorra sektsiooni tühjendamine ──────────────────

describe("clearSection(1) — hoone seisukord ja tööd", () => {
  // Simulate the clearSection(tabIdx===1) setPlan updater
  function applyClearSection1(plan) {
    const removedInvIds = new Set(
      plan.investments.items
        .filter(i => i.sourceType === "condition_item")
        .flatMap(i => [i.id, i.sourceRefId].filter(Boolean))
    );
    return {
      ...plan,
      assetCondition: { items: [] },
      investments: { ...plan.investments, items: plan.investments.items.filter(i => i.sourceType !== "condition_item") },
      loans: plan.loans.filter(l => !removedInvIds.has(l.sepiiriostudInvId)),
    };
  }

  const conditionInv = mkInvestment("inv-cond", "rida-1", [["Laen", 30000], ["Remondifond", 20000]]);
  const standaloneInv = mkInvestment("inv-standalone", null, [["Remondifond", 15000]]);

  function buildPlan() {
    return {
      assetCondition: {
        items: [
          { id: "rida-1", ese: "Katus", seisukordVal: "Halb" },
          { id: "rida-2", ese: "Fassaad", seisukordVal: "Hea" },
        ],
      },
      investments: { items: [conditionInv, standaloneInv] },
      loans: [
        mkLoan("loan-cond", "rida-1"),       // seotud condition_item investeeringuga
        mkLoan("loan-standalone", "inv-standalone"), // seotud standalone investeeringuga
        mkLoan("loan-manual", null, 20000),  // käsitsi lisatud
      ],
    };
  }

  it("eemaldab kõik seisukorra read", () => {
    const result = applyClearSection1(buildPlan());
    expect(result.assetCondition.items).toHaveLength(0);
  });

  it("eemaldab condition_item investeeringud", () => {
    const result = applyClearSection1(buildPlan());
    expect(result.investments.items.find(i => i.sourceType === "condition_item")).toBeUndefined();
  });

  it("eemaldab condition_item investeeringutega seotud laenud", () => {
    const result = applyClearSection1(buildPlan());
    expect(result.loans.find(l => l.id === "loan-cond")).toBeUndefined();
  });

  it("jätab standalone investeeringud alles", () => {
    const result = applyClearSection1(buildPlan());
    const standalone = result.investments.items.find(i => i.id === "inv-standalone");
    expect(standalone).toBeDefined();
    expect(standalone.sourceType).toBe("standalone");
  });

  it("jätab standalone ja käsitsi laenud alles", () => {
    const result = applyClearSection1(buildPlan());
    expect(result.loans.find(l => l.id === "loan-standalone")).toBeDefined();
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
    expect(result.loans).toHaveLength(2);
  });
});

// ── 6. Investeeringu/laenu kustutamise invariandid ───────────────────────────

describe("investeeringu/laenu kustutamise invariandid", () => {
  // --- Simulaatorid (sama loogika mis App.jsx setPlan updater-ites) ---

  function applyEemaldaInvesteering(plan, sourceRefId) {
    const inv = plan.investments.items.find(i => i.sourceRefId === sourceRefId);
    const hasLoan = (inv?.fundingPlan || []).some(fp => fp.source === "Laen");
    return {
      ...plan,
      investments: { ...plan.investments, items: plan.investments.items.filter(i => i.sourceRefId !== sourceRefId) },
      loans: hasLoan ? plan.loans.filter(l => l.sepiiriostudInvId !== sourceRefId) : plan.loans,
    };
  }

  function applyEemaldaStandalone(plan, invId) {
    const inv = plan.investments.items.find(i => i.id === invId);
    const hasLoan = (inv?.fundingPlan || []).some(fp => fp.source === "Laen");
    return {
      ...plan,
      investments: { ...plan.investments, items: plan.investments.items.filter(i => i.id !== invId) },
      loans: hasLoan ? plan.loans.filter(l => l.sepiiriostudInvId !== invId) : plan.loans,
    };
  }

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

  // --- Fixtures ---

  const condInv = mkInvestment("inv-cond", "rida-1", [["Laen", 30000], ["Remondifond", 20000]]);
  const standInv = mkInvestment("inv-stand", null, [["Laen", 25000], ["Toetus", 10000]]);
  const cleanInv = mkInvestment("inv-clean", "rida-2", [["Remondifond", 40000]]);

  function buildPlan() {
    return {
      investments: { items: [condInv, standInv, cleanInv] },
      loans: [
        mkLoan("loan-cond", "rida-1"),
        mkLoan("loan-stand", "inv-stand"),
        mkLoan("loan-manual", null, 20000),
      ],
    };
  }

  // --- 1. condition_item investeeringu kustutamine eemaldab seotud laenu ---
  it("condition_item investeeringu kustutamine eemaldab seotud laenu", () => {
    const result = applyEemaldaInvesteering(buildPlan(), "rida-1");
    expect(result.investments.items.find(i => i.sourceRefId === "rida-1")).toBeUndefined();
    expect(result.loans.find(l => l.id === "loan-cond")).toBeUndefined();
  });

  // --- 2. standalone investeeringu kustutamine eemaldab seotud laenu ---
  it("standalone investeeringu kustutamine eemaldab seotud laenu", () => {
    const result = applyEemaldaStandalone(buildPlan(), "inv-stand");
    expect(result.investments.items.find(i => i.id === "inv-stand")).toBeUndefined();
    expect(result.loans.find(l => l.id === "loan-stand")).toBeUndefined();
  });

  // --- 3. seotud laenu kustutamine puhastab condition_item fundingPlan ---
  it("seotud laenu kustutamine eemaldab fundingPlan-ist Laen rea (condition_item)", () => {
    const result = applyRemoveLoan(buildPlan(), "loan-cond");
    expect(result.loans.find(l => l.id === "loan-cond")).toBeUndefined();
    const inv = result.investments.items.find(i => i.sourceRefId === "rida-1");
    expect(inv).toBeDefined();
    expect(inv.fundingPlan.some(fp => fp.source === "Laen")).toBe(false);
    expect(inv.fundingPlan.some(fp => fp.source === "Remondifond")).toBe(true);
  });

  // --- 4. seotud laenu kustutamine puhastab standalone fundingPlan ---
  it("seotud laenu kustutamine eemaldab fundingPlan-ist Laen rea (standalone)", () => {
    const result = applyRemoveLoan(buildPlan(), "loan-stand");
    expect(result.loans.find(l => l.id === "loan-stand")).toBeUndefined();
    const inv = result.investments.items.find(i => i.id === "inv-stand");
    expect(inv).toBeDefined();
    expect(inv.fundingPlan.some(fp => fp.source === "Laen")).toBe(false);
    expect(inv.fundingPlan.some(fp => fp.source === "Toetus")).toBe(true);
  });

  // --- 5. mitteseotud laenu kustutamine ei muuda investeeringuid ---
  it("mitteseotud laenu kustutamine ei muuda investeeringuid", () => {
    const plan = buildPlan();
    const result = applyRemoveLoan(plan, "loan-manual");
    expect(result.loans.find(l => l.id === "loan-manual")).toBeUndefined();
    // All investments unchanged
    expect(result.investments.items).toHaveLength(3);
    result.investments.items.forEach((inv, i) => {
      expect(inv.fundingPlan).toEqual(plan.investments.items[i].fundingPlan);
    });
  });

  // --- 6. ühe paari kustutamine ei mõjuta teisi paare ---
  it("ühe paari kustutamine ei mõjuta teisi paare", () => {
    const result = applyEemaldaInvesteering(buildPlan(), "rida-1");
    // standalone pair intact
    expect(result.investments.items.find(i => i.id === "inv-stand")).toBeDefined();
    expect(result.loans.find(l => l.id === "loan-stand")).toBeDefined();
    // clean inv intact
    expect(result.investments.items.find(i => i.id === "inv-clean")).toBeDefined();
    // manual loan intact
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ── 7. Rahastusplaani ja laenu sünkrooni invariandid ─────────────────────────

describe("rahastusplaani ja laenu sünkroon", () => {
  // --- Simulaatorid (sama loogika mis App.jsx setPlan updater-ites) ---

  // syncLoan: pure helper — returns updated loans array
  function syncLoan(p, investeeringId, laenSumma) {
    const olemas = p.loans.find(l => l.sepiiriostudInvId === investeeringId);
    if (olemas) {
      return p.loans.map(l =>
        l.sepiiriostudInvId === investeeringId ? { ...l, principalEUR: laenSumma } : l
      );
    }
    return [...p.loans, {
      id: `auto-loan-${investeeringId}`,
      liik: "Investeerimislaen",
      sepiiriostudInvId: investeeringId,
      principalEUR: laenSumma,
      termMonths: 12,
    }];
  }

  // uuendaRahpiiriRida for condition_item (matches by sourceRefId)
  function applyUuendaCondRahpiiri(plan, sourceRefId, ri, patch) {
    const fpPatch = {};
    if (patch.allikas !== undefined) fpPatch.source = patch.allikas;
    if (patch.summa !== undefined) fpPatch.amountEUR = Number(patch.summa) || 0;

    const inv = plan.investments.items.find(i => i.sourceRefId === sourceRefId);
    const vanaAllikas = inv?.fundingPlan?.[ri]?.source;
    const uusAllikas = fpPatch.source !== undefined ? fpPatch.source : vanaAllikas;

    const updatedItems = plan.investments.items.map(i =>
      i.sourceRefId === sourceRefId
        ? { ...i, fundingPlan: (i.fundingPlan || []).map((fp, fi) => fi === ri ? { ...fp, ...fpPatch } : fp) }
        : i
    );

    let loans = plan.loans;
    if (uusAllikas === "Laen" && vanaAllikas !== "Laen") {
      const summa = fpPatch.amountEUR ?? (inv?.fundingPlan?.[ri]?.amountEUR || 0);
      loans = syncLoan(plan, sourceRefId, summa);
    } else if (vanaAllikas === "Laen" && uusAllikas !== "Laen") {
      loans = plan.loans.filter(l => l.sepiiriostudInvId !== sourceRefId);
    } else if (uusAllikas === "Laen" && fpPatch.amountEUR !== undefined) {
      loans = syncLoan(plan, sourceRefId, fpPatch.amountEUR);
    }

    return { ...plan, investments: { ...plan.investments, items: updatedItems }, loans };
  }

  // handleStandaloneRahpiiriChange (matches by inv.id)
  function applyStandaloneRahpiiriChange(plan, invId, ridaIdx, field, value) {
    const fpPatch = {};
    if (field === "allikas") fpPatch.source = value;
    if (field === "summa") fpPatch.amountEUR = Number(value) || 0;

    const inv = plan.investments.items.find(i => i.id === invId);
    const vanaAllikas = inv?.fundingPlan?.[ridaIdx]?.source;
    const uusAllikas = field === "allikas" ? value : vanaAllikas;

    const updatedItems = plan.investments.items.map(i =>
      i.id === invId
        ? { ...i, fundingPlan: (i.fundingPlan || []).map((fp, ri) => ri === ridaIdx ? { ...fp, ...fpPatch } : fp) }
        : i
    );

    let loans = plan.loans;
    if (uusAllikas === "Laen" && vanaAllikas !== "Laen") {
      const summa = fpPatch.amountEUR ?? (inv?.fundingPlan?.[ridaIdx]?.amountEUR || 0);
      loans = syncLoan(plan, invId, summa);
    } else if (vanaAllikas === "Laen" && uusAllikas !== "Laen") {
      loans = plan.loans.filter(l => l.sepiiriostudInvId !== invId);
    } else if (uusAllikas === "Laen" && field === "summa") {
      loans = syncLoan(plan, invId, Number(value) || 0);
    }

    return { ...plan, investments: { ...plan.investments, items: updatedItems }, loans };
  }

  // eemaldaRahpiiriRida for condition_item
  function applyEemaldaCondRahpiiri(plan, sourceRefId, ri) {
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

  // --- Fixtures ---

  function mkPlanWithCondInv() {
    const inv = mkInvestment("inv-c", "rida-1", [["Remondifond", 20000]]);
    return { investments: { items: [inv] }, loans: [], period: { year: 2026 } };
  }

  function mkPlanWithStandInv() {
    const inv = { ...mkInvestment("inv-s", null, [["Toetus", 10000]]), sourceType: "standalone" };
    return { investments: { items: [inv] }, loans: [], period: { year: 2026 } };
  }

  // --- 1. condition_item laenurea summa muutus uuendab seotud laenu ---
  it("condition_item laenurea summa muutus uuendab principalEUR", () => {
    // First add "Laen" source
    let plan = mkPlanWithCondInv();
    plan = applyUuendaCondRahpiiri(plan, "rida-1", 0, { allikas: "Laen", summa: 30000 });
    expect(plan.loans).toHaveLength(1);
    expect(plan.loans[0].principalEUR).toBe(30000);

    // Update amount
    plan = applyUuendaCondRahpiiri(plan, "rida-1", 0, { summa: 45000 });
    expect(plan.loans).toHaveLength(1);
    expect(plan.loans[0].principalEUR).toBe(45000);
  });

  // --- 2. standalone laenurea summa muutus uuendab seotud laenu ---
  it("standalone laenurea summa muutus uuendab principalEUR", () => {
    let plan = mkPlanWithStandInv();
    plan = applyStandaloneRahpiiriChange(plan, "inv-s", 0, "allikas", "Laen");
    expect(plan.loans).toHaveLength(1);

    plan = applyStandaloneRahpiiriChange(plan, "inv-s", 0, "summa", 50000);
    expect(plan.loans).toHaveLength(1);
    expect(plan.loans[0].principalEUR).toBe(50000);
  });

  // --- 3. condition_item laenurea lisamine tekitab täpselt ühe seotud laenu ---
  it("condition_item Laen allika lisamine tekitab ühe laenu", () => {
    const plan = mkPlanWithCondInv();
    const result = applyUuendaCondRahpiiri(plan, "rida-1", 0, { allikas: "Laen", summa: 25000 });
    expect(result.loans).toHaveLength(1);
    expect(result.loans[0].sepiiriostudInvId).toBe("rida-1");
    expect(result.loans[0].principalEUR).toBe(25000);
  });

  // --- 4. standalone laenurea lisamine tekitab täpselt ühe seotud laenu ---
  it("standalone Laen allika lisamine tekitab ühe laenu", () => {
    const plan = mkPlanWithStandInv();
    const result = applyStandaloneRahpiiriChange(plan, "inv-s", 0, "allikas", "Laen");
    expect(result.loans).toHaveLength(1);
    expect(result.loans[0].sepiiriostudInvId).toBe("inv-s");
  });

  // --- 5. Laen -> muu allika muutmine eemaldab seotud laenu ---
  it("condition_item Laen -> Toetus eemaldab seotud laenu", () => {
    let plan = mkPlanWithCondInv();
    plan = applyUuendaCondRahpiiri(plan, "rida-1", 0, { allikas: "Laen", summa: 20000 });
    expect(plan.loans).toHaveLength(1);

    plan = applyUuendaCondRahpiiri(plan, "rida-1", 0, { allikas: "Toetus" });
    expect(plan.loans).toHaveLength(0);
  });

  // --- 6. laenurea eemaldamine ei jäta orphan-seoseid ---
  it("condition_item laenurea eemaldamine eemaldab seotud laenu", () => {
    let plan = mkPlanWithCondInv();
    plan = applyUuendaCondRahpiiri(plan, "rida-1", 0, { allikas: "Laen", summa: 30000 });
    expect(plan.loans).toHaveLength(1);

    plan = applyEemaldaCondRahpiiri(plan, "rida-1", 0);
    expect(plan.loans).toHaveLength(0);
    // fundingPlan should now be empty (Remondifond was index 0 originally, replaced by Laen, then removed)
    const inv = plan.investments.items.find(i => i.sourceRefId === "rida-1");
    expect(inv.fundingPlan.some(fp => fp.source === "Laen")).toBe(false);
  });

  // --- 7. korduv muutmine ei tekita mitut seotud laenu ---
  it("korduv summa muutmine ei tekita duplikaatlaene", () => {
    let plan = mkPlanWithCondInv();
    plan = applyUuendaCondRahpiiri(plan, "rida-1", 0, { allikas: "Laen", summa: 10000 });
    plan = applyUuendaCondRahpiiri(plan, "rida-1", 0, { summa: 20000 });
    plan = applyUuendaCondRahpiiri(plan, "rida-1", 0, { summa: 30000 });
    plan = applyUuendaCondRahpiiri(plan, "rida-1", 0, { summa: 40000 });

    expect(plan.loans).toHaveLength(1);
    expect(plan.loans[0].principalEUR).toBe(40000);
  });
});
