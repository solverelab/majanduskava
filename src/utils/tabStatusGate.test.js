import { describe, it, expect } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// Tab completion gate logic — mirrors tabStatus in MajanduskavaApp.jsx
// Tests validate that "done" requires substantive content, not just
// the existence of auto-seeded empty rows.
// ══════════════════════════════════════════════════════════════════════

// Mirrors the gate predicates extracted from tabStatus definition
function computeTabStatus(plan) {
  const hasPeriod = plan.period.start && plan.period.end;
  const hasAnyApt = plan.building.apartments.length > 0;
  const hasRealApt = plan.building.apartments.some(a => (parseFloat(a.areaM2) || 0) > 0);
  const hasRealCost = plan.budget.costRows.some(r => (parseFloat(r.summaInput) || 0) > 0);
  const seisukord = plan.assetCondition?.items || [];
  return [
    // 0: Üldandmed
    (hasPeriod && hasRealApt) ? "done" : (plan.period.start || plan.period.end || hasAnyApt) ? "partial" : "empty",
    // 1: Hoone seisukord ja tööd
    seisukord.some(r => r.ese) ? "done" : "empty",
    // 2: Kavandatavad tulud ja kulud (kommunaalread ja uued planeeritavad laenud ei loe)
    (() => {
      const KOMM = ["Soojus", "Vesi ja kanalisatsioon", "Elekter", "Kütus", "Muu kommunaalteenus"];
      const tab2Costs = (plan.budget?.costRows || []).filter(r => !KOMM.includes(r.category));
      const loans2 = (plan.loans || []).filter(l => !l.sepiiriostudInvId);
      const activeIncomes = (plan.budget?.incomeRows || []).filter(r => (r.category && r.category !== "Muu tulu") || (parseFloat(r.summaInput) || 0) > 0 || r.name?.trim());
      const activeCosts = tab2Costs.filter(r => r.category || (parseFloat(r.summaInput) || 0) > 0);
      const activeLoans = loans2.filter(l => l.laenuandja || l.name || (parseFloat(l.pohiosPerioodis) || 0) + (parseFloat(l.intressPerioodis) || 0) + (parseFloat(l.teenustasudPerioodis) || 0) > 0);
      if (!activeIncomes.length && !activeCosts.length && !activeLoans.length) return "empty";
      const ok =
        activeIncomes.every(r => r.category && (parseFloat(r.summaInput) || 0) > 0) &&
        activeCosts.every(r => r.category && (parseFloat(r.summaInput) || 0) > 0) &&
        activeLoans.every(l => (l.laenuandja || l.name) && (parseFloat(l.pohiosPerioodis) || 0) + (parseFloat(l.intressPerioodis) || 0) + (parseFloat(l.teenustasudPerioodis) || 0) > 0);
      return ok ? "done" : "partial";
    })(),
    // 3: Kavandatud tulud
    plan.budget.incomeRows.some(r => (parseFloat(r.summaInput) || 0) > 0) ? "done" : plan.budget.incomeRows.length > 0 ? "partial" : "empty",
    // 4: Fondid ja laen
    (plan.loans.length > 0 || plan.funds.repairFund.monthlyRateEurPerM2 > 0) ? "done" : "empty",
    // 5: Maksed korteritele
    (hasRealApt && hasPeriod) ? "done" : hasAnyApt ? "partial" : "empty",
    // 6: Kokkuvõte
    (() => {
      if (hasRealApt && hasPeriod && hasRealCost) return "done";
      if (hasAnyApt || hasPeriod || hasRealCost) return "partial";
      return "empty";
    })(),
  ];
}

function basePlan(overrides = {}) {
  return {
    period: { start: "", end: "", year: 2027 },
    building: { apartments: [] },
    budget: { costRows: [], incomeRows: [] },
    assetCondition: { items: [] },
    funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } },
    loans: [],
    ...overrides,
  };
}

// ── Korter pindala gate ──

