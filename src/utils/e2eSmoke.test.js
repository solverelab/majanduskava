// src/utils/e2eSmoke.test.js
// End-to-end smoke test: full workflow from empty plan to export/import round-trip
import { describe, it, expect } from "vitest";
import { defaultPlan, mkApartment, mkCashflowRow, mkInvestmentItem, mkLoan } from "../domain/planSchema";
import { computePlan } from "../engine/computePlan";
import { syncLoan } from "./syncLoan";
import { cleanupOrphanLinkedLoans } from "./planCleanup";
import { normalizeInvestmentsField } from "./importNormalize";
import { syncRepairFundRate, syncRepairFundOpeningBalance, fillMissingYearsFromPeriod } from "./planSync";
import { computeRemondifondiArvutus, computeKopiiriondvaade, computeReserveMin, investmentStatus, isInvestmentCounted } from "./majanduskavaCalc";
import { isInvestmentReady } from "./investmentInclusion";
import { computeKokkuvoteKihistus } from "./kokkuvoteKihistus";

// ── Helpers mirroring App handlers ──

function addApartment(plan, label, areaM2) {
  return { ...plan, building: { ...plan.building, apartments: [...plan.building.apartments, mkApartment({ label, areaM2 })] } };
}

function addSeisukordRida(plan, rida) {
  return { ...plan, assetCondition: { ...plan.assetCondition, items: [...(plan.assetCondition?.items || []), rida] } };
}

function looInvesteering(plan, rida) {
  if (plan.investments.items.some(i => i.sourceRefId === rida.id)) return plan;
  const nimi = rida.ese + (rida.tegevus ? " — " + rida.tegevus : "");
  const newInv = {
    ...mkInvestmentItem({ name: nimi, plannedYear: Number(rida.tegevusAasta) || plan.period.year, totalCostEUR: rida.eeldatavKulu || 0 }),
    sourceType: "condition_item",
    sourceRefId: rida.id,
    fundingPlan: [],
  };
  return { ...plan, investments: { ...plan.investments, items: [...plan.investments.items, newInv] } };
}

function lisaStandaloneInvesteering(plan, name, totalCostEUR, plannedYear) {
  const newInv = {
    ...mkInvestmentItem({ name, plannedYear, totalCostEUR }),
    sourceType: "standalone",
    sourceRefId: null,
    fundingPlan: [],
  };
  return { ...plan, investments: { ...plan.investments, items: [...plan.investments.items, newInv] } };
}

function lisaRahpiiriRida(plan, sourceRefId) {
  return {
    ...plan,
    investments: {
      ...plan.investments,
      items: plan.investments.items.map(i =>
        i.sourceRefId === sourceRefId
          ? { ...i, fundingPlan: [...(i.fundingPlan || []), { source: "", amountEUR: 0 }] }
          : i
      ),
    },
  };
}

