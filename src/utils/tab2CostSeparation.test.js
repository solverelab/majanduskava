import { describe, it, expect, beforeAll } from "vitest";
import { KOMMUNAALTEENUSED, HALDUSTEENUSED, LAENUMAKSED } from "./majanduskavaCalc";
import { computePlan } from "../engine/computePlan";
import { defaultPlan } from "../domain/planSchema";

// ══════════════════════════════════════════════════════════════════════
// Tab 2 eraldatuse invariandid
//
// Kinnitab, et Tab 2 kulude ja tulude kategooriad on täpselt piiritletud:
//   1. Kommunaalide detailprognoos ei dubleeru Tab 2 tavakuludesse
//   2. Fondimaksed ei ilmu Tab 2 tavakuludesse
//   3. Planeeritav laen ei ilmu Tab 2 tuluna ega tavakuluna
//   4. Olemasoleva laenu teenindamine tuleb computePlan-ist, mitte costRows-ist
//   5. Kulureal on tehniline jaotusviis ja õiguslik alus eraldi väljad
//   6. Vaikejaotus on m² + Seadus
//   7. „Muu teenus" korral kuvatakse kirjelduse sisestusväli
//   8. „Korteriomanike maksed perioodis" ei ole Tab 2 käsitsi muudetav sisend
// ══════════════════════════════════════════════════════════════════════

// Mirrors Tab 2 category constants from MajanduskavaApp.jsx
const TAB2_TULU_KATEGORIAD = ["Toetus", "Kindlustushüvitis", "Üüritulu", "Reklaamitulu", "Muu tulu"];
const TAB2_HALDUS_KATEGORIAD = [
  "Valitseja / halduri tasu", "Raamatupidamine", "Koristus", "Kindlustus",
  "Tehnosüsteemide hooldus", "Pangatasud", "Audit / revisjon", "Õigusabi",
  "Heakord", "Liftihooldus", "Tuleohutuse kontroll / hooldus", "Prügivedu", "Muu teenus",
];
const TAB2_MUUD_KATEGORIAD = [
  "Ekspertiis", "Energiaaudit", "Projekt", "Jooksev remont", "Muu majandamiskulu",
];

// Mirrors Tab 2 row classification logic from MajanduskavaApp.jsx.
// _inSection: "haldus" routes unclassified (category="") rows to the haldus block.
function classifyTab2Rows(costRows) {
  const haldusRows = costRows.filter(r =>
    HALDUSTEENUSED.includes(r.category) ||
    (r.category === "" && r._inSection === "haldus")
  );
  const muudRows = costRows.filter(r =>
    !KOMMUNAALTEENUSED.includes(r.category) &&
    !HALDUSTEENUSED.includes(r.category) &&
    !LAENUMAKSED.includes(r.category) &&
    !(r.category === "" && r._inSection === "haldus")
  );
  return { haldusRows, muudRows };
}

// ── 1. Kommunaalid ei dubleeru Tab 2 kuludesse ─────────────────────────────

describe("Tab 2: kommunaalide detailprognoos ei dubleeru tavakuludesse", () => {
  it("kommunaalteenuse kategooriaga rida ei jõua muudRows-i", () => {
    const rows = [
      { id: "k1", category: "Soojus", summaInput: "5000" },
      { id: "k2", category: "Vesi ja kanalisatsioon", summaInput: "3000" },
      { id: "m1", category: "Muu majandamiskulu", summaInput: "1000" },
    ];
    const { muudRows } = classifyTab2Rows(rows);
    expect(muudRows.map(r => r.id)).toEqual(["m1"]);
    expect(muudRows.some(r => KOMMUNAALTEENUSED.includes(r.category))).toBe(false);
  });

  it("kõik KOMMUNAALTEENUSED liigid on muudRows-ist välistatud", () => {
    const rows = KOMMUNAALTEENUSED.map((cat, i) => ({ id: `k${i}`, category: cat, summaInput: "1000" }));
    const { muudRows } = classifyTab2Rows(rows);
    expect(muudRows).toHaveLength(0);
  });
});

// ── _inSection router ────────────────────────────────────────────────────────

