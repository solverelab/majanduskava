import { describe, it, expect } from "vitest";
import { defaultPlan, mkApartment, mkCashflowRow, mkInvestmentItem, mkLoan } from "../domain/planSchema";
import { computePlan } from "../engine/computePlan";
import { computeRemondifondiArvutus, computeKopiiriondvaade, computeReserveMin } from "./majanduskavaCalc";
import { syncLoan } from "./syncLoan";
import { parseNumericInput } from "./parseNumericInput";

// ══════════════════════════════════════════════════════════════════════
// Mirrors tabStatus, print filters, and solver display from App
// ══════════════════════════════════════════════════════════════════════

function computeTabStatus(plan) {
  const hasPeriod = plan.period.start && plan.period.end;
  const hasAnyApt = plan.building.apartments.length > 0;
  const hasRealApt = plan.building.apartments.some(a => (parseFloat(a.areaM2) || 0) > 0);
  const hasRealCost = plan.budget.costRows.some(r => (parseFloat(r.summaInput) || 0) > 0);
  const seisukord = plan.assetCondition?.items || [];
  return {
    tab0: (hasPeriod && hasRealApt) ? "done" : (plan.period.start || plan.period.end || hasAnyApt) ? "partial" : "empty",
    tab1: seisukord.some(r => r.ese) ? "done" : "empty",
    tab2: hasRealCost ? "done" : plan.budget.costRows.length > 0 ? "partial" : "empty",
    tab3: plan.budget.incomeRows.some(r => (parseFloat(r.summaInput) || 0) > 0) ? "done" : plan.budget.incomeRows.length > 0 ? "partial" : "empty",
    tab4: (plan.loans.length > 0 || plan.funds.repairFund.monthlyRateEurPerM2 > 0) ? "done" : "empty",
    tab5: (hasRealApt && hasPeriod) ? "done" : hasAnyApt ? "partial" : "empty",
    tab6: (() => {
      if (hasRealApt && hasPeriod && hasRealCost) return "done";
      if (hasAnyApt || hasPeriod || hasRealCost) return "partial";
      return "empty";
    })(),
  };
}

const printCostFilter = (r) => (parseFloat(r.summaInput) || 0) > 0;
const printIncomeFilter = (r) => (parseFloat(r.summaInput) || 0) > 0;

function solveStatusMsg(stoppedBecause) {
  if (stoppedBecause === "NO_ACTIONS") return "Enam soovitusi pole.";
  if (stoppedBecause === "NO_PROGRESS") return "Lõpetan: risk ega hoiatused/vead ei paranenud.";
  if (stoppedBecause === "LOOP_GUARD") return "Lõpetan: korduv soovitus.";
  if (stoppedBecause === "MAX_STEPS") return "Lõpetan: max sammud täis.";
  if (stoppedBecause === "NO_CHOICE") return "Lõpetan: sobivat soovitust ei leitud.";
  return "Lõpetan: " + stoppedBecause;
}

function residualVisible(stoppedBecause) {
  return stoppedBecause !== "NO_ACTIONS";
}

// ══════════════════════════════════════════════════════════════════════
// 1. Üldandmed / korterid
// ══════════════════════════════════════════════════════════════════════

