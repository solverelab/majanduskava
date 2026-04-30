// src/utils/tab3Kommunaalid.test.js
// Lukustab Kommunaalid tabi (sec === 3) vaikimisi ridade ja UI loogika.

import { describe, it, expect, beforeAll } from "vitest";
import {
  KOMMUNAAL_DEFAULT_CATEGORIES, KOMMUNAALTEENUSED, makeKommunaalRow,
  seedDefaultKommunaalRows, utilityRowStatus,
} from "./majanduskavaCalc";
import { defaultPlan } from "../domain/planSchema";

// Simulates clearKommunaalid handler logic — pure function for testability.
const simulateClearKommunaalid = (plan) =>
  seedDefaultKommunaalRows({
    ...plan,
    removedDefaultKommunaalCategories: [],
    budget: {
      ...plan.budget,
      costRows: plan.budget.costRows.filter(r => !KOMMUNAALTEENUSED.includes(r.category)),
    },
  });

// Simulates removing a default kommunaalrida (adds category to removedDefaultKommunaalCategories).
const simulateRemoveDefaultRow = (plan, category) => {
  const newPlan = {
    ...plan,
    budget: {
      ...plan.budget,
      costRows: plan.budget.costRows.filter(r => r.category !== category),
    },
    removedDefaultKommunaalCategories: [
      ...new Set([...(plan.removedDefaultKommunaalCategories || []), category]),
    ],
  };
  // seedDefaultKommunaalRows should NOT re-add the removed category
  return seedDefaultKommunaalRows(newPlan);
};

let src;

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
});

// ── 1. Vaikimisi read uuel plaanil ───────────────────────────────────────────

describe("Uus plaan: vaikimisi kommunaalread", () => {
  it("seedDefaultKommunaalRows(defaultPlan()) sisaldab Soojuse rida", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    expect(plan.budget.costRows.some(r => r.category === "Soojus")).toBe(true);
  });

  it("seedDefaultKommunaalRows(defaultPlan()) sisaldab Vesi ja kanalisatsioon rida", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    expect(plan.budget.costRows.some(r => r.category === "Vesi ja kanalisatsioon")).toBe(true);
  });

  it("seedDefaultKommunaalRows(defaultPlan()) sisaldab Elektri rida", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    expect(plan.budget.costRows.some(r => r.category === "Elekter")).toBe(true);
  });

  it("Kütust ei lisata vaikimisi", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    expect(plan.budget.costRows.some(r => r.category === "Kütus")).toBe(false);
  });

  it("Vaikimisi read on märgitud isDefault: true", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    const defaultKomm = plan.budget.costRows.filter(r => KOMMUNAAL_DEFAULT_CATEGORIES.includes(r.category));
    expect(defaultKomm.length).toBe(3);
    defaultKomm.forEach(r => expect(r.isDefault).toBe(true));
  });

  it("Vaikimisi read on notApplicable: false", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    plan.budget.costRows
      .filter(r => KOMMUNAAL_DEFAULT_CATEGORIES.includes(r.category))
      .forEach(r => expect(r.notApplicable).toBe(false));
  });
});

// ── 2. Duplikaadi vältimine ───────────────────────────────────────────────────

describe("seedDefaultKommunaalRows: duplikaatide vältimine", () => {
  it("kaks korda rakendamine ei dubleeri ridu", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    const plan2 = seedDefaultKommunaalRows(plan);
    const soojusRows = plan2.budget.costRows.filter(r => r.category === "Soojus");
    expect(soojusRows.length).toBe(1);
  });

  it("olemasoleva Soojuse rea korral uut ei lisata", () => {
    const existing = { ...defaultPlan(), budget: { costRows: [makeKommunaalRow("Soojus")], incomeRows: [] } };
    const seeded = seedDefaultKommunaalRows(existing);
    expect(seeded.budget.costRows.filter(r => r.category === "Soojus").length).toBe(1);
  });

  it("osaliselt täidetud plaanil täidetakse ainult puuduvad read", () => {
    const partial = { ...defaultPlan(), budget: { costRows: [makeKommunaalRow("Soojus")], incomeRows: [] } };
    const seeded = seedDefaultKommunaalRows(partial);
    const cats = seeded.budget.costRows.map(r => r.category);
    expect(cats).toContain("Soojus");
    expect(cats).toContain("Vesi ja kanalisatsioon");
    expect(cats).toContain("Elekter");
    expect(seeded.budget.costRows.filter(r => r.category === "Soojus").length).toBe(1);
  });
});