describe("Tab 0 (Üldandmed): korteri pindala gate", () => {
  it("korter pindalaga 0 → partial, mitte done", () => {
    const plan = basePlan({
      period: { start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 0 }] },
    });
    expect(computeTabStatus(plan)[0]).toBe("partial");
  });

  it("korter reaalse pindalaga → done", () => {
    const plan = basePlan({
      period: { start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 52.3 }] },
    });
    expect(computeTabStatus(plan)[0]).toBe("done");
  });

  it("mitu korterit, üks 0 ja üks sisuline → done (vähemalt üks reaalne)", () => {
    const plan = basePlan({
      period: { start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [
        { id: "a1", label: "1", areaM2: 0 },
        { id: "a2", label: "2", areaM2: 48.7 },
      ]},
    });
    expect(computeTabStatus(plan)[0]).toBe("done");
  });
});

// ── Tab 2 (Kavandatavad tulud ja kulud): kombineeritud gate ──

describe("Tab 2 (Tulud ja kulud): kombineeritud gate — kommunaalread ei loe", () => {
  it("ainult kommunaalread summadega → empty (ei loe Tab 2 staatuse hulka)", () => {
    const plan = basePlan({
      budget: { costRows: [{ id: "r1", category: "Soojus", summaInput: "12000" }], incomeRows: [] },
    });
    expect(computeTabStatus(plan)[2]).toBe("empty");
  });

  it("tühi kava (pole Tab 2 ridu) → empty", () => {
    expect(computeTabStatus(basePlan())[2]).toBe("empty");
  });

  it("tühi kululiigiga rida (ei kategooriat, ei summat) → empty (ei loe aktiivseks)", () => {
    const plan = basePlan({
      budget: { costRows: [{ id: "r1", category: "", summaInput: 0 }], incomeRows: [] },
    });
    expect(computeTabStatus(plan)[2]).toBe("empty");
  });

  it("halduskulu kategooriaga, summa 0 → partial (poolik)", () => {
    const plan = basePlan({
      budget: { costRows: [{ id: "r1", category: "Valitseja / halduri tasu", summaInput: 0 }], incomeRows: [] },
    });
    expect(computeTabStatus(plan)[2]).toBe("partial");
  });

  it("halduskulu kategooria + summa → done", () => {
    const plan = basePlan({
      budget: { costRows: [{ id: "r1", category: "Valitseja / halduri tasu", summaInput: "2400" }], incomeRows: [] },
    });
    expect(computeTabStatus(plan)[2]).toBe("done");
  });

  it("tulurida kategooria + summa → done", () => {
    const plan = basePlan({
      budget: { costRows: [], incomeRows: [{ id: "i1", category: "Üüritulu", summaInput: "500" }] },
    });
    expect(computeTabStatus(plan)[2]).toBe("done");
  });

  it("tulurida kategooriaga, summa 0 → partial", () => {
    const plan = basePlan({
      budget: { costRows: [], incomeRows: [{ id: "i1", category: "Üüritulu", summaInput: 0 }] },
    });
    expect(computeTabStatus(plan)[2]).toBe("partial");
  });

  it("olemasolev laen laenuandja + summaga → done", () => {
    const plan = basePlan({
      loans: [{ id: "l1", sepiiriostudInvId: null, laenuandja: "Swedbank", name: "", pohiosPerioodis: 500, intressPerioodis: 0, teenustasudPerioodis: 0 }],
    });
    expect(computeTabStatus(plan)[2]).toBe("done");
  });

  it("kaks rida, üks poolik → partial", () => {
    const plan = basePlan({
      budget: {
        costRows: [{ id: "r1", category: "Valitseja / halduri tasu", summaInput: "2400" }],
        incomeRows: [{ id: "i1", category: "Üüritulu", summaInput: 0 }],
      },
    });
    expect(computeTabStatus(plan)[2]).toBe("partial");
  });

  it("uue laenu planeerimine (sepiiriostudInvId) ei loe Tab 2 staatuse hulka", () => {
    const plan = basePlan({
      loans: [{ id: "l1", sepiiriostudInvId: "inv-xyz", laenuandja: "Swedbank", pohiosPerioodis: 500, intressPerioodis: 100 }],
    });
    expect(computeTabStatus(plan)[2]).toBe("empty");
  });
});

// ── Tulurida gate ──