function uuendaRahpiiriRida(plan, sourceRefId, ri, patch) {
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

function addCostRow(plan, category, summaInput, arvutus) {
  const row = {
    ...mkCashflowRow({ side: "COST" }),
    category,
    arvutus: arvutus || "perioodis",
    summaInput,
    calc: { type: "FIXED_PERIOD", params: { amountEUR: parseFloat(summaInput) || 0 } },
  };
  return { ...plan, budget: { ...plan.budget, costRows: [...plan.budget.costRows, row] } };
}

function addIncomeRow(plan, category, summaInput) {
  const row = {
    ...mkCashflowRow({ side: "INCOME" }),
    category: category || "Muu tulu",
    arvutus: "perioodis",
    summaInput,
    calc: { type: "FIXED_PERIOD", params: { amountEUR: parseFloat(summaInput) || 0 } },
  };
  return { ...plan, budget: { ...plan.budget, incomeRows: [...plan.budget.incomeRows, row] } };
}

// ── Simulate export → import round-trip ──
function simulateExport(plan, remondifond, loanStatus) {
  const cleanState = { ...plan, investments: { items: plan.investments?.items || [] } };
  delete cleanState.investmentsPipeline;
  return {
    schemaVersion: "majanduskavaExport/v2",
    moduleId: "majanduskava",
    preset: "BALANCED",
    state: cleanState,
    kyData: { nimi: "TestKÜ", registrikood: "12345", aadress: "Test 1" },
    remondifond,
    resKap: { saldoAlgus: "", kasutamine: "", pohjendus: "" },
    loanStatus,
  };
}

function simulateImport(bundle) {
  // Minimal import path for v2 with canonical sourceType
  const data = JSON.parse(JSON.stringify(bundle)); // deep clone
  if (data.schemaVersion !== "majanduskavaExport/v2") throw new Error("wrong schema");
  if (data.moduleId !== "majanduskava") throw new Error("wrong module");
  const candidateState = data.state;
  const currentItems = candidateState.investments?.items ?? [];
  const needsMigration = !currentItems.length || !currentItems[0]?.sourceType;
  if (needsMigration) throw new Error("unexpected migration needed in v2 round-trip");
  normalizeInvestmentsField(candidateState);
  return candidateState;
}

// ══════════════════════════════════════════════════════════════════════
// Full end-to-end smoke test
// ══════════════════════════════════════════════════════════════════════

describe("E2E smoke: full workflow", () => {
  // Step 1: create empty plan
  let plan = defaultPlan({ year: 2027 });

  it("Step 1: new plan has correct structure", () => {
    expect(plan.period.year).toBe(2027);
    expect(plan.investments.items).toEqual([]);
    expect(plan.assetCondition.items).toEqual([]);
    expect(plan.loans).toEqual([]);
    expect(plan.building.apartments).toEqual([]);
  });

  // Step 2: add apartments
  it("Step 2: add apartments", () => {
    plan = addApartment(plan, "1", 52.3);
    plan = addApartment(plan, "2", 48.7);
    plan = { ...plan, period: { ...plan.period, start: "2027-01-01", end: "2027-12-31" } };

    expect(plan.building.apartments).toHaveLength(2);
    expect(plan.building.apartments[0].areaM2).toBe(52.3);
  });

  // Step 3: add seisukord row → create investment
  const ridaId = "rida-smoke-1";
  const rida = {
    id: ridaId,
    ese: "Katus",
    seisukordVal: "Mitterahuldav",
    puudused: "Lekked",
    prioriteet: "Kõrge",
    tegevus: "Katuse remont",
    tegevusAasta: "2028",
    eeldatavKulu: 45000,
  };

  it("Step 3: add condition row and create investment", () => {
    plan = addSeisukordRida(plan, rida);
    expect(plan.assetCondition.items).toHaveLength(1);

    plan = looInvesteering(plan, rida);
    const inv = plan.investments.items.find(i => i.sourceRefId === ridaId);
    expect(inv).toBeDefined();
    expect(inv.name).toBe("Katus — Katuse remont");
    expect(inv.totalCostEUR).toBe(45000);
    expect(inv.plannedYear).toBe(2028);
    expect(inv.sourceType).toBe("condition_item");
    expect(inv.fundingPlan).toEqual([]);

    // Idempotent: second call does nothing
    const plan2 = looInvesteering(plan, rida);
    expect(plan2.investments.items).toHaveLength(1);
  });

  // Step 4: add standalone investment
  it("Step 4: add standalone investment", () => {
    plan = lisaStandaloneInvesteering(plan, "Energiaaudit", 5000, 2027);
    const standalone = plan.investments.items.find(i => i.sourceType === "standalone");
    expect(standalone).toBeDefined();
    expect(standalone.name).toBe("Energiaaudit");
    expect(standalone.totalCostEUR).toBe(5000);
    expect(plan.investments.items).toHaveLength(2);
  });

  // Step 5: set funding source to Laen
  it("Step 5: set funding source to Laen creates linked loan", () => {
    plan = lisaRahpiiriRida(plan, ridaId);
    plan = uuendaRahpiiriRida(plan, ridaId, 0, { allikas: "Laen", summa: 30000 });

    const inv = plan.investments.items.find(i => i.sourceRefId === ridaId);
    expect(inv.fundingPlan[0]).toEqual({ source: "Laen", amountEUR: 30000 });
  });

  // Step 6: verify linked loan created
  it("Step 6: linked loan exists with correct fields", () => {
    const loan = plan.loans.find(l => l.sepiiriostudInvId === ridaId);
    expect(loan).toBeDefined();
    expect(loan.principalEUR).toBe(30000);
    expect(loan.liik).toBe("Investeerimislaen");
    expect(loan.algusAasta).toBe("2027");
    expect(loan.termMonths).toBe(12);
    expect(plan.loans).toHaveLength(1);
  });

  // Step 7: change funding source Laen → Remondifond, verify loan removed
  it("Step 7: Laen → Remondifond removes linked loan", () => {
    plan = uuendaRahpiiriRida(plan, ridaId, 0, { allikas: "Remondifond" });

    const inv = plan.investments.items.find(i => i.sourceRefId === ridaId);
    expect(inv.fundingPlan[0].source).toBe("Remondifond");
    expect(plan.loans.find(l => l.sepiiriostudInvId === ridaId)).toBeUndefined();
    expect(plan.loans).toHaveLength(0);
  });

  // Add costs and income for a meaningful plan
  it("Steps 5-7 aftermath: add costs/income for complete plan", () => {
    plan = addCostRow(plan, "Soojus", "12000");
    plan = addCostRow(plan, "Haldus", "3600", "aastas");
    plan = addIncomeRow(plan, "Muu tulu", "400");
    expect(plan.budget.costRows).toHaveLength(2);
    expect(plan.budget.incomeRows).toHaveLength(1);
  });

  // Step 8+9+10: export/import round-trip
  it("Steps 8-10: export → import round-trip preserves all data", () => {
    const remondifond = { saldoAlgus: "5000", kogumisViis: "eraldi", pangaKoefitsient: 1.15, pangaMaarOverride: null, maarOverride: null };
    const loanStatus = "APPLIED";

    // Add back a loan for round-trip test
    plan = uuendaRahpiiriRida(plan, ridaId, 0, { allikas: "Laen", summa: 25000 });
    expect(plan.loans).toHaveLength(1);

    const bundle = simulateExport(plan, remondifond, loanStatus);

    // Verify bundle structure
    expect(bundle.schemaVersion).toBe("majanduskavaExport/v2");
    expect(bundle.state.investments.items).toHaveLength(2);
    expect(bundle.state.loans).toHaveLength(1);
    expect(bundle.state.assetCondition.items).toHaveLength(1);
    expect(bundle.state.building.apartments).toHaveLength(2);

    // Import
    const imported = simulateImport(bundle);

    // Verify round-trip
    expect(imported.investments.items).toHaveLength(2);
    expect(imported.loans).toHaveLength(1);
    expect(imported.assetCondition.items).toHaveLength(1);
    expect(imported.building.apartments).toHaveLength(2);
    expect(imported.budget.costRows).toHaveLength(2);
    expect(imported.budget.incomeRows).toHaveLength(1);

    // Condition-item investment preserved
    const condInv = imported.investments.items.find(i => i.sourceType === "condition_item");
    expect(condInv.name).toBe("Katus — Katuse remont");
    expect(condInv.totalCostEUR).toBe(45000);
    expect(condInv.fundingPlan[0]).toEqual({ source: "Laen", amountEUR: 25000 });

    // Standalone investment preserved
    const standInv = imported.investments.items.find(i => i.sourceType === "standalone");
    expect(standInv.name).toBe("Energiaaudit");
    expect(standInv.totalCostEUR).toBe(5000);

    // Linked loan preserved
    const loan = imported.loans[0];
    expect(loan.sepiiriostudInvId).toBe(ridaId);
    expect(loan.principalEUR).toBe(25000);

    // No investmentsPipeline leakage
    expect(imported.investmentsPipeline).toBeUndefined();
  });

  // Step 11: print-view computations with this data
  it("Step 11: computePlan + derived views produce valid output", () => {
    const derived = computePlan(plan);

    // Building
    expect(derived.building.apartmentsCount).toBe(2);
    expect(derived.building.totAreaM2).toBeCloseTo(101, 0);

    // Period
    expect(derived.period.monthEq).toBe(12);

    // Investments — condition_item has Laen funding but no name? No, it has name
    const condInv = plan.investments.items.find(i => i.sourceType === "condition_item");
    const condStatus = investmentStatus(condInv);
    // totalCostEUR=45000, fundingPlan=[{source:"Laen",amountEUR:25000}] → kaetud < cost → NOT BLOCKED, has name, has cost, has rows with amount → READY
    expect(condStatus).toBe("READY");

    const standInv = plan.investments.items.find(i => i.sourceType === "standalone");
    const standStatus = investmentStatus(standInv);
    // totalCostEUR=5000, fundingPlan=[] → no real rows → DRAFT
    expect(standStatus).toBe("DRAFT");

    // computeKopiiriondvaade
    const kv = computeKopiiriondvaade(plan.budget.costRows, plan.budget.incomeRows, plan.loans, 12, "APPLIED");
    expect(kv.kommunaalKokku).toBe(1000); // 12000/12
    expect(kv.haldusKokku).toBe(300); // 3600/12
    expect(kv.muudTuludKokku).toBe(Math.round(400 / 12)); // perioodis: 400/12
    expect(kv.olemasolevadLaenudKuus).toBe(0); // linked loan has sepiiriostudInvId
    expect(kv.planeeritudLaenudKuus).toBeGreaterThan(0); // linked loan is planned
    expect(kv.laenumaksedKokku).toBe(0); // APPLIED: only olemasolevad

    // computeReserveMin
    const reserveMin = computeReserveMin(plan.budget.costRows, 12);
    expect(reserveMin.noutavMiinimum).toBeGreaterThan(0);

    // computeRemondifondiArvutus
    const ra = computeRemondifondiArvutus({
      saldoAlgusRaw: "5000",
      koguPind: derived.building.totAreaM2,
      periodiAasta: 2027,
      pangaKoef: 1.15,
      kogumisViis: "eraldi",
      pangaMaarOverride: null,
      maarOverride: null,
      investments: plan.investments.items,
      loans: plan.loans,
      loanStatus: "APPLIED",
      monthEq: 12,
    });
    expect(ra.saldoAlgus).toBe(5000);
    expect(ra.maarAastasM2).toBeGreaterThanOrEqual(0);
    expect(typeof ra.laekuminePerioodis).toBe("number");
    expect(typeof ra.saldoLopp).toBe("number");

    // korteriteKuumaksed (manual computation matching App useMemo)
    const rfKuuKokku = ra.maarAastasM2 * derived.building.totAreaM2 / 12;
    const laenKuuKokku = ra.olemasolevLaenumaksedKuus + (ra.loanApproved ? ra.planeeritudLaenumaksedKuus : 0);
    const reservKuuKokku = reserveMin.noutavMiinimum / 12;
    const km = plan.building.apartments.map(k => {
      const pind = parseFloat(k.areaM2) || 0;
      const osa = derived.building.totAreaM2 > 0 ? pind / derived.building.totAreaM2 : 0;
      return {
        id: k.id, tahis: k.label, pind, osa,
        kommunaal: Math.round(kv.kommunaalKokku * osa),
        haldus: Math.round(kv.haldusKokku * osa),
        remondifond: Math.round(rfKuuKokku * osa),
        laenumakse: Math.round(laenKuuKokku * osa),
        reserv: Math.round(reservKuuKokku * osa),
        kokku: Math.round(kv.kommunaalKokku * osa) + Math.round(kv.haldusKokku * osa) + Math.round(rfKuuKokku * osa) + Math.round(laenKuuKokku * osa) + Math.round(reservKuuKokku * osa),
      };
    });
    expect(km).toHaveLength(2);
    expect(km[0].kommunaal).toBeGreaterThan(0);
    expect(km[0].haldus).toBeGreaterThan(0);
    expect(km[0].kokku).toBeGreaterThan(0);

    // kokkuvoteKihistus
    const kkv = computeKokkuvoteKihistus({ korteriteKuumaksed: km });
    expect(kkv).toHaveLength(2);
    expect(kkv[0].total).toBeGreaterThan(0);
    expect(kkv[0].components.length).toBeGreaterThan(0);
    expect(kkv[0].components.every(c => c.eur > 0)).toBe(true);
    expect(kkv[0].eurPerM2).toBeGreaterThan(0);

    // No NaN anywhere
    [kv.kommunaalKokku, kv.haldusKokku, kv.laenumaksedKokku,
     ra.maarAastasM2, ra.saldoLopp, ra.laekuminePerioodis,
     ...km.map(k => k.kokku), ...kkv.map(k => k.total)].forEach(v => {
      expect(Number.isNaN(v)).toBe(false);
      expect(Number.isFinite(v)).toBe(true);
    });
  });

  // Orphan cleanup safety net
  it("cleanupOrphanLinkedLoans is no-op for consistent state", () => {
    const cleaned = cleanupOrphanLinkedLoans(plan);
    expect(cleaned.loans).toHaveLength(plan.loans.length);
  });

  // fillMissingYearsFromPeriod
  it("fillMissingYearsFromPeriod is no-op when years already set", () => {
    const filled = fillMissingYearsFromPeriod(plan, 2027);
    expect(filled.assetCondition.items[0].tegevusAasta).toBe("2028"); // unchanged
  });
});