// ── 3. utilityRowStatus — puhas valideerimine ────────────────────────────────

describe("utilityRowStatus: valideerimine", () => {
  it("puuduv kogus → complete: false", () => {
    const row = { category: "Soojus", utilityType: "heat", kogus: "", uhik: "MWh" };
    const s = utilityRowStatus(row);
    expect(s.complete).toBe(false);
    expect(s.missing).toContain("kogus");
  });

  it("kogus ja uhik olemas → complete: true", () => {
    const row = { category: "Soojus", utilityType: "heat", kogus: "150", uhik: "MWh" };
    const s = utilityRowStatus(row);
    expect(s.complete).toBe(true);
  });

  it("ei kommunaalteenus → isUtility: false", () => {
    const row = { category: "Valitseja / halduri tasu", utilityType: null };
    const s = utilityRowStatus(row);
    expect(s.isUtility).toBe(false);
    expect(s.complete).toBe(true);
  });
});

// ── 4. makeKommunaalRow väljad ────────────────────────────────────────────────

describe("makeKommunaalRow: väljad", () => {
  it("Soojuse rea vaikimisi ühik on MWh", () => {
    expect(makeKommunaalRow("Soojus").uhik).toBe("MWh");
  });

  it("Vesi ja kanalisatsioon rea vaikimisi ühik on m³", () => {
    expect(makeKommunaalRow("Vesi ja kanalisatsioon").uhik).toBe("m³");
  });

  it("Elektri rea vaikimisi ühik on kWh", () => {
    expect(makeKommunaalRow("Elekter").uhik).toBe("kWh");
  });

  it("iga kõne loob unikaalsed read (erinevad id-d)", () => {
    const a = makeKommunaalRow("Soojus");
    const b = makeKommunaalRow("Soojus");
    expect(a.id).not.toBe(b.id);
  });

  it("summaInput on 0, mitte tühi string", () => {
    expect(makeKommunaalRow("Elekter").summaInput).toBe(0);
  });
});

// ── 5b. removedDefaultKommunaalCategories loogika ────────────────────────────

describe("removedDefaultKommunaalCategories: eemaldatud vaikimisi read ei teki tagasi", () => {
  it("eemaldatud Soojus ei teki seedis tagasi", () => {
    const result = simulateRemoveDefaultRow(seedDefaultKommunaalRows(defaultPlan()), "Soojus");
    expect(result.budget.costRows.some(r => r.category === "Soojus")).toBe(false);
  });

  it("eemaldatud kategooria lisatakse removedDefaultKommunaalCategories hulka", () => {
    const result = simulateRemoveDefaultRow(seedDefaultKommunaalRows(defaultPlan()), "Elekter");
    expect(result.removedDefaultKommunaalCategories).toContain("Elekter");
  });

  it("mitte-eemaldatud vaikeread jäävad alles", () => {
    const result = simulateRemoveDefaultRow(seedDefaultKommunaalRows(defaultPlan()), "Soojus");
    expect(result.budget.costRows.some(r => r.category === "Vesi ja kanalisatsioon")).toBe(true);
    expect(result.budget.costRows.some(r => r.category === "Elekter")).toBe(true);
  });

  it("clearKommunaalid taastab kõik vaikeread (removedDefaultKommunaalCategories: [])", () => {
    const afterRemove = simulateRemoveDefaultRow(seedDefaultKommunaalRows(defaultPlan()), "Soojus");
    const afterClear = simulateClearKommunaalid(afterRemove);
    expect(afterClear.budget.costRows.some(r => r.category === "Soojus")).toBe(true);
    expect(afterClear.removedDefaultKommunaalCategories).toHaveLength(0);
  });

  it("clearKommunaalid taastab tühjad vaikeread (kogus: '')", () => {
    const filled = seedDefaultKommunaalRows(defaultPlan());
    const withValues = {
      ...filled,
      budget: {
        ...filled.budget,
        costRows: filled.budget.costRows.map(r =>
          r.category === "Soojus" ? { ...r, kogus: "200", summaInput: 8000 } : r
        ),
      },
    };
    const afterClear = simulateClearKommunaalid(withValues);
    const soojus = afterClear.budget.costRows.find(r => r.category === "Soojus");
    expect(soojus.kogus).toBe("");
    expect(soojus.summaInput).toBe(0);
  });
});