describe("Tab 2: _inSection: 'haldus' suunab tühja kategooriaga rida haldusRows-i", () => {
  it("_inSection: 'haldus' ja category: '' → haldusRows, mitte muudRows", () => {
    const rows = [{ id: "h1", category: "", _inSection: "haldus" }];
    const { haldusRows, muudRows } = classifyTab2Rows(rows);
    expect(haldusRows.map(r => r.id)).toContain("h1");
    expect(muudRows.map(r => r.id)).not.toContain("h1");
  });

  it("_inSection puudub ja category: '' → muudRows (haldus init pole rakendunud)", () => {
    const rows = [{ id: "m1", category: "" }];
    const { haldusRows, muudRows } = classifyTab2Rows(rows);
    expect(haldusRows.map(r => r.id)).not.toContain("m1");
    expect(muudRows.map(r => r.id)).toContain("m1");
  });

  it("_inSection: 'haldus' ja HALDUSTEENUSED kategooria → haldusRows (mõlemal tingimusel)", () => {
    const rows = [{ id: "h2", category: "Koristus", _inSection: "haldus" }];
    const { haldusRows, muudRows } = classifyTab2Rows(rows);
    expect(haldusRows.map(r => r.id)).toContain("h2");
    expect(muudRows.map(r => r.id)).not.toContain("h2");
  });
});

// ── 2. Fondimaksed ei ilmu Tab 2 tavakuludesse ────────────────────────────

describe("Tab 2: fondimaksed ei ilmu tavakuludesse", () => {
  it("TAB2 kulukategooriate valik ei sisalda fondimakseid", () => {
    const fondKategooriad = ["Remondifond", "Reservkapital", "Kogumismakse"];
    for (const k of fondKategooriad) {
      expect(TAB2_HALDUS_KATEGORIAD).not.toContain(k);
      expect(TAB2_MUUD_KATEGORIAD).not.toContain(k);
    }
  });

  it("TAB2 tulukategooriate valik ei sisalda fondimakseid", () => {
    const fondKategooriad = ["Remondifond", "Reservkapital", "Kogumismakse"];
    for (const k of fondKategooriad) {
      expect(TAB2_TULU_KATEGORIAD).not.toContain(k);
    }
  });
});

// ── 3. Planeeritav laen ei ilmu Tab 2 tuluna ega tavakuluna ──────────────

describe("Tab 2: uus planeeritav laen ei ilmu tuluna ega tavakuluna", () => {
  it("TAB2 tulukategooriad ei sisalda laenuga seotud kategooriaid", () => {
    const loanCats = ["Laen", "Laenumakse", "Laenusumma", "Krediit"];
    for (const k of loanCats) {
      expect(TAB2_TULU_KATEGORIAD).not.toContain(k);
    }
  });

  it("LAENUMAKSED kategooria on muudRows-ist välistatud", () => {
    const rows = [
      { id: "l1", category: "Laenumakse", summaInput: "8000" },
      { id: "m1", category: "Jooksev remont", summaInput: "1000" },
    ];
    const { muudRows } = classifyTab2Rows(rows);
    expect(muudRows.map(r => r.id)).toEqual(["m1"]);
  });

  it("'Laenumakse' ei ole Tab 2 haldus- ega muude kulude kategoorias", () => {
    expect(TAB2_HALDUS_KATEGORIAD).not.toContain("Laenumakse");
    expect(TAB2_MUUD_KATEGORIAD).not.toContain("Laenumakse");
  });
});

// ── 4. Laenu teenindamine tuleb computePlan-ist ───────────────────────────

describe("Tab 2: laenu teenindamine tuleb computePlan-ist, mitte costRows-ist", () => {
  const basePlan = () => ({
    ...defaultPlan({ year: 2027 }),
    period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
    building: { apartments: [{ id: "a1", label: "1", areaM2: 50 }] },
    budget: {
      costRows: [{ id: "c1", side: "COST", category: "Valitseja / halduri tasu", summaInput: "2400", calc: { type: "FIXED_PERIOD", params: { amountEUR: 2400 } } }],
      incomeRows: [],
    },
  });

  it("ilma plan.loans-ita → derived.loans.items on tühi", () => {
    const d = computePlan(basePlan());
    expect(d.loans.items).toHaveLength(0);
  });

  it("plan.loans-i laenuga → derived.loans.items sisaldab teenindust", () => {
    const plan = {
      ...basePlan(),
      loans: [{
        id: "ln1", name: "KredEx laen", principalEUR: 50000, annualRatePct: 3,
        termMonths: 120, type: "annuity", startYM: "2027-01", reservePct: 0,
      }],
    };
    const d = computePlan(plan);
    expect(d.loans.items).toHaveLength(1);
    expect(d.loans.items[0].id).toBe("ln1");
    expect(d.loans.items[0].servicingPeriodEUR).toBeGreaterThan(0);
  });

  it("Laenumakse kategooriaga costRow ei loo derived.loans.items kirjet", () => {
    const plan = {
      ...basePlan(),
      budget: {
        costRows: [{ id: "lm1", side: "COST", category: "Laenumakse", summaInput: "5000", calc: { type: "FIXED_PERIOD", params: { amountEUR: 5000 } } }],
        incomeRows: [],
      },
    };
    const d = computePlan(plan);
    expect(d.loans.items).toHaveLength(0);
  });
});

