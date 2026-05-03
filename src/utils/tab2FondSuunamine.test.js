// src/utils/tab2FondSuunamine.test.js
// Lukustab Tab 2 tulu fondi suunamise loogika ja Tab 3 Remondifondi sidumise.

import { describe, it, expect, beforeAll } from "vitest";
import { computeRemondifondiArvutus, normalizeIncomeAllocations } from "./majanduskavaCalc";

let src;
let incomeSection; // Tab 2 tulurea renderdus

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");

  // Kasuta UI-spetsiifilist ankrut — isMarkusOpenR on ainult tulude UI map-is
  const start = src.indexOf("isMarkusOpenR = !!r.note");
  const end = src.indexOf("+ Lisa muu tulu", start);
  incomeSection = start >= 0 && end > start ? src.slice(start, end) : "";
});

// ── 1. Andmemudel: vaikeväljad ──────────────────────────────────────────────

describe("Uus tulurida: vaikimisi incomeUse = 'general'", () => {
  it("addRow INCOME sisaldab incomeUse: 'general' vaikeväärtust", () => {
    expect(src).toContain('incomeUse: "general"');
  });

  it("addRow INCOME sisaldab targetFund: null vaikeväärtust", () => {
    expect(src).toContain("targetFund: null");
  });

  it("addRow INCOME sisaldab fundDirectedAmount: '' vaikeväärtust", () => {
    // INCOME haru on COST haru järel, kasutame pikka akent
    const addRowStart = src.indexOf("const addRow =");
    const addRowEnd = src.indexOf("const updateRow =", addRowStart);
    const addRowSection = src.slice(addRowStart, addRowEnd);
    expect(addRowSection).toContain('fundDirectedAmount: ""');
  });
});

// ── 2. Tab 2 UI väljad ───────────────────────────────────────────────────────

describe("Tab 2 UI: tulu sisestusväljad", () => {
  it("'Kategooria' label on tulurea renderduses — asendas 'Kasutamine' dropdowni", () => {
    expect(incomeSection).toContain(">Kategooria<");
  });

  it("'Kasutamine' dropdown-i pole tulureal", () => {
    expect(incomeSection).not.toContain(">Kasutamine<");
    expect(incomeSection).not.toContain("Kasutatakse üldkulude katteks");
  });

  it("incomeAllocations sync on olemas EuroInput onChange-is", () => {
    expect(incomeSection).toContain("(r.incomeAllocations || []).length > 0");
  });
});

// ── 3. Valideerimine ─────────────────────────────────────────────────────────

describe("Tab 2 tulu suunamise valideerimine (normalizeIncomeAllocations)", () => {
  const base = { category: "Muu tulu", name: "Üür", summaInput: "1000", incomeAllocation: "general", incomeAllocations: [] };

  it("üldine tulu on kehtiv ilma allokeerimiseta", () => {
    const norm = normalizeIncomeAllocations(base);
    expect(norm.isValid).toBe(true);
    expect(norm.errors).toHaveLength(0);
  });

  it("tühi incomeAllocations → isValid true, isDirected false (üldine KÜ tulu)", () => {
    const r = { ...base, incomeAllocation: "targeted" };
    const norm = normalizeIncomeAllocations(r);
    expect(norm.isValid).toBe(true);
    expect(norm.isDirected).toBe(false);
  });

  it("targeted + repairFund suunamine + summa võrdub → isValid true", () => {
    const r = { ...base, incomeAllocation: "targeted", incomeAllocations: [{ id: "a1", target: "repairFund", amount: "1000", note: "" }] };
    const norm = normalizeIncomeAllocations(r);
    expect(norm.isValid).toBe(true);
    expect(norm.totalAllocated).toBe(1000);
  });

  it("targeted + summa ei võrdu tulurea summaga → viga", () => {
    const r = { ...base, incomeAllocation: "targeted", incomeAllocations: [{ id: "a1", target: "repairFund", amount: "800", note: "" }] };
    const norm = normalizeIncomeAllocations(r);
    expect(norm.isValid).toBe(false);
    expect(norm.errors.some(e => e.includes("kokku andma"))).toBe(true);
  });

  it("targeted + suunamine ilma sihtkohata → viga", () => {
    const r = { ...base, incomeAllocation: "targeted", incomeAllocations: [{ id: "a1", target: "", amount: "1000", note: "" }] };
    const norm = normalizeIncomeAllocations(r);
    expect(norm.isValid).toBe(false);
    expect(norm.errors.some(e => e.includes("sihtkoht"))).toBe(true);
  });
});