// ── 5. Tab 3 UI lukustus (allikainspektion) ───────────────────────────────────

describe("Tab 3 UI: + Lisa muu kommunaalteenus", () => {
  it("nupul on tekst '+ Lisa muu kommunaalteenus'", () => {
    expect(src).toContain("+ Lisa muu kommunaalteenus");
  });

  it("vana tekst '+ Lisa kommunaalrida' enam ei esine", () => {
    expect(src).not.toContain("+ Lisa kommunaalrida");
  });

  it("nupp loob 'Muu kommunaalteenus' kategooriaga rea", () => {
    const btnIdx = src.indexOf("+ Lisa muu kommunaalteenus");
    const btnCtx = src.slice(Math.max(0, btnIdx - 200), btnIdx + 50);
    expect(btnCtx).toContain('"Muu kommunaalteenus"');
  });
});

describe("Tab 3 UI: isDefault eraldab standardread erandridadest", () => {
  it("Tab 3 renderdamine kasutab r.isDefault === true tingimust", () => {
    const sec3Idx = src.indexOf("sec === 3 && (() => {");
    const sec3End = src.indexOf("sec === 5 && (", sec3Idx);
    const sec3Block = src.slice(sec3Idx, sec3End);
    expect(sec3Block).toContain("r.isDefault === true");
  });

  it("standardread renderdatakse ilma delete nuputa (removeRow kutseta)", () => {
    const sec3Idx = src.indexOf("sec === 3 && (() => {");
    const sec3End = src.indexOf("sec === 5 && (", sec3Idx);
    const sec3Block = src.slice(sec3Idx, sec3End);
    // defaultRows loop ei tohi kutsuda removeRow
    const defaultLoopIdx = sec3Block.indexOf("defaultRows.map");
    const extraLoopIdx = sec3Block.indexOf("extraRows.map");
    const defaultLoop = sec3Block.slice(defaultLoopIdx, extraLoopIdx);
    expect(defaultLoop).not.toContain("removeRow");
  });

  it("'Ei kohaldu' checkbox EI esine Tab 3 renderduses", () => {
    const sec3Idx = src.indexOf("sec === 3 && (() => {");
    const sec3End = src.indexOf("sec === 5 && (", sec3Idx);
    const sec3Block = src.slice(sec3Idx, sec3End);
    expect(sec3Block).not.toContain("Ei kohaldu");
  });

  it("defaultRows renderduses on 'Tasumine pärast kulude suuruse selgumist' checkbox", () => {
    const sec3Idx = src.indexOf("sec === 3 && (() => {");
    const sec3End = src.indexOf("sec === 5 && (", sec3Idx);
    const sec3Block = src.slice(sec3Idx, sec3End);
    const defaultLoopIdx = sec3Block.indexOf("defaultRows.map");
    const extraLoopIdx = sec3Block.indexOf("extraRows.map");
    const defaultLoop = sec3Block.slice(defaultLoopIdx, extraLoopIdx);
    expect(defaultLoop).toContain("Tasumine pärast kulude suuruse selgumist");
    expect(defaultLoop).toContain("settledPostHoc");
  });

  it("defaultRows settledPostHoc checkbox sisaldab legalBasisBylaws ja legalBasisSpecialAgreement", () => {
    const sec3Idx = src.indexOf("sec === 3 && (() => {");
    const sec3End = src.indexOf("sec === 5 && (", sec3Idx);
    const sec3Block = src.slice(sec3Idx, sec3End);
    const defaultLoopIdx = sec3Block.indexOf("defaultRows.map");
    const extraLoopIdx = sec3Block.indexOf("extraRows.map");
    const defaultLoop = sec3Block.slice(defaultLoopIdx, extraLoopIdx);
    expect(defaultLoop).toContain("legalBasisBylaws");
    expect(defaultLoop).toContain("legalBasisSpecialAgreement");
  });

  it("defaultRows renderduses on 'Eemalda rida' nupp", () => {
    const sec3Idx = src.indexOf("sec === 3 && (() => {");
    const sec3End = src.indexOf("sec === 5 && (", sec3Idx);
    const sec3Block = src.slice(sec3Idx, sec3End);
    const defaultLoopIdx = sec3Block.indexOf("defaultRows.map");
    const extraLoopIdx = sec3Block.indexOf("extraRows.map");
    const defaultLoop = sec3Block.slice(defaultLoopIdx, extraLoopIdx);
    expect(defaultLoop).toContain("Eemalda rida");
  });

  it("eemaldamisel lisatakse kategooria removedDefaultKommunaalCategories hulka", () => {
    const sec3Idx = src.indexOf("sec === 3 && (() => {");
    const sec3End = src.indexOf("sec === 5 && (", sec3Idx);
    const sec3Block = src.slice(sec3Idx, sec3End);
    expect(sec3Block).toContain("removedDefaultKommunaalCategories");
  });
});