describe("Tab 3 (Tulud): tulurida gate", () => {
  it("auto-seeded tühi tulurida → partial", () => {
    const plan = basePlan({
      budget: { costRows: [], incomeRows: [{ id: "i1", category: "Muu tulu", name: "", summaInput: "" }] },
    });
    expect(computeTabStatus(plan)[3]).toBe("partial");
  });

  it("ainult nimega tulurida, summa 0 → partial (poolik töövoog)", () => {
    const plan = basePlan({
      budget: { costRows: [], incomeRows: [{ id: "i1", category: "Muu tulu", name: "Renditulu", summaInput: 0 }] },
    });
    expect(computeTabStatus(plan)[3]).toBe("partial");
  });

  it("ainult nimega tulurida, summa tühi → partial", () => {
    const plan = basePlan({
      budget: { costRows: [], incomeRows: [{ id: "i1", category: "Muu tulu", name: "Renditulu", summaInput: "" }] },
    });
    expect(computeTabStatus(plan)[3]).toBe("partial");
  });

  it("tulurida summaga → done", () => {
    const plan = basePlan({
      budget: { costRows: [], incomeRows: [{ id: "i1", category: "Muu tulu", name: "", summaInput: "400" }] },
    });
    expect(computeTabStatus(plan)[3]).toBe("done");
  });
});

// ── Tab 5 (Maksed korteritele): pindala gate ──

describe("Tab 5 (Maksed): pindala gate", () => {
  it("korter pindalaga 0 + periood → partial", () => {
    const plan = basePlan({
      period: { start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 0 }] },
    });
    expect(computeTabStatus(plan)[5]).toBe("partial");
  });

  it("korter reaalse pindalaga + periood → done", () => {
    const plan = basePlan({
      period: { start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 52.3 }] },
    });
    expect(computeTabStatus(plan)[5]).toBe("done");
  });
});

// ── Tab 6 (Kokkuvõte): kombineeritud gate ──

describe("Tab 6 (Kokkuvõte): kombineeritud gate", () => {
  it("kõik sisuline → done", () => {
    const plan = basePlan({
      period: { start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 52.3 }] },
      budget: { costRows: [{ id: "r1", category: "Haldus", summaInput: "3600" }], incomeRows: [] },
    });
    expect(computeTabStatus(plan)[6]).toBe("done");
  });

  it("korter 0 pindalaga → partial (pole reaalne apt)", () => {
    const plan = basePlan({
      period: { start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 0 }] },
      budget: { costRows: [{ id: "r1", category: "Haldus", summaInput: "3600" }], incomeRows: [] },
    });
    expect(computeTabStatus(plan)[6]).toBe("partial");
  });

  it("tühi kulurida → partial (pole reaalset kulu)", () => {
    const plan = basePlan({
      period: { start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 52.3 }] },
      budget: { costRows: [{ id: "r1", category: "", name: "", summaInput: 0 }], incomeRows: [] },
    });
    expect(computeTabStatus(plan)[6]).toBe("partial");
  });

  it("ainult kategooriaga kulurida → partial (poolik töövoog)", () => {
    const plan = basePlan({
      period: { start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 52.3 }] },
      budget: { costRows: [{ id: "r1", category: "Soojus", name: "", summaInput: 0 }], incomeRows: [] },
    });
    expect(computeTabStatus(plan)[6]).toBe("partial");
  });

  it("täiesti tühi kava → empty", () => {
    expect(computeTabStatus(basePlan())[6]).toBe("empty");
  });
});

// ── Regressioon: muud tabid ei purune ──

describe("regressioon: muud tabid", () => {
  it("tab 1 (seisukord) endiselt: ese olemas → done", () => {
    const plan = basePlan({ assetCondition: { items: [{ id: "s1", ese: "Katus" }] } });
    expect(computeTabStatus(plan)[1]).toBe("done");
  });

  it("tab 1 (seisukord): tühi → empty", () => {
    expect(computeTabStatus(basePlan())[1]).toBe("empty");
  });

  it("tab 4 (fondid): laen olemas → done", () => {
    const plan = basePlan({ loans: [{ id: "l1" }] });
    expect(computeTabStatus(plan)[4]).toBe("done");
  });

  it("tab 4 (fondid): tühi → empty", () => {
    expect(computeTabStatus(basePlan())[4]).toBe("empty");
  });
});