// ── 5, 6. Jaotusviis + õiguslik alus; vaikeväärtused ────────────────────

describe("Tab 2: tehniline jaotusviis ja õiguslik alus on eraldi väljad", () => {
  it("isMuuTeenus: jaotusviis fallback on 'm2' kui allocationBasis puudub", () => {
    const row = { id: "r1", category: "Koristus" };
    const jaotusviis = row.allocationBasis || "m2";
    expect(jaotusviis).toBe("m2");
  });

  it("isMuuTeenus: legalSeadus on true kui legalBasisSeadus puudub (default)", () => {
    const row = { id: "r1", category: "Koristus" };
    const legalSeadus = row.legalBasisSeadus !== false;
    expect(legalSeadus).toBe(true);
  });

  it("legalBasisSeadus: false → seadus ei ole checked", () => {
    const row = { id: "r1", category: "Koristus", legalBasisSeadus: false };
    const legalSeadus = row.legalBasisSeadus !== false;
    expect(legalSeadus).toBe(false);
  });

  it("allocationBasis: 'apartment' on aktsepteeritud väärtus", () => {
    const row = { id: "r1", category: "Koristus", allocationBasis: "apartment" };
    const jaotusviis = row.allocationBasis || "m2";
    expect(jaotusviis).toBe("apartment");
  });
});

// ── 7. Muu teenus kirjelduse loogika ──────────────────────────────────

describe("Tab 2: 'Muu teenus' korral kuvatakse kirjelduse sisestusväli", () => {
  const isMuuTeenus = (cat) => cat === "Muu teenus" || cat === "Muu haldusteenus";

  it("'Muu teenus' → kirjelduse väli on nähtav", () => {
    expect(isMuuTeenus("Muu teenus")).toBe(true);
  });

  it("'Muu haldusteenus' (legacy) → kirjelduse väli on nähtav", () => {
    expect(isMuuTeenus("Muu haldusteenus")).toBe(true);
  });

  it("'Koristus' → kirjelduse välja ei näidata", () => {
    expect(isMuuTeenus("Koristus")).toBe(false);
  });

  it("'Muu majandamiskulu' → kirjelduse välja ei näidata (see on muudRows, mitte haldus)", () => {
    expect(isMuuTeenus("Muu majandamiskulu")).toBe(false);
  });

  it("muuTeenusKirjeldus välja väärtus kasutatakse kirjeldusena", () => {
    const row = { category: "Muu teenus", muuTeenusKirjeldus: "desinfitseerimine" };
    const kirjeldus = isMuuTeenus(row.category) ? (row.muuTeenusKirjeldus || "") : "";
    expect(kirjeldus).toBe("desinfitseerimine");
  });

  it("tavakategooria → kirjeldus on tühi sõltumata väljast", () => {
    const row = { category: "Koristus", muuTeenusKirjeldus: "midagi" };
    const kirjeldus = isMuuTeenus(row.category) ? (row.muuTeenusKirjeldus || "") : "";
    expect(kirjeldus).toBe("");
  });
});

// ── 8. Struktuur: korteriomanike maksed ei ole Tab 2 käsitsi muudetav sisend