// ── 4. fondiMuuTuluFromTab2 arvutuse loogika (normalizeIncomeAllocations kaudu) ─

describe("fondiMuuTuluFromTab2 arvutus (uus mudel)", () => {
  const computeFondi = (incomeRows) =>
    incomeRows.reduce((sum, r) => {
      const norm = normalizeIncomeAllocations(r);
      const repairTotal = norm.allocations
        .filter(a => a.target === "repairFund")
        .reduce((s, a) => s + Math.max(0, Math.round(parseFloat(a.amount) || 0)), 0);
      return sum + repairTotal;
    }, 0);

  it("üldine tulu ei mõjuta remondifondi", () => {
    expect(computeFondi([
      { summaInput: "2000", incomeAllocation: "general", incomeAllocations: [] },
    ])).toBe(0);
  });

  it("repairFund suunamine → suunatud summa lisatakse", () => {
    expect(computeFondi([
      { summaInput: "1500", incomeAllocation: "targeted", incomeAllocations: [{ id: "x", target: "repairFund", amount: "1500", note: "" }] },
    ])).toBe(1500);
  });

  it("osaline suunamine → ainult suunatud osa", () => {
    expect(computeFondi([
      { summaInput: "1500", incomeAllocation: "targeted", incomeAllocations: [{ id: "x", target: "repairFund", amount: "600", note: "" }] },
    ])).toBe(600);
  });

  it("reserve suunamine ei mõjuta remondifondi", () => {
    expect(computeFondi([
      { summaInput: "1000", incomeAllocation: "targeted", incomeAllocations: [{ id: "x", target: "reserve", amount: "1000", note: "" }] },
    ])).toBe(0);
  });

  it("mitu rida summeritakse", () => {
    expect(computeFondi([
      { summaInput: "1000", incomeAllocation: "targeted", incomeAllocations: [{ id: "a", target: "repairFund", amount: "1000", note: "" }] },
      { summaInput: "500", incomeAllocation: "targeted", incomeAllocations: [{ id: "b", target: "repairFund", amount: "300", note: "" }] },
      { summaInput: "2000", incomeAllocation: "general", incomeAllocations: [] },
    ])).toBe(1300);
  });

  it("legacy incomeUse=fund → loe läbi normalizeIncomeAllocations", () => {
    expect(computeFondi([
      { summaInput: "1500", incomeUse: "fund", targetFund: "repairFund", fundDirectedAmount: "" },
    ])).toBe(1500);
  });
});

// ── 5. computeRemondifondiArvutus: fondiMuuTulu aritmeetika ──────────────────

describe("computeRemondifondiArvutus: Tab 2-st tuletatud fondiMuuTulu", () => {
  const BASE = {
    saldoAlgusRaw: "1000",
    koguPind: 300,
    periodiAasta: 2027,
    pangaKoef: 1.15,
    kogumisViis: "eraldi",
    pangaMaarOverride: null,
    maarOverride: 0.5,
    investments: [],
    loans: [],
    loanStatus: "APPLIED",
    monthEq: 12,
    costRows: [],
    rfUsageItems: [],
  };

  it("fondiMuuTulu 1200 suurendab saldoLopp 1200 võrra", () => {
    const r1 = computeRemondifondiArvutus({ ...BASE });
    const r2 = computeRemondifondiArvutus({ ...BASE, fondiMuuTulu: 1200 });
    expect(r2.saldoLopp).toBe(r1.saldoLopp + 1200);
  });

  it("fondiMuuTulu 0 → saldoLopp muutmata", () => {
    const r1 = computeRemondifondiArvutus({ ...BASE });
    const r2 = computeRemondifondiArvutus({ ...BASE, fondiMuuTulu: 0 });
    expect(r2.saldoLopp).toBe(r1.saldoLopp);
  });

  it("tühi suunatav summa (fondiMuuTulu = kogu rida) → saldoLopp sisaldab täit summat", () => {
    // Simuleerime: üks tulurida 800 €, suunatav summa tühi → fondiMuuTuluFromTab2 = 800
    const r = computeRemondifondiArvutus({ ...BASE, fondiMuuTulu: 800 });
    const base = computeRemondifondiArvutus({ ...BASE });
    expect(r.saldoLopp).toBe(base.saldoLopp + 800);
  });
});