// ── 6. Kommunaalread ei ilmu Tab 2 tavakuludesse ─────────────────────────────

describe("Tab 2: kommunaalread on filtreeritud välja", () => {
  it("tab2KuluAllRows välistab KOMMUNAALTEENUSED", () => {
    const filterIdx = src.indexOf("const tab2KuluAllRows = plan.budget.costRows.filter");
    const filterBlock = src.slice(filterIdx, filterIdx + 200);
    expect(filterBlock).toContain("KOMMUNAALTEENUSED");
    expect(filterBlock).toContain("!KOMMUNAALTEENUSED.includes");
  });
});

// ── 7. P5 loogika jääb eraldi ─────────────────────────────────────────────────

describe("Print p5: kommunaalid on eraldi plokis", () => {
  it("print p5 kasutab P5_KOMMUNAALTEENUSED filtrit", () => {
    // utilityRows filter on defineeritud vahetult enne print-section-title pealkirja
    const p5PrintIdx = src.indexOf('print-section-title">Kütuse, soojuse');
    expect(p5PrintIdx).toBeGreaterThan(-1);
    const p5Block = src.slice(p5PrintIdx - 300, p5PrintIdx + 500);
    expect(p5Block).toContain("P5_KOMMUNAALTEENUSED");
  });

  it("print p2 kuvab kommunaalid kokkuvõtliku reana (ei dubleeri p5)", () => {
    expect(src).toContain("Kommunaalteenused kokku");
    expect(src).toContain("Detailne kogus ja maksumus on esitatud kommunaalteenuste prognoosi plokis");
  });
});

// ── 8. clearKommunaalid handler: loogika ─────────────────────────────────────

describe("clearKommunaalid: eemaldab ainult kommunaalread", () => {
  const planWithMix = () => {
    const base = seedDefaultKommunaalRows(defaultPlan());
    // Set some values on default rows
    const filledCostRows = base.budget.costRows.map(r =>
      r.category === "Soojus" ? { ...r, kogus: "150", summaInput: 5000, notApplicable: false } : r
    );
    // Add a haldus row and a Muu kommunaalteenus extra row
    const haldusRow = { id: "haldus1", side: "COST", category: "Valitseja / halduri tasu", summaInput: 1200, arvutus: "aastas" };
    const muuKommRow = { id: "muukomm1", side: "COST", category: "Muu kommunaalteenus", name: "Gaas", summaInput: 800 };
    // Add an income row
    const incomeRow = { id: "tulu1", side: "INCOME", category: "Muu tulu", name: "Üür", summaInput: 500 };
    return {
      ...base,
      budget: {
        costRows: [...filledCostRows, haldusRow, muuKommRow],
        incomeRows: [incomeRow],
      },
    };
  };

  it("pärast tühjendamist jäävad haldusteenuste read alles", () => {
    const result = simulateClearKommunaalid(planWithMix());
    expect(result.budget.costRows.some(r => r.id === "haldus1")).toBe(true);
  });

  it("pärast tühjendamist on kommunaalread eemaldatud ja vaikeread taastatud", () => {
    const result = simulateClearKommunaalid(planWithMix());
    const kommunaalCats = result.budget.costRows
      .filter(r => KOMMUNAALTEENUSED.includes(r.category))
      .map(r => r.category);
    expect(kommunaalCats).toContain("Soojus");
    expect(kommunaalCats).toContain("Vesi ja kanalisatsioon");
    expect(kommunaalCats).toContain("Elekter");
  });

  it("pärast tühjendamist on vaikerea kogus tühi", () => {
    const result = simulateClearKommunaalid(planWithMix());
    const soojus = result.budget.costRows.find(r => r.category === "Soojus");
    expect(soojus.kogus).toBe("");
    expect(soojus.summaInput).toBe(0);
  });

  it("pärast tühjendamist on notApplicable false", () => {
    const result = simulateClearKommunaalid(planWithMix());
    const soojus = result.budget.costRows.find(r => r.category === "Soojus");
    expect(soojus.notApplicable).toBe(false);
  });

  it("Muu kommunaalteenus (erandteenus) eemaldatakse", () => {
    const result = simulateClearKommunaalid(planWithMix());
    expect(result.budget.costRows.some(r => r.id === "muukomm1")).toBe(false);
  });

  it("Kütuse rida eemaldatakse kui see oli lisatud", () => {
    const base = seedDefaultKommunaalRows(defaultPlan());
    const withKutus = {
      ...base,
      budget: {
        ...base.budget,
        costRows: [...base.budget.costRows, { id: "kutus1", side: "COST", category: "Kütus", kogus: "200", summaInput: 3000 }],
      },
    };
    const result = simulateClearKommunaalid(withKutus);
    expect(result.budget.costRows.some(r => r.category === "Kütus")).toBe(false);
  });

  it("tulud jäävad alles", () => {
    const result = simulateClearKommunaalid(planWithMix());
    expect(result.budget.incomeRows.some(r => r.id === "tulu1")).toBe(true);
  });

  it("laenud jäävad alles", () => {
    const base = seedDefaultKommunaalRows(defaultPlan());
    const withLoan = { ...base, loans: [{ id: "loan1", name: "Remondilaen", principalEUR: 50000 }] };
    const result = simulateClearKommunaalid(withLoan);
    expect(result.loans.some(l => l.id === "loan1")).toBe(true);
  });

  it("fondid jäävad alles", () => {
    const base = seedDefaultKommunaalRows(defaultPlan());
    const withFunds = { ...base, funds: { repairFund: { monthlyRateEurPerM2: 0.5 }, reserve: { plannedEUR: 2000 } } };
    const result = simulateClearKommunaalid(withFunds);
    expect(result.funds.repairFund.monthlyRateEurPerM2).toBe(0.5);
    expect(result.funds.reserve.plannedEUR).toBe(2000);
  });
});