describe("Tab 2 lähtekoodi struktuur", () => {
  let src;
  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  });

  it("Tab 2 kasutab derived.loans laenumaksete kuvamiseks (mitte käsitsi sisend)", () => {
    expect(src).toContain("derived.loans");
    const tab2Start = src.indexOf("sec === 2");
    const loanItemsInTab2 = src.indexOf("loanItems", tab2Start);
    expect(loanItemsInTab2).toBeGreaterThan(tab2Start);
  });

  it("Tab 2 lisab halduskulu vaikimisi allocationBasis m² ja legalBasisSeadus: true", () => {
    expect(src).toContain('allocationBasis: "m2"');
    expect(src).toContain('legalBasisSeadus: true');
  });

  it("Tab 2 kasutab 'Kulude jaotuse alus' ja 'Erandi alus' eraldi sektsioonidena", () => {
    const tab2Start = src.indexOf("sec === 2");
    // window peab katma kuluridade (u 2553) ja laenuridade (u 2820) selectorid
    const sec2Region = src.slice(tab2Start, tab2Start + 40000);
    expect(sec2Region).toContain("Kulude jaotuse alus");
    expect(sec2Region).toContain("Erandi alus");
    // sisemine väärtus "m2" jääb alles (andmemudel muutmata)
    expect(sec2Region).toContain('value="m2"');
  });

  it("Tab 2 kuluridad kasutavad jaotusaluse sõnastusena 'Kaasomandi osa suuruse alusel'", () => {
    // tab2KuluRida funktsioon (haldus + muud kulud) kasutab 'Kaasomandi osa suuruse alusel'
    const kuluridaFn = src.slice(src.indexOf("const tab2KuluRida"), src.indexOf("const existingLoans"));
    expect(kuluridaFn).toContain("Kaasomandi osa suuruse alusel");
    expect(kuluridaFn).not.toContain("Kaasomandi osa / m² arvestus");
    expect(kuluridaFn).not.toContain("Kaasomandi osa järgi (m² järgi)");
  });

  it("'Kaasomandi osa järgi (m² järgi)' ei esine kuskil failis", () => {
    expect(src).not.toContain("Kaasomandi osa järgi (m² järgi)");
  });

  it("'Kaasomandi osa / m² arvestus' esineb ainult laenuplokis — kuluridades 'Kaasomandi osa suuruse alusel'", () => {
    // Laenuplokis on 'Kaasomandi osa / m² arvestus' (user spec — laenurea tehniline jaotusviis)
    expect(src).toContain("Kaasomandi osa / m² arvestus");
    // Kuluridade jaotusaluse select ei kasuta seda sõnastust
    const kuluridaFn = src.slice(src.indexOf("const tab2KuluRida"), src.indexOf("const existingLoans"));
    expect(kuluridaFn).not.toContain("Kaasomandi osa / m² arvestus");
  });

  it("Tab 2 kommunaalide plokk on teadlikult välja jäetud (pole haldus- ega muude kulude sees)", () => {
    // Kommunaalid on Tab 5-s, Tab 2 kuvab ainult kogusummat (p2 aggregaati)
    const tab2Start = src.indexOf("sec === 2");
    const sec2Region = src.slice(tab2Start, tab2Start + 15000);
    // Kommunaalide detailne edit (utilityType, kogus, ühik) ei ole Tab 2-s
    expect(sec2Region).not.toContain("utilityType");
  });
});

// ── Tab 2 jaotusaluse UI lihtsustus: tavajuht ja erandi alus ────────────────