describe("1. Üldandmed / korterid", () => {
  it("tühi kava: tab0 = empty", () => {
    const plan = defaultPlan({ year: 2027 });
    expect(computeTabStatus(plan).tab0).toBe("empty");
  });

  it("korter pindalata: tab0 = partial", () => {
    const plan = { ...defaultPlan({ year: 2027 }), building: { apartments: [mkApartment({ label: "1", areaM2: 0 })] } };
    expect(computeTabStatus(plan).tab0).toBe("partial");
  });

  it("2 korterit reaalse pindalaga + periood: tab0 = done", () => {
    const plan = {
      ...defaultPlan({ year: 2027 }),
      period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [
        mkApartment({ label: "1", areaM2: 52.3 }),
        mkApartment({ label: "2", areaM2: 48.7 }),
      ]},
    };
    expect(computeTabStatus(plan).tab0).toBe("done");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. Periood + Täisaasta
// ══════════════════════════════════════════════════════════════════════

describe("2. Periood ja Täisaasta", () => {
  it("Täisaasta täidab start/end, Tab 5/6 muutuvad kooskõlas", () => {
    // Enne: year olemas, kuupäevad tühjad
    let plan = {
      ...defaultPlan({ year: 2027 }),
      building: { apartments: [mkApartment({ label: "1", areaM2: 52.3 })] },
      budget: { costRows: [{ id: "c1", category: "Haldus", summaInput: "3600", arvutus: "aastas", calc: { type: "FIXED_PERIOD", params: { amountEUR: 3600 } } }], incomeRows: [] },
    };

    let ts = computeTabStatus(plan);
    expect(ts.tab5).toBe("partial"); // apt olemas, aga periood puudub
    expect(ts.tab6).toBe("partial"); // apt + cost olemas, aga periood puudub

    // Täisaasta klikk
    const y = plan.period.year;
    plan = { ...plan, period: { ...plan.period, start: `${y}-01-01`, end: `${y}-12-31` } };

    ts = computeTabStatus(plan);
    expect(plan.period.start).toBe("2027-01-01");
    expect(plan.period.end).toBe("2027-12-31");
    expect(ts.tab0).toBe("done");
    expect(ts.tab5).toBe("done");
    expect(ts.tab6).toBe("done");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. Kulud ja tulud: gate + print kooskõla
// ══════════════════════════════════════════════════════════════════════

describe("3. Kulud ja tulud", () => {
  const plan = {
    ...defaultPlan({ year: 2027 }),
    period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
    building: { apartments: [mkApartment({ label: "1", areaM2: 52.3 })] },
    budget: {
      costRows: [
        { id: "c1", category: "Soojus", summaInput: "12000", calc: { type: "FIXED_PERIOD", params: { amountEUR: 12000 } } },
        { id: "c2", category: "Haldus", name: "", summaInput: 0, arvutus: "aastas", calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } } }, // poolik
      ],
      incomeRows: [
        { id: "i1", category: "Muu tulu", name: "Renditulu", summaInput: "400", arvutus: "aastas", calc: { type: "FIXED_PERIOD", params: { amountEUR: 400 } } },
        { id: "i2", category: "Muu tulu", name: "Poolik", summaInput: 0, arvutus: "aastas", calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } } }, // poolik
      ],
    },
  };

  it("gate: tab2 = done (üks summaga rida piisab)", () => {
    expect(computeTabStatus(plan).tab2).toBe("done");
  });

  it("gate: tab3 = done (üks summaga rida piisab)", () => {
    expect(computeTabStatus(plan).tab3).toBe("done");
  });

  it("print: kuvab ainult summaga kuluridu", () => {
    const printed = plan.budget.costRows.filter(printCostFilter);
    expect(printed).toHaveLength(1);
    expect(printed[0].id).toBe("c1");
  });

  it("print: kuvab ainult summaga tuluridu", () => {
    const printed = plan.budget.incomeRows.filter(printIncomeFilter);
    expect(printed).toHaveLength(1);
    expect(printed[0].id).toBe("i1");
  });

  it("poolikud read ei tekita done-signaali üksi", () => {
    const poolikPlan = {
      ...defaultPlan({ year: 2027 }),
      budget: {
        costRows: [{ id: "c2", category: "Haldus", summaInput: 0, calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } } }],
        incomeRows: [{ id: "i2", category: "Muu tulu", name: "Poolik", summaInput: 0, calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } } }],
      },
    };
    expect(computeTabStatus(poolikPlan).tab2).toBe("partial");
    expect(computeTabStatus(poolikPlan).tab3).toBe("partial");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. Fondid / laen
// ══════════════════════════════════════════════════════════════════════

describe("4. Fondid / laen", () => {
  it("tab4 = empty kui laene ega RF määra pole", () => {
    const plan = defaultPlan({ year: 2027 });
    expect(computeTabStatus(plan).tab4).toBe("empty");
  });

  it("tab4 = done kui laen lisatud", () => {
    const plan = { ...defaultPlan({ year: 2027 }), loans: [{ id: "l1", principalEUR: 30000 }] };
    expect(computeTabStatus(plan).tab4).toBe("done");
  });

  it("tab4 = done kui RF määr > 0", () => {
    const plan = {
      ...defaultPlan({ year: 2027 }),
      funds: { repairFund: { monthlyRateEurPerM2: 2 }, reserve: { plannedEUR: 0 } },
    };
    expect(computeTabStatus(plan).tab4).toBe("done");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. Solvere
// ══════════════════════════════════════════════════════════════════════

describe("5. Solvere UX kooskõla", () => {
  it("NO_ACTIONS: edukas, residual blokk peidetud", () => {
    expect(solveStatusMsg("NO_ACTIONS")).toBe("Enam soovitusi pole.");
    expect(residualVisible("NO_ACTIONS")).toBe(false);
  });

  it("LOOP_GUARD: mittetäielik, residual nähtav, mitte Valmis", () => {
    const msg = solveStatusMsg("LOOP_GUARD");
    expect(msg).not.toContain("Valmis");
    expect(residualVisible("LOOP_GUARD")).toBe(true);
  });

  it("MAX_STEPS: mittetäielik, residual nähtav", () => {
    expect(solveStatusMsg("MAX_STEPS")).toContain("max sammud");
    expect(residualVisible("MAX_STEPS")).toBe(true);
  });

  it("NO_CHOICE: mittetäielik, mitte Valmis", () => {
    const msg = solveStatusMsg("NO_CHOICE");
    expect(msg).not.toContain("Valmis");
    expect(residualVisible("NO_CHOICE")).toBe(true);
  });

  it("NO_PROGRESS: mittetäielik, residual nähtav", () => {
    expect(residualVisible("NO_PROGRESS")).toBe(true);
  });

  it("tundmatu põhjus: mitte Valmis, residual nähtav", () => {
    const msg = solveStatusMsg("SOMETHING_NEW");
    expect(msg).not.toBe("Valmis.");
    expect(residualVisible("SOMETHING_NEW")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 6. Print: gate vs print kooskõla täisflow'ga
// ══════════════════════════════════════════════════════════════════════

describe("6. Print kooskõla täisflow'ga", () => {
  const plan = {
    ...defaultPlan({ year: 2027 }),
    period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
    building: { apartments: [
      mkApartment({ label: "1", areaM2: 52.3 }),
      mkApartment({ label: "2", areaM2: 48.7 }),
    ]},
    budget: {
      costRows: [
        { id: "c1", category: "Soojus", summaInput: "12000", calc: { type: "FIXED_PERIOD", params: { amountEUR: 12000 } } },
        { id: "c2", category: "Haldus", summaInput: "3600", arvutus: "aastas", calc: { type: "FIXED_PERIOD", params: { amountEUR: 3600 } } },
        { id: "c3", category: "", name: "", summaInput: 0, calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } } }, // auto-seed jääk
      ],
      incomeRows: [
        { id: "i1", category: "Muu tulu", name: "Renditulu", summaInput: "400", arvutus: "aastas", calc: { type: "FIXED_PERIOD", params: { amountEUR: 400 } } },
        { id: "i2", category: "Muu tulu", name: "", summaInput: "", calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } } }, // auto-seed jääk
      ],
    },
  };

  it("gate: tab6 = done (kõik sisuline olemas)", () => {
    expect(computeTabStatus(plan).tab6).toBe("done");
  });

  it("print: kuluridade filter kuvab ainult sisulised", () => {
    const printed = plan.budget.costRows.filter(printCostFilter);
    expect(printed).toHaveLength(2); // c1 ja c2, mitte c3
    expect(printed.map(r => r.id)).toEqual(["c1", "c2"]);
  });

  it("print: tuluridade filter kuvab ainult sisulised", () => {
    const printed = plan.budget.incomeRows.filter(printIncomeFilter);
    expect(printed).toHaveLength(1); // i1, mitte i2
    expect(printed[0].id).toBe("i1");
  });

  it("print ja gate kasutavad sama reeglit: summaInput > 0", () => {
    // Gate predikaat
    const gateHasRealCost = plan.budget.costRows.some(r => (parseFloat(r.summaInput) || 0) > 0);
    // Print filter
    const printHasCosts = plan.budget.costRows.filter(printCostFilter).length > 0;
    // Mõlemad peavad andma sama tulemuse
    expect(gateHasRealCost).toBe(printHasCosts);

    const gateHasRealIncome = plan.budget.incomeRows.some(r => (parseFloat(r.summaInput) || 0) > 0);
    const printHasIncome = plan.budget.incomeRows.filter(printIncomeFilter).length > 0;
    expect(gateHasRealIncome).toBe(printHasIncome);
  });

  it("computePlan töötab selle andmestikuga ilma vigadeta", () => {
    const derived = computePlan(plan);
    expect(derived.building.totAreaM2).toBeCloseTo(101, 0);
    expect(derived.period.monthEq).toBe(12);
    expect(Number.isNaN(derived.totals.costPeriodEUR)).toBe(false);
    expect(Number.isNaN(derived.totals.costMonthlyEUR)).toBe(false);
  });
});