// ── 9. clearKommunaalid: UI lukustus (allikainspektion) ──────────────────────

describe("clearKommunaalid: UI ja handler", () => {
  let sec3Block;

  beforeAll(() => {
    const sec3Idx = src.indexOf("sec === 3 && (() => {");
    const sec3End = src.indexOf("sec === 5 && (", sec3Idx);
    sec3Block = src.slice(sec3Idx, sec3End);
  });

  it("Tab 3-s on 'Tühjenda' nupp", () => {
    expect(sec3Block).toContain("Tühjenda");
  });

  it("Tab 3 'Tühjenda' kutsub clearKommunaalid, mitte clearSection", () => {
    expect(sec3Block).toContain("clearKommunaalid");
    expect(sec3Block).not.toContain("clearSection");
  });

  it("clearKommunaalid filtreerib ainult KOMMUNAALTEENUSED read välja", () => {
    const handlerIdx = src.indexOf("const clearKommunaalid = ");
    const handlerBlock = src.slice(handlerIdx, handlerIdx + 400);
    expect(handlerBlock).toContain("KOMMUNAALTEENUSED");
    expect(handlerBlock).toContain("filter(r => !KOMMUNAALTEENUSED.includes");
  });

  it("clearKommunaalid kutsub seedDefaultKommunaalRows pärast kustutamist", () => {
    const handlerIdx = src.indexOf("const clearKommunaalid = ");
    const handlerBlock = src.slice(handlerIdx, handlerIdx + 500);
    expect(handlerBlock).toContain("seedDefaultKommunaalRows");
  });

  it("clearKommunaalid nullib removedDefaultKommunaalCategories", () => {
    const handlerIdx = src.indexOf("const clearKommunaalid = ");
    const handlerBlock = src.slice(handlerIdx, handlerIdx + 500);
    expect(handlerBlock).toContain("removedDefaultKommunaalCategories: []");
  });

  it("Tab 2 clearSection(2) jäi muutmata — kustutab costRows ja incomeRows", () => {
    const csIdx = src.indexOf("const clearSection = (tabIdx) => {");
    const csEnd = src.indexOf("const clearBtn = ", csIdx);
    const csBlock = src.slice(csIdx, csEnd);
    const tab2Branch = csBlock.slice(csBlock.indexOf("tabIdx === 2"));
    expect(tab2Branch).toContain("costRows: []");
    expect(tab2Branch).toContain("incomeRows: []");
  });
});