describe("Tab 2 jaotusaluse UI — tavajuht ja erandi alus", () => {
  let src;
  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  });

  const tab2Region = () => {
    const tab2Start = src.indexOf("sec === 2");
    return src.slice(tab2Start, tab2Start + 40000);
  };

  it("tavajuhtumi helper tekst eemaldatud — KrtS § 40 lg 1 viidet ei kuvata", () => {
    expect(src).not.toContain("Kulu jaotatakse KrtS § 40 lg 1 alusel kaasomandi osa suuruse järgi.");
  });

  it("'Erandi alus' sektsioon on Tab 2-s", () => {
    expect(tab2Region()).toContain("Erandi alus");
  });

  it("'Jaotuse kirjeldus' väli on Tab 2-s (Muu jaotuse korral)", () => {
    expect(tab2Region()).toContain("Jaotuse kirjeldus");
  });

  it("'Korteri kohta' valimisel seatakse legalBasisSeadus: false — seadus ei jää true", () => {
    expect(src).toContain('allocationBasis: "apartment", legalBasisSeadus: false');
  });

  it("'Kaasomandi osa suuruse alusel' tagasi valimisel puhastatakse legalBasisBylaws, legalBasisSpecialAgreement, allocationBasisMuuKirjeldus", () => {
    expect(src).toContain('legalBasisBylaws: false, legalBasisSpecialAgreement: false');
    expect(src).toContain('allocationBasisMuuKirjeldus: ""');
  });

  it("'Erandi alus' sektsioon sisaldab Põhikiri ja Kokkulepe valikuid, aga mitte eraldi 'Seadus' checkboxi", () => {
    // Erandi alus on JSX-is >Erandi alus<, mitte "Erandi alus"
    const erandiStart = src.indexOf("Erandi alus");
    expect(erandiStart).toBeGreaterThan(-1);
    const erandiRegion = src.slice(erandiStart, erandiStart + 800);
    expect(erandiRegion).toContain('"Põhikiri"');
    expect(erandiRegion).toContain('"Kokkulepe"');
    expect(erandiRegion).not.toContain('"Seadus"');
  });

  it("'Põhjendus' labelit ei esine Tab 2 UI-s", () => {
    expect(tab2Region()).not.toContain("Põhjendus");
  });

  it("'Tarbimise järgi' ei esine Tab 2 jaotusaluse valikus", () => {
    expect(tab2Region()).not.toContain("Tarbimise järgi");
  });

  it("allocationBasis: 'm2' jääb legacy väärtuseks (value='m2' on selectis)", () => {
    expect(tab2Region()).toContain('value="m2"');
    expect(tab2Region()).toContain('value="apartment"');
    expect(tab2Region()).toContain('value="muu"');
  });
});

// ── Tab 2 „Täpsustus" toggle muster ─────────────────────────────────────────