// ── 6. Tab 3 UI: käsitsi sisend eemaldatud, readonly kuvatakse ───────────────

describe("Tab 3: Fondi suunatud muu tulu on readonly (mitte käsitsi sisend)", () => {
  let rfBlock;

  beforeAll(() => {
    const start = src.indexOf("{/* ── Pealkirja rida (ühtne teiste tabidega) ── */}");
    const end = src.indexOf(">Rahastamine</div>", start);
    rfBlock = start >= 0 && end > start ? src.slice(start, end) : "";
  });

  it("Tab 3-s ei ole EuroInput fondiMuuTulu jaoks", () => {
    // Otsime remondifond.fondiMuuTulu — see ei tohi enam Tab 3 renderduses olla
    expect(rfBlock).not.toContain("remondifond.fondiMuuTulu");
  });

  it("Tab 3 kuvab 'Fondi suunatud muu tulu' readonly reana", () => {
    expect(rfBlock).toContain("Fondi suunatud muu tulu");
  });

  it("Tab 3 'Fondi suunatud muu tulu' kasutab fondiMuuTuluFromTab2", () => {
    expect(rfBlock).toContain("fondiMuuTuluFromTab2");
  });

  it("Tab 3 info viitab Tab 2-le muutmiseks", () => {
    expect(rfBlock).toContain("Tab 2");
  });
});

// ── 7. Remondifondi lõppsaldo sisaldab Tab 2-st suunatud tulu ────────────────

describe("Lõppsaldo valem: Tab 2 suunatud tulu on sees", () => {
  it("remondifondiArvutus useMemo kasutab fondiMuuTuluFromTab2", () => {
    expect(src).toContain("fondiMuuTulu: fondiMuuTuluFromTab2");
  });

  it("fondiMuuTuluFromTab2 useMemo on failis", () => {
    expect(src).toContain("const fondiMuuTuluFromTab2 = useMemo");
  });

  it("fondiMuuTuluFromTab2 sõltub plan.budget.incomeRows-ist", () => {
    const memoStart = src.indexOf("const fondiMuuTuluFromTab2 = useMemo");
    const memoEnd = src.indexOf("}, [plan.budget.incomeRows]);", memoStart);
    expect(memoEnd).toBeGreaterThan(memoStart);
  });

  it("Remondifondi lõppsaldo valemis on '+ Fondi suunatud muu tulu' rida", () => {
    const pStart = src.indexOf("{/* ── Pealkirja rida");
    const rfBlock = src.slice(pStart, src.indexOf(">Rahastamine</div>", pStart));
    expect(rfBlock).toContain("+ Fondi suunatud muu tulu");
  });
});

// ── 8. Tab 2 tulu ei lähe topelt remondifondi ────────────────────────────────

describe("Tab 2 tulu ei lähe topelt remondifondi", () => {
  it("computeRemondifondiArvutus-il pole incomeRows parameetrit", () => {
    const fnStart = src.indexOf("export function computeRemondifondiArvutus");
    const fnEnd = src.indexOf("}) {", fnStart);
    const signature = src.slice(fnStart, fnEnd);
    expect(signature).not.toContain("incomeRows");
  });

  it("fondiMuuTuluFromTab2 arvutab summa täpselt ühe korra (pole kaksikarvestust)", () => {
    // incomeRows reduce arvestab iga rea ainult üks kord
    const memoStart = src.indexOf("const fondiMuuTuluFromTab2 = useMemo");
    const memoEnd = src.indexOf("}, [plan.budget.incomeRows]);", memoStart) + 50;
    const memoBody = src.slice(memoStart, memoEnd);
    expect(memoBody).toContain("incomeRows.reduce");
    expect(memoBody.match(/incomeRows\.reduce/g)?.length).toBe(1);
  });
});

