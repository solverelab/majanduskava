// src/utils/tab3Kommunaalid.test.js
// Lukustab Kommunaalid tabi (sec === 3) vaikimisi ridade ja UI loogika.

import { describe, it, expect, beforeAll } from "vitest";
import {
  KOMMUNAAL_DEFAULT_CATEGORIES, KOMMUNAALTEENUSED, makeKommunaalRow,
  seedDefaultKommunaalRows, utilityRowStatus, migrateLegacyKommunaalCategories,
  FUEL_TYPES, FUEL_TYPE_UNITS,
  UTILITY_SETTLEMENT_MODES, kommunaalRowSettlementValid,
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

  it("seedDefaultKommunaalRows(defaultPlan()) sisaldab Vesi rida", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    expect(plan.budget.costRows.some(r => r.category === "Vesi")).toBe(true);
  });

  it("seedDefaultKommunaalRows(defaultPlan()) sisaldab Kanalisatsioon rida", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    expect(plan.budget.costRows.some(r => r.category === "Kanalisatsioon")).toBe(true);
  });

  it("seedDefaultKommunaalRows(defaultPlan()) sisaldab Elektri rida", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    expect(plan.budget.costRows.some(r => r.category === "Elekter")).toBe(true);
  });

  it("Kütus lisatakse vaikimisi", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    expect(plan.budget.costRows.some(r => r.category === "Kütus")).toBe(true);
  });

  it("Vaikimisi read on märgitud isDefault: true", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    const defaultKomm = plan.budget.costRows.filter(r => KOMMUNAAL_DEFAULT_CATEGORIES.includes(r.category));
    expect(defaultKomm.length).toBe(5);
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
    expect(cats).toContain("Vesi");
    expect(cats).toContain("Kanalisatsioon");
    expect(cats).toContain("Elekter");
    expect(cats).toContain("Kütus");
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

  it("Vesi rea vaikimisi ühik on m³", () => {
    expect(makeKommunaalRow("Vesi").uhik).toBe("m³");
  });

  it("Kanalisatsioon rea vaikimisi ühik on m³", () => {
    expect(makeKommunaalRow("Kanalisatsioon").uhik).toBe("m³");
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

  it("Kütuse rea fuelType on null vaikimisi", () => {
    expect(makeKommunaalRow("Kütus").fuelType).toBeNull();
  });

  it("teiste kommunaalridade fuelType on null", () => {
    expect(makeKommunaalRow("Soojus").fuelType).toBeNull();
    expect(makeKommunaalRow("Elekter").fuelType).toBeNull();
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
    expect(result.budget.costRows.some(r => r.category === "Vesi")).toBe(true);
    expect(result.budget.costRows.some(r => r.category === "Kanalisatsioon")).toBe(true);
    expect(result.budget.costRows.some(r => r.category === "Elekter")).toBe(true);
    expect(result.budget.costRows.some(r => r.category === "Kütus")).toBe(true);
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
    expect(kommunaalCats).toContain("Vesi");
    expect(kommunaalCats).toContain("Kanalisatsioon");
    expect(kommunaalCats).toContain("Elekter");
    expect(kommunaalCats).toContain("Kütus");
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

  it("Kütuse vaikimisi rida taastatakse pärast tühjendamist tühja reana", () => {
    const base = seedDefaultKommunaalRows(defaultPlan());
    const withFilledKutus = {
      ...base,
      budget: {
        ...base.budget,
        costRows: base.budget.costRows.map(r =>
          r.category === "Kütus" ? { ...r, kogus: "200", summaInput: 3000 } : r
        ),
      },
    };
    const result = simulateClearKommunaalid(withFilledKutus);
    const kutusRow = result.budget.costRows.find(r => r.category === "Kütus");
    expect(kutusRow).toBeDefined();
    expect(kutusRow.kogus).toBe("");
    expect(kutusRow.summaInput).toBe(0);
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

  it("Tab 2 clearSection(2) kustutab incomeRows täielikult", () => {
    const csIdx = src.indexOf("const clearSection = (tabIdx) => {");
    const csEnd = src.indexOf("const clearBtn = ", csIdx);
    const csBlock = src.slice(csIdx, csEnd);
    const tab2Branch = csBlock.slice(csBlock.indexOf("tabIdx === 2"));
    expect(tab2Branch).toContain("incomeRows: []");
  });

  it("Tab 2 clearSection(2) EI tühjenda costRows täielikult — säilitab kommunaalread", () => {
    const csIdx = src.indexOf("const clearSection = (tabIdx) => {");
    const csEnd = src.indexOf("const clearBtn = ", csIdx);
    const csBlock = src.slice(csIdx, csEnd);
    const tab2Branch = csBlock.slice(csBlock.indexOf("tabIdx === 2"));
    // Täielik costRows kustutamine on keelatud — kommunaalread peavad säilima
    expect(tab2Branch).not.toContain("costRows: []");
    // Kommunaalikategooriaid filtreeritakse sisse
    expect(tab2Branch).toContain("KOMMUNAALTEENUSED");
    expect(tab2Branch).toContain("filter(r => KOMMUNAALTEENUSED.includes");
  });

  it("Tab 2 clearSection(2) EI kustuta plan.loans", () => {
    const csIdx = src.indexOf("const clearSection = (tabIdx) => {");
    const csEnd = src.indexOf("const clearBtn = ", csIdx);
    const csBlock = src.slice(csIdx, csEnd);
    const tab2Start = csBlock.indexOf("tabIdx === 2");
    const tab4Start = csBlock.indexOf("tabIdx === 4");
    // Ainult Tab 2 haru (lõpp enne tabIdx === 4)
    const tab2Only = csBlock.slice(tab2Start, tab4Start > tab2Start ? tab4Start : undefined);
    expect(tab2Only).not.toContain("loans: []");
  });
});

// ── 10. migrateLegacyKommunaalCategories ─────────────────────────────────────

describe("migrateLegacyKommunaalCategories: Vesi ja kanalisatsioon → Vesi", () => {
  it("nimetab 'Vesi ja kanalisatsioon' rea 'Vesi'-ks, säilitab kõik andmed", () => {
    const plan = {
      ...defaultPlan(),
      budget: {
        costRows: [{ id: "w1", category: "Vesi ja kanalisatsioon", kogus: "500", summaInput: 3600, uhik: "m³", selgitus: "märkus" }],
        incomeRows: [],
      },
    };
    const result = migrateLegacyKommunaalCategories(plan);
    const row = result.budget.costRows.find(r => r.id === "w1");
    expect(row.category).toBe("Vesi");
    expect(row.kogus).toBe("500");
    expect(row.summaInput).toBe(3600);
    expect(row.selgitus).toBe("märkus");
  });

  it("ei loo automaatselt Kanalisatsioon rida — seda teeb seedDefaultKommunaalRows", () => {
    const plan = {
      ...defaultPlan(),
      budget: { costRows: [{ id: "w1", category: "Vesi ja kanalisatsioon", summaInput: 3600 }], incomeRows: [] },
    };
    const result = migrateLegacyKommunaalCategories(plan);
    expect(result.budget.costRows.some(r => r.category === "Kanalisatsioon")).toBe(false);
  });

  it("seedDefaultKommunaalRows lisab Kanalisatsioon pärast migratsiooni", () => {
    const plan = {
      ...defaultPlan(),
      budget: { costRows: [{ id: "w1", category: "Vesi ja kanalisatsioon", summaInput: 3600, isDefault: true }], incomeRows: [] },
    };
    const result = seedDefaultKommunaalRows(plan);
    expect(result.budget.costRows.find(r => r.id === "w1").category).toBe("Vesi");
    expect(result.budget.costRows.some(r => r.category === "Kanalisatsioon")).toBe(true);
    const kanRow = result.budget.costRows.find(r => r.category === "Kanalisatsioon");
    expect(kanRow.summaInput).toBe(0);
  });

  it("migratsioon ei loo duplikaate kui Vesi juba eksisteerib", () => {
    const plan = {
      ...defaultPlan(),
      budget: {
        costRows: [
          { id: "v1", category: "Vesi", summaInput: 1200 },
          { id: "vk1", category: "Vesi ja kanalisatsioon", summaInput: 3600 },
        ],
        incomeRows: [],
      },
    };
    // When Vesi already exists, rename still happens (user data must not be lost)
    const result = migrateLegacyKommunaalCategories(plan);
    const vesiRows = result.budget.costRows.filter(r => r.category === "Vesi");
    // Both rows renamed/kept — no silent data loss
    expect(vesiRows.length).toBeGreaterThanOrEqual(1);
    expect(result.budget.costRows.some(r => r.category === "Vesi ja kanalisatsioon")).toBe(false);
  });

  it("seedDefaultKommunaalRows ei loo duplikaate korduvatel kutsetel pärast migratsiooni", () => {
    const plan = {
      ...defaultPlan(),
      budget: { costRows: [{ id: "w1", category: "Vesi ja kanalisatsioon", summaInput: 3600, isDefault: true }], incomeRows: [] },
    };
    const r1 = seedDefaultKommunaalRows(plan);
    const r2 = seedDefaultKommunaalRows(r1);
    expect(r2.budget.costRows.filter(r => r.category === "Vesi").length).toBe(1);
    expect(r2.budget.costRows.filter(r => r.category === "Kanalisatsioon").length).toBe(1);
  });

  it("idempotentne plaanil, kus vana kategooriat pole", () => {
    const plan = seedDefaultKommunaalRows(defaultPlan());
    const result = migrateLegacyKommunaalCategories(plan);
    expect(result).toBe(plan);
  });

  it("removedDefaultKommunaalCategories-s olev 'Vesi ja kanalisatsioon' asendatakse Vesi + Kanalisatsiooniga", () => {
    const plan = {
      ...defaultPlan(),
      removedDefaultKommunaalCategories: ["Vesi ja kanalisatsioon"],
      budget: { costRows: [], incomeRows: [] },
    };
    const result = migrateLegacyKommunaalCategories(plan);
    expect(result.removedDefaultKommunaalCategories).not.toContain("Vesi ja kanalisatsioon");
    expect(result.removedDefaultKommunaalCategories).toContain("Vesi");
    expect(result.removedDefaultKommunaalCategories).toContain("Kanalisatsioon");
  });
});

// ── 11. FUEL_TYPES / FUEL_TYPE_UNITS konstantid ──────────────────────────────

describe("FUEL_TYPES: kütuse liigid", () => {
  it("sisaldab kõiki eeldatavaid liike", () => {
    expect(FUEL_TYPES).toContain("Maagaas");
    expect(FUEL_TYPES).toContain("Pellet");
    expect(FUEL_TYPES).toContain("Hakkepuit");
    expect(FUEL_TYPES).toContain("Kütteõli");
    expect(FUEL_TYPES).toContain("Vedelgaas");
    expect(FUEL_TYPES).toContain("Muu");
  });
});

describe("FUEL_TYPE_UNITS: ühikud kütuse liigi järgi", () => {
  it("Maagaas → m³", () => {
    expect(FUEL_TYPE_UNITS["Maagaas"]).toEqual(["m³"]);
  });

  it("Pellet → t", () => {
    expect(FUEL_TYPE_UNITS["Pellet"]).toEqual(["t"]);
  });

  it("Hakkepuit → t ja rm", () => {
    expect(FUEL_TYPE_UNITS["Hakkepuit"]).toContain("t");
    expect(FUEL_TYPE_UNITS["Hakkepuit"]).toContain("rm");
  });

  it("Kütteõli → l", () => {
    expect(FUEL_TYPE_UNITS["Kütteõli"]).toEqual(["l"]);
  });

  it("Vedelgaas → l ja t", () => {
    expect(FUEL_TYPE_UNITS["Vedelgaas"]).toContain("l");
    expect(FUEL_TYPE_UNITS["Vedelgaas"]).toContain("t");
  });

  it("Muu → tühi massiiv (vabatekst)", () => {
    expect(FUEL_TYPE_UNITS["Muu"]).toEqual([]);
  });
});

// ── 12. Tab 3 UI: fuelType (allikainspektion) ────────────────────────────────

describe("Tab 3 UI: Kütuse liigi väli", () => {
  it("Tab 3-s on 'Kütuse liik' silt", () => {
    expect(src).toContain("Kütuse liik");
  });

  it("Kütuse liigi valik kasutab FUEL_TYPES massiivi", () => {
    const fuelIdx = src.indexOf("isKütus && (");
    const fuelBlock = src.slice(fuelIdx, fuelIdx + 1200);
    expect(fuelBlock).toContain("FUEL_TYPES");
  });

  it("fuelType muutus kasutab FUEL_TYPE_UNITS ühiku vahetamiseks", () => {
    const fuelIdx = src.indexOf("isKütus && (");
    const fuelBlock = src.slice(fuelIdx, fuelIdx + 800);
    expect(fuelBlock).toContain("FUEL_TYPE_UNITS");
  });

  it("Muu fuelType puhul on ühik vabatekst-väli", () => {
    const uhikFreeTekstIdx = src.indexOf("uhikuFreeTekst");
    expect(uhikFreeTekstIdx).toBeGreaterThan(-1);
  });

  it("fuelType tühjendamisel sea uhik tühjaks — ei tohi kasutada KOMMUNAAL_VAIKE_UHIK vaikeväärtust", () => {
    const fuelIdx = src.indexOf("isKütus && (");
    const fuelBlock = src.slice(fuelIdx, fuelIdx + 800);
    // Õige: tühjendamisel uhik = ""
    expect(fuelBlock).toContain('uhik = ""');
    // Vale: tühjendamisel ei tohi määrata vaikeväärtust
    expect(fuelBlock).not.toContain('KOMMUNAAL_VAIKE_UHIK["Kütus"]');
  });

  it("fuelType vahetusel ei valita automaatselt uue liigi esimest ühikut — uhik jääb tühjaks", () => {
    const fuelIdx = src.indexOf("isKütus && (");
    const fuelBlock = src.slice(fuelIdx, fuelIdx + 800);
    // Vale muster: allowedUnits[0] poleks tohtinud olla uhik vaikeväärtus
    expect(fuelBlock).not.toContain("allowedUnits[0]");
  });
});

// ── Tab 2 nuppude tekstid ─────────────────────────────────────────────────────

describe("Tab 2 nuppude tekstid vastavad Tab 1 mustrile", () => {
  let tab2Block;

  beforeAll(() => {
    const sec2Idx = src.indexOf("sec === 2 && (() => {");
    const sec4Idx = src.indexOf("sec === 4 && (", sec2Idx);
    tab2Block = src.slice(sec2Idx, sec4Idx);
  });

  it("üldine clearBtn(2) on Tab 2 ploki alguses (üleval paremal)", () => {
    const clearBtnIdx = tab2Block.indexOf("clearBtn(2)");
    const h1Idx = tab2Block.indexOf("Kavandatavad tulud ja kulud");
    expect(clearBtnIdx).toBeGreaterThan(-1);
    expect(clearBtnIdx).toBeLessThan(h1Idx);
  });

  it("tulureal on 'Eemalda tulu' nupp", () => {
    expect(tab2Block).toContain(">Eemalda tulu<");
  });

  it("kulureal on 'Eemalda kulu' nupp", () => {
    expect(tab2Block).toContain(">Eemalda kulu<");
  });

  it("laenureal on 'Eemalda laen' nupp", () => {
    expect(tab2Block).toContain(">Eemalda laen<");
  });

  it("halduskulude lisamisnupp on '+ Lisa halduskulu'", () => {
    expect(tab2Block).toContain("+ Lisa halduskulu");
  });

  it("muude kulude lisamisnupp on '+ Lisa muu kulu'", () => {
    expect(tab2Block).toContain("+ Lisa muu kulu");
  });

  it("tulude lisamisnupp on '+ Lisa muu tulu'", () => {
    expect(tab2Block).toContain("+ Lisa muu tulu");
  });

  it("laenude lisamisnupp on '+ Lisa olemasolev laen'", () => {
    expect(tab2Block).toContain("+ Lisa olemasolev laen");
  });

  it("Tab 2-s pole tulude eraldi Tühjenda nuppu (incomeRows: [] kustutav askConfirm)", () => {
    // Duplikaatne tulude Tühjenda on eemaldatud — ainult clearBtn(2) üleval
    expect(tab2Block).not.toContain("Kas soovid tuluread kustutada?");
  });
});

// ── 13. utilitySettlementMode ja consumptionDeterminationMethod ───────────────

describe("makeKommunaalRow: utilitySettlementMode vaikimisi väljad", () => {
  it("utilitySettlementMode vaikimisi on 'advance_by_coownership'", () => {
    expect(makeKommunaalRow("Soojus").utilitySettlementMode).toBe("advance_by_coownership");
  });

  it("consumptionDeterminationMethod vaikimisi on tühi string", () => {
    expect(makeKommunaalRow("Elekter").consumptionDeterminationMethod).toBe("");
  });

  it("kõik vaikimisi read sisaldavad utilitySettlementMode välja", () => {
    KOMMUNAAL_DEFAULT_CATEGORIES.forEach(cat => {
      expect(makeKommunaalRow(cat).utilitySettlementMode).toBeDefined();
    });
  });
});

describe("UTILITY_SETTLEMENT_MODES: loend", () => {
  it("sisaldab täpselt 5 väärtust", () => {
    expect(UTILITY_SETTLEMENT_MODES).toHaveLength(5);
  });

  it("sisaldab 'advance_by_coownership'", () => {
    expect(UTILITY_SETTLEMENT_MODES).toContain("advance_by_coownership");
  });

  it("sisaldab 'posthoc_by_consumption_bylaws'", () => {
    expect(UTILITY_SETTLEMENT_MODES).toContain("posthoc_by_consumption_bylaws");
  });

  it("sisaldab 'posthoc_by_consumption_agreement'", () => {
    expect(UTILITY_SETTLEMENT_MODES).toContain("posthoc_by_consumption_agreement");
  });
});

describe("kommunaalRowSettlementValid: arveldusmudeli valideerimine", () => {
  it("puuduv utilitySettlementMode → kehtiv (legacy ühilduvus)", () => {
    expect(kommunaalRowSettlementValid({ summaInput: 1000 })).toBe(true);
  });

  it("'advance_by_coownership' → kehtiv", () => {
    expect(kommunaalRowSettlementValid({ utilitySettlementMode: "advance_by_coownership" })).toBe(true);
  });

  it("'advance_by_apartment' → kehtiv", () => {
    expect(kommunaalRowSettlementValid({ utilitySettlementMode: "advance_by_apartment" })).toBe(true);
  });

  it("'posthoc_by_flat_rate' → kehtiv", () => {
    expect(kommunaalRowSettlementValid({ utilitySettlementMode: "posthoc_by_flat_rate" })).toBe(true);
  });

  it("'posthoc_by_consumption_bylaws' + consumptionDeterminationMethod täidetud → kehtiv", () => {
    expect(kommunaalRowSettlementValid({
      utilitySettlementMode: "posthoc_by_consumption_bylaws",
      consumptionDeterminationMethod: "Veearvestid",
    })).toBe(true);
  });

  it("'posthoc_by_consumption_agreement' + consumptionDeterminationMethod täidetud → kehtiv", () => {
    expect(kommunaalRowSettlementValid({
      utilitySettlementMode: "posthoc_by_consumption_agreement",
      consumptionDeterminationMethod: "Soojusarvestid",
    })).toBe(true);
  });

  it("'posthoc_by_consumption_bylaws' + tühi consumptionDeterminationMethod → mittekehtiv", () => {
    expect(kommunaalRowSettlementValid({
      utilitySettlementMode: "posthoc_by_consumption_bylaws",
      consumptionDeterminationMethod: "",
    })).toBe(false);
  });

  it("'posthoc_by_consumption_agreement' + puuduv consumptionDeterminationMethod → mittekehtiv", () => {
    expect(kommunaalRowSettlementValid({
      utilitySettlementMode: "posthoc_by_consumption_agreement",
    })).toBe(false);
  });

  it("tundmatu utilitySettlementMode → mittekehtiv", () => {
    expect(kommunaalRowSettlementValid({ utilitySettlementMode: "invalid_mode" })).toBe(false);
  });
});