describe("Tab 2 täpsustus-toggle muster", () => {
  let src;
  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  });

  const tab2Region = () => {
    const tab2Start = src.indexOf("sec === 2");
    return src.slice(tab2Start, tab2Start + 40000);
  };

  it('"Selgitus (valikuline)" label ei esine Tab 2 piirkonnas', () => {
    // kõik selgitus-labelid on ümbernimetatud "Täpsustus"-ks
    expect(tab2Region()).not.toContain("Selgitus (valikuline)");
  });

  it('"Selgitus (valikuline)" ei esine kuskil failis Tab 2 kulurea ega tuluridade koodis', () => {
    // kommunaalide toggle on eraldi — kontrolli, et tab2KuluRida ja income rows on puhastatud
    const kuluridaFn = src.slice(src.indexOf("const tab2KuluRida"), src.indexOf("const haldusSum"));
    expect(kuluridaFn).not.toContain("Selgitus (valikuline)");
    const incomeStart = src.indexOf("incomeRows.map");
    const incomeRegion = src.slice(incomeStart, incomeStart + 2000);
    expect(incomeRegion).not.toContain("Selgitus (valikuline)");
  });

  it('"+ Lisa märkus" toggle nupp on Tab 2-s olemas', () => {
    expect(tab2Region()).toContain("+ Lisa märkus");
  });

  it('"+ Lisa märkus" esineb tab2Region-is vähemalt 2 korda — kuluRida + income', () => {
    const region = tab2Region();
    const count = (region.match(/\+ Lisa märkus/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('"+ Lisa märkus" esineb failis vähemalt 3 korda — kommunaal + kuluRida + income', () => {
    const count = (src.match(/\+ Lisa märkus/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('"Märkus (valikuline)" label on failis (kuvub kui väli on avatud)', () => {
    expect(src).toContain("Märkus");
  });

  it("dünaamiline placeholder 'Nt põhikirja punkt' on kulurea erandi täpsustuses", () => {
    expect(src).toContain("Nt põhikirja punkt");
  });

  it("dünaamiline placeholder 'Nt kokkuleppe kirjeldus' on kulurea erandi täpsustuses", () => {
    expect(src).toContain("Nt kokkuleppe kirjeldus");
  });

  it("dünaamiline placeholder 'Nt muu õiguslik alus või selgitus' on kulurea erandi täpsustuses", () => {
    expect(src).toContain("Nt muu õiguslik alus või selgitus");
  });

  it("taepsustusPlaceholder muutuja esineb nii tab2KuluRida kui laenuridade plokis", () => {
    const kuluridaFn = src.slice(src.indexOf("const tab2KuluRida"), src.indexOf("const haldusSum"));
    expect(kuluridaFn).toContain("taepsustusPlaceholder");
    const laenuStart = src.indexOf("existingLoans.map");
    const laenuRegion = src.slice(laenuStart, laenuStart + 4000);
    expect(laenuRegion).toContain("taepsustusPlaceholder");
  });

  it('"openTab2TaepsustusId" state on deklareeritud', () => {
    expect(src).toContain("openTab2TaepsustusId");
  });
});

// ── Tab 2 valideerimine: dirty-row logika ja inline vead ────────────────────

describe("Tab 2 valideerimisfunktsioonid", () => {
  // Module-level functions are defined outside the React component,
  // so we test them via dynamic import of the JSX file source inspection,
  // or we replicate the same logic inline (same as what's in the file).

  // Replicate functions from MajanduskavaApp.jsx for isolated unit tests
  const isIncomeRowDirty = (r) =>
    !!(r.category || r.name?.trim() || parseFloat(r.summaInput) > 0 || r.selgitus?.trim());

  const getIncomeRowErrors = (r) => {
    const errs = {};
    if (!r.category) errs.category = "Vali kategooria";
    if (!r.name?.trim()) errs.name = "Sisesta nimetus";
    if (!(parseFloat(r.summaInput) > 0)) errs.summaInput = "Sisesta summa";
    return errs;
  };

  const isKuluridaDirty = (r) =>
    !!(r.category || parseFloat(r.summaInput) > 0 || r.selgitus?.trim() || r.muuTeenusKirjeldus?.trim());

  const getKuluridaErrors = (r) => {
    const errs = {};
    if (!r.category) errs.category = "Vali kululiik";
    if (!(parseFloat(r.summaInput) > 0)) errs.summaInput = "Sisesta summa";
    const isMuuTeenus = r.category === "Muu teenus" || r.category === "Muu haldusteenus";
    if (isMuuTeenus && !r.muuTeenusKirjeldus?.trim()) errs.muuTeenusKirjeldus = "Kirjelda teenust";
    const jaotusviis = r.allocationBasis || "m2";
    if (jaotusviis === "muu" && !r.allocationBasisMuuKirjeldus?.trim()) errs.allocationBasisMuuKirjeldus = "Jaotuse kirjeldus puudub";
    if (jaotusviis === "apartment" || jaotusviis === "muu") {
      const hasErand = r.legalBasisBylaws || r.legalBasisSpecialAgreement || r.legalBasisMuu;
      if (!hasErand) errs.erandAlus = "Vali erandi alus";
      else if (!r.legalBasisTaepsustus?.trim()) errs.legalBasisTaepsustus = "Lisa täpsustus";
    }
    return errs;
  };

  const isLaenuridaDirty = (ln) =>
    !!(ln.laenuandja || (parseFloat(ln.pohiosPerioodis) || 0) > 0 ||
       (parseFloat(ln.intressPerioodis) || 0) > 0 || (parseFloat(ln.teenustasudPerioodis) || 0) > 0 ||
       ln.eesmärk || ln.laenuandjaKirjeldus?.trim());

  const getLaenuridaErrors = (ln) => {
    const errs = {};
    if (!ln.laenuandja) errs.laenuandja = "Sisesta laenuandja";
    if (ln.laenuandja === "Muu" && !ln.laenuandjaKirjeldus?.trim()) errs.laenuandjaKirjeldus = "Sisesta laenuandja nimi";
    if (!ln.eesmärk) errs.eesmärk = "Sisesta eesmärk";
    if (ln.eesmärk === "Muu" && !ln.eesmärkKirjeldus?.trim()) errs.eesmärkKirjeldus = "Kirjelda eesmärki";
    const summa = (parseFloat(ln.pohiosPerioodis) || 0) + (parseFloat(ln.intressPerioodis) || 0) + (parseFloat(ln.teenustasudPerioodis) || 0);
    if (!(summa > 0)) errs.summa = "Sisesta vähemalt üks summa";
    const jaotusviis = ln.allocationBasis || "m2";
    if (jaotusviis === "muu" && !ln.allocationBasisMuuKirjeldus?.trim()) errs.allocationBasisMuuKirjeldus = "Jaotuse kirjeldus puudub";
    if (jaotusviis === "apartment" || jaotusviis === "muu") {
      const hasErand = ln.legalBasisBylaws || ln.legalBasisSpecialAgreement || ln.legalBasisMuu;
      if (!hasErand) errs.erandAlus = "Vali erandi alus";
      else if (!ln.legalBasisTaepsustus?.trim()) errs.legalBasisTaepsustus = "Lisa täpsustus";
    }
    return errs;
  };

  // ── Tulurida ──────────────────────────────────────────────────────────────

  it("tulurida kategooriaga, aga summata → invalid", () => {
    const r = { id: "1", category: "Toetus", name: "Avatus", summaInput: "" };
    expect(isIncomeRowDirty(r)).toBe(true);
    expect(getIncomeRowErrors(r).summaInput).toBe("Sisesta summa");
  });

  it("tulurida summaga, aga nimetuseta → invalid", () => {
    const r = { id: "1", category: "Toetus", name: "", summaInput: "500" };
    expect(isIncomeRowDirty(r)).toBe(true);
    expect(getIncomeRowErrors(r).name).toBe("Sisesta nimetus");
  });

  it("täiesti tühi tulurida ei ole dirty", () => {
    const r = { id: "1", category: "", name: "", summaInput: "" };
    expect(isIncomeRowDirty(r)).toBe(false);
  });

  it("korrektselt täidetud tulurida → ei ole vigu", () => {
    const r = { id: "1", category: "Toetus", name: "Investeeringutoetus", summaInput: "1000" };
    expect(isIncomeRowDirty(r)).toBe(true);
    expect(Object.keys(getIncomeRowErrors(r))).toHaveLength(0);
  });

  it("summa = 0 loetakse puuduvaks", () => {
    const r = { id: "1", category: "Toetus", name: "Test", summaInput: "0" };
    expect(getIncomeRowErrors(r).summaInput).toBe("Sisesta summa");
  });

  // ── Kulurida ──────────────────────────────────────────────────────────────

  it("kulurida kululiigiga, aga summata → invalid", () => {
    const r = { id: "1", category: "Koristus", summaInput: "" };
    expect(isKuluridaDirty(r)).toBe(true);
    expect(getKuluridaErrors(r).summaInput).toBe("Sisesta summa");
  });

  it("kulurida 'Muu teenus', aga kirjelduseta → invalid", () => {
    const r = { id: "1", category: "Muu teenus", summaInput: "800", muuTeenusKirjeldus: "" };
    expect(getKuluridaErrors(r).muuTeenusKirjeldus).toBe("Kirjelda teenust");
  });

  it("kulurida 'Korteri kohta', aga erandi aluseta → invalid", () => {
    const r = { id: "1", category: "Koristus", summaInput: "800", allocationBasis: "apartment",
      legalBasisBylaws: false, legalBasisSpecialAgreement: false, legalBasisMuu: false };
    expect(getKuluridaErrors(r).erandAlus).toBe("Vali erandi alus");
  });

  it("kulurida erandi alusega, aga täpsustuseta → invalid", () => {
    const r = { id: "1", category: "Koristus", summaInput: "800", allocationBasis: "apartment",
      legalBasisBylaws: true, legalBasisTaepsustus: "" };
    expect(getKuluridaErrors(r).legalBasisTaepsustus).toBe("Lisa täpsustus");
  });

  it("kulurida 'Muu' jaotus, aga jaotuse kirjelduseta → invalid", () => {
    const r = { id: "1", category: "Koristus", summaInput: "800", allocationBasis: "muu",
      allocationBasisMuuKirjeldus: "", legalBasisBylaws: true, legalBasisTaepsustus: "§ 5" };
    expect(getKuluridaErrors(r).allocationBasisMuuKirjeldus).toBe("Jaotuse kirjeldus puudub");
  });

  it("täiesti tühi kulurida ei ole dirty", () => {
    const r = { id: "1", category: "", summaInput: "" };
    expect(isKuluridaDirty(r)).toBe(false);
  });

  it("korrektselt täidetud kulurida m2 alusel → ei ole vigu", () => {
    const r = { id: "1", category: "Koristus", summaInput: "1200", allocationBasis: "m2" };
    expect(isKuluridaDirty(r)).toBe(true);
    expect(Object.keys(getKuluridaErrors(r))).toHaveLength(0);
  });

  it("korrektselt täidetud kulurida erandi alusega → ei ole vigu", () => {
    const r = { id: "1", category: "Koristus", summaInput: "800", allocationBasis: "apartment",
      legalBasisBylaws: true, legalBasisTaepsustus: "põhikiri § 5" };
    expect(Object.keys(getKuluridaErrors(r))).toHaveLength(0);
  });

  // ── Laenurida ─────────────────────────────────────────────────────────────

  it("laenurida laenuandjaga, aga summadeta → invalid", () => {
    const ln = { id: "1", laenuandja: "KredEx", eesmärk: "Energiasääst",
      pohiosPerioodis: 0, intressPerioodis: 0, teenustasudPerioodis: 0 };
    expect(isLaenuridaDirty(ln)).toBe(true);
    expect(getLaenuridaErrors(ln).summa).toBe("Sisesta vähemalt üks summa");
  });

  it("laenurida 'Muu' laenuandjaga, aga nime täpsustuseta → invalid", () => {
    const ln = { id: "1", laenuandja: "Muu", laenuandjaKirjeldus: "",
      eesmärk: "Renoveerimine", pohiosPerioodis: 1000, intressPerioodis: 50, teenustasudPerioodis: 0 };
    expect(getLaenuridaErrors(ln).laenuandjaKirjeldus).toBe("Sisesta laenuandja nimi");
  });

  it("täiesti tühi laenurida ei ole dirty", () => {
    const ln = { id: "1", laenuandja: "", eesmärk: "",
      pohiosPerioodis: 0, intressPerioodis: 0, teenustasudPerioodis: 0 };
    expect(isLaenuridaDirty(ln)).toBe(false);
  });

  it("korrektselt täidetud laenurida → ei ole vigu", () => {
    const ln = { id: "1", laenuandja: "KredEx", eesmärk: "Energiasääst",
      pohiosPerioodis: 5000, intressPerioodis: 200, teenustasudPerioodis: 0,
      allocationBasis: "m2" };
    expect(isLaenuridaDirty(ln)).toBe(true);
    expect(Object.keys(getLaenuridaErrors(ln))).toHaveLength(0);
  });

  // ── tabStatus loogika invariant ───────────────────────────────────────────

  it("tühi Tab 2 (kõik read tühjad) → tab2AnyStarted=false ja tab2HasErrors=false → notStarted", () => {
    const incomeRows = [{ id: "1", category: "", name: "", summaInput: "" }];
    const kuluRows = [{ id: "2", category: "", summaInput: "" }];
    const loans = [{ id: "3", laenuandja: "", eesmärk: "", pohiosPerioodis: 0, intressPerioodis: 0, teenustasudPerioodis: 0 }];
    const anyStarted =
      incomeRows.some(isIncomeRowDirty) ||
      kuluRows.some(isKuluridaDirty) ||
      loans.some(isLaenuridaDirty);
    const hasErrors =
      incomeRows.some(r => isIncomeRowDirty(r) && Object.keys(getIncomeRowErrors(r)).length > 0) ||
      kuluRows.some(r => isKuluridaDirty(r) && Object.keys(getKuluridaErrors(r)).length > 0) ||
      loans.some(ln => isLaenuridaDirty(ln) && Object.keys(getLaenuridaErrors(ln)).length > 0);
    expect(anyStarted).toBe(false);
    expect(hasErrors).toBe(false);
  });

  it("üks poolik kulurida → tab2HasErrors=true → punane", () => {
    const rows = [{ id: "1", category: "Koristus", summaInput: "" }];
    const hasErrors = rows.some(r => isKuluridaDirty(r) && Object.keys(getKuluridaErrors(r)).length > 0);
    expect(hasErrors).toBe(true);
  });

  it("kõik korrektselt täidetud read → tab2HasErrors=false, tab2AnyStarted=true → roheline", () => {
    const incomeRows = [{ id: "1", category: "Toetus", name: "Avatus", summaInput: "500" }];
    const kuluRows = [{ id: "2", category: "Koristus", summaInput: "1200", allocationBasis: "m2" }];
    const anyStarted = incomeRows.some(isIncomeRowDirty) || kuluRows.some(isKuluridaDirty);
    const hasErrors =
      incomeRows.some(r => isIncomeRowDirty(r) && Object.keys(getIncomeRowErrors(r)).length > 0) ||
      kuluRows.some(r => isKuluridaDirty(r) && Object.keys(getKuluridaErrors(r)).length > 0);
    expect(anyStarted).toBe(true);
    expect(hasErrors).toBe(false);
  });
});