// ── 9. Vana mitme-allokeeringuga rea ühilduvus ───────────────────────────────

describe("Vana mitme-allokeeringuga rea käsitlus uues UI-s", () => {
  it("summaInput sync ei kasuta length === 1 valvurit — ka mitme allokeeringuga read sünkroonitakse", () => {
    expect(incomeSection).not.toContain(".length === 1");
  });

  it("summaInput normaliseerimine on ainult onChange käsitlejas, mitte useEffect-is ega renderdamisel", () => {
    // Normaliseerimisloogika (incomeAllocations[0]) peab asuma onChange callback-is
    const normIdx = incomeSection.indexOf("incomeAllocations[0]");
    expect(normIdx).toBeGreaterThan(-1);
    // Lähim onChange enne normaliseerimist
    const nearestOnChange = incomeSection.lastIndexOf("onChange={(v) =>", normIdx);
    expect(nearestOnChange).toBeGreaterThan(-1);
    // Nende vahel ei tohi olla useEffect-i
    const between = incomeSection.slice(nearestOnChange, normIdx);
    expect(between).not.toContain("useEffect");
  });

  it("laadimise migratsioon (useEffect) ei normaliseeri ega muuda incomeAllocations andmeid", () => {
    // Migration useEffect kasutab ainult { ...r, category } spreadi — incomeAllocations peab puutumata jääma
    const migStart = src.indexOf("// Migreeri vanad tulukategooriad");
    const migEnd = src.indexOf("}, []);", migStart) + 8;
    const migBody = src.slice(migStart, migEnd);
    expect(migBody).not.toContain("incomeAllocations");
  });

  it("EuroInput useEffect ei kutsu välja ülemist onChange-t — renderdamisel normaliseerimist ei toimu", () => {
    // EuroInput-i sisemine useEffect tohib ainult setDisplay kutsuda, mitte onChange
    const euroStart = src.indexOf("function EuroInput(");
    const euroEnd = src.indexOf("\n}", euroStart) + 2;
    const euroBody = src.slice(euroStart, euroEnd);
    // Leia sisemine useEffect
    const effectStart = euroBody.indexOf("useEffect(");
    const effectEnd = euroBody.indexOf("}, [value", effectStart) + 20;
    const effectBody = euroBody.slice(effectStart, effectEnd);
    expect(effectBody).toContain("setDisplay");
    expect(effectBody).not.toContain("onChange");
  });

  it("fondiMuuTuluFromTab2 töötab korrektselt ka mitme allokeeringuga real (normalizeIncomeAllocations kaudu)", () => {
    // Mitme-allokeeringuga rida: repairFund 600 + general 400
    const result = normalizeIncomeAllocations({
      summaInput: "1000",
      incomeAllocation: "targeted",
      incomeAllocations: [
        { id: "a", target: "repairFund", amount: "600", note: "" },
        { id: "b", target: "general", amount: "400", note: "" },
      ],
    });
    const repairTotal = result.allocations
      .filter(a => a.target === "repairFund")
      .reduce((s, a) => s + Math.max(0, Math.round(parseFloat(a.amount) || 0)), 0);
    // Ainult repairFund osa (600) läheb remondifondi, mitte kogu summa
    expect(repairTotal).toBe(600);
    // Mõlemad allokeeringud on alles — andmeid ei normaliseerita
    expect(result.allocations).toHaveLength(2);
  });
});

// ── 10. Reservkapital jäi muutmata ───────────────────────────────────────────

describe("Reservkapital jäi muutmata", () => {
  it("Reservkapital plokk on eraldi kaardis", () => {
    expect(src).toContain(">Reservkapital</div>");
  });

  it("incomeRows reserve suunamine salvestub — andmemudel toetab", () => {
    expect(src).toContain('"reserve"');
    expect(src).toContain('a.target === "repairFund"');
  });

  it("Tab 3 Remondifond ignoreerib reserve-suunatud tulusid (pole rfBlokis)", () => {
    // fondiMuuTuluFromTab2 arvutuses filtreeritakse ainult repairFund sihtkoha järgi
    expect(src).toContain('a.target === "repairFund"');
  });
});
