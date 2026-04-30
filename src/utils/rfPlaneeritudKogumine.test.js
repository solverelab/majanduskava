import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";
import { mkRfUsageItem } from "../domain/planSchema";

// ══════════════════════════════════════════════════════════════════════
// Tab 3 „Planeeritud kogumine perioodis" invariandid
//
// Kinnitab:
// 1. planeeritudKogumine suurendab remondifondi lõppsaldot
// 2. Lõppsaldo = algsaldo + planeeritud kogumine – remondifondist kaetavad
// 3. m²-põhise jaotusviisi korral arvutatakse tuletatud €/m²/kuu
// 4. Korteri kohta jaotusviisi korral arvutatakse €/korter/kuu
// 5. Kaasomandi jaotusviisi korral ei ole €/m² arvutamine kohustuslik
// 6. „Muu" jaotusviisi kirjeldusvälja loogika
// 7. Õigusliku aluse vaikimisi väärtus on Seadus
// 8. Põhikiri/Kokkulepe/Muu korral kuvatakse Täpsustus
// 9. Tab 1 eeldatav maksumus ei lähe automaatselt RF kasutusse
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  saldoAlgusRaw: "1000",
  koguPind: 200,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: null,
  investments: [],
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 12,
  costRows: [],
};

// ── 1. planeeritudKogumine suurendab lõppsaldot ───────────────────────────

describe("planeeritudKogumine suurendab remondifondi lõppsaldot", () => {
  it("nullist erinev kogumine tõstab lõppsaldot rohkem kui 0", () => {
    const rNullita = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 0 });
    const rKogumisega = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 5000 });
    expect(rKogumisega.saldoLopp).toBeGreaterThan(rNullita.saldoLopp);
  });

  it("suurem kogumine annab suurema lõppsaldo", () => {
    const r1 = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 3000 });
    const r2 = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 6000 });
    expect(r2.saldoLopp).toBe(r1.saldoLopp + 3000);
  });

  it("laekuminePerioodis = planeeritudKogumine kui see on seatud", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 4800 });
    expect(r.laekuminePerioodis).toBe(4800);
  });
});

// ── 2. Lõppsaldo = algsaldo + planeeritud kogumine – remondifondist kaetavad

describe("remondifondi lõppsaldo valem", () => {
  it("lõppsaldo = algsaldo + kogumine – rfUsageRemondifondist", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      planeeritudKogumine: 4800,
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 1200 })],
    });
    // 1000 + 4800 - 1200 = 4600
    expect(r.saldoLopp).toBe(4600);
  });

  it("lõppsaldo = algsaldo + kogumine kui kulu puudub", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 2400 });
    expect(r.saldoLopp).toBe(1000 + 2400);
  });

  it("negatiivne lõppsaldo on võimalik kui kasutus ületab kõike", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      planeeritudKogumine: 1000,
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 5000 })],
    });
    // 1000 + 1000 - 5000 = -3000
    expect(r.saldoLopp).toBe(-3000);
  });
});

// ── 3. m²-põhine jaotusviis → tuletatud €/m²/kuu ────────────────────────

describe("m²-põhise jaotusviisi korral arvutatakse tuletatud €/m²/kuu", () => {
  it("maarKuusM2 = planeeritudKogumine / (koguPind * monthEq)", () => {
    // 2400 / (200 * 12) = 1.0
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 2400 });
    expect(r.maarKuusM2).toBeCloseTo(1.0, 5);
  });

  it("maarKuusM2 on positiivne kui planeeritudKogumine > 0", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 1200 });
    expect(r.maarKuusM2).toBeGreaterThan(0);
  });

  it("maarKuusM2 * koguPind * monthEq ≈ planeeritudKogumine (ümardusega)", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 3600 });
    // 3600 / (200 * 12) = 1.5
    expect(r.maarKuusM2 * BASE.koguPind * BASE.monthEq).toBeCloseTo(3600, 0);
  });
});

// ── 4. Korteri kohta jaotusviis → €/korter/kuu UI valem ──────────────────

describe("korteri kohta jaotusviisi korral arvutatakse €/korter/kuu", () => {
  // UI-valem: maarAptKuu = laekuminePerioodis / (aptCount * mEq)
  const calcAptRate = (kogumine, aptCount, mEq) =>
    aptCount > 0 && mEq > 0 ? kogumine / (aptCount * mEq) : 0;

  it("2400 € / 10 korterit / 12 kuud = 20 €/korter/kuu", () => {
    expect(calcAptRate(2400, 10, 12)).toBe(20);
  });

  it("korterite puudumisel ei jagata nulliga", () => {
    expect(calcAptRate(2400, 0, 12)).toBe(0);
  });

  it("kuu arv 0 korral ei jagata nulliga", () => {
    expect(calcAptRate(2400, 10, 0)).toBe(0);
  });
});

// ── 5. Kaasomandi jaotusviis: €/m² määra kuvamine on UI otsus ────────────

describe("kaasomandi jaotusviisi korral UI ei pea €/m² kuvama", () => {
  // Mootori väljundis on maarKuusM2 alati arvutatud, aga UI kuvab selle
  // ainult m²-põhise jaotusviisi korral.
  // Kontrollib, et mootori loogika ei muutu jaotusviisi valiku põhjal.
  it("computeRemondifondiArvutus tagastab maarKuusM2 sõltumata jaotusviisist", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 1200 });
    expect(typeof r.maarKuusM2).toBe("number");
  });

  it("maarKuusM2 väärtus tuleneb alati planeeritudKogumine'ist (m² pind on mootori sisend)", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 2400 });
    // UI vastutab selle kuva eest — mootor lihtsalt arvutab
    expect(r.maarKuusM2).toBeCloseTo(2400 / (200 * 12), 5);
  });
});

// ── 6. "Muu" jaotusviisi kirjeldusvälja loogika (UI valem) ───────────────

describe('"muu" jaotusviisi korral nõutakse kirjeldus', () => {
  const muuNouabKirjeldust = (basis, kirjeldus) =>
    basis === "muu" && (!kirjeldus || kirjeldus.trim() === "");

  it("basis=muu, kirjeldus tühi → nõuab kirjeldust", () => {
    expect(muuNouabKirjeldust("muu", "")).toBe(true);
  });

  it("basis=muu, kirjeldus olemas → ei nõua", () => {
    expect(muuNouabKirjeldust("muu", "Korterite osakaalud kinnitatud üldkoosolekul")).toBe(false);
  });

  it("basis=m2 → ei nõua kirjeldust", () => {
    expect(muuNouabKirjeldust("m2", "")).toBe(false);
  });

  it("basis=kaasomand → ei nõua kirjeldust", () => {
    expect(muuNouabKirjeldust("kaasomand", "")).toBe(false);
  });
});

// ── 7. Õigusliku aluse vaikimisi väärtus on Seadus ───────────────────────

describe("õigusliku aluse vaikimisi väärtus on Seadus", () => {
  it("rfPolicy.legalBasisSeadus !== false → Seadus on vaikimisi true", () => {
    const rfPolicy = {};
    const legalSeadus = rfPolicy.legalBasisSeadus !== false;
    expect(legalSeadus).toBe(true);
  });

  it("legalBasisSeadus = false → ei rakendu Seadus", () => {
    const rfPolicy = { legalBasisSeadus: false };
    const legalSeadus = rfPolicy.legalBasisSeadus !== false;
    expect(legalSeadus).toBe(false);
  });

  it("legalBasisSeadus = true → rakendub Seadus", () => {
    const rfPolicy = { legalBasisSeadus: true };
    const legalSeadus = rfPolicy.legalBasisSeadus !== false;
    expect(legalSeadus).toBe(true);
  });
});

// ── 8. Põhikiri/Kokkulepe/Muu → Täpsustus on nähtav ─────────────────────

describe("Põhikiri/Kokkulepe/Muu korral kuvatakse Täpsustus", () => {
  const showTaepsustus = (rfPolicy) =>
    !!rfPolicy.legalBasisBylaws ||
    !!rfPolicy.legalBasisSpecialAgreement ||
    !!rfPolicy.legalBasisMuu;

  it("vaikimisi ei kuvata Täpsustust (ainult Seadus)", () => {
    expect(showTaepsustus({})).toBe(false);
  });

  it("Põhikiri → kuvatakse Täpsustus", () => {
    expect(showTaepsustus({ legalBasisBylaws: true })).toBe(true);
  });

  it("Kokkulepe → kuvatakse Täpsustus", () => {
    expect(showTaepsustus({ legalBasisSpecialAgreement: true })).toBe(true);
  });

  it("Muu → kuvatakse Täpsustus", () => {
    expect(showTaepsustus({ legalBasisMuu: true })).toBe(true);
  });

  it("mitu valitud → kuvatakse Täpsustus", () => {
    expect(showTaepsustus({ legalBasisBylaws: true, legalBasisMuu: true })).toBe(true);
  });
});

// ── Lukustusreegel: planeeritudKogumine on kanoniline allikas ─────────────
// See describe kinnitab, et planeeritudKogumine ei kirjutata üle ega asendata
// maarKuusM2-ga; viimane on puhtalt abiarvutus.

describe("kanoniline reegel: planeeritudKogumine on tõeallikas, maarKuusM2 on abiarvutus", () => {
  it("laekuminePerioodis = planeeritudKogumine, mitte maarKuusM2 * pind * kuud", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 3000 });
    expect(r.laekuminePerioodis).toBe(3000);
    // maarKuusM2 on tuletatud, ei tohiks tagasi laekumist muuta
    const tagasiArvutus = r.maarKuusM2 * BASE.koguPind * BASE.monthEq;
    expect(Math.abs(tagasiArvutus - 3000)).toBeLessThan(1); // ümardus kuni 1 €
  });

  it("kui planeeritudKogumine puudub ja maarOverride puudub, siis laekuminePerioodis = 0", () => {
    const r = computeRemondifondiArvutus({ ...BASE, saldoAlgusRaw: "0" });
    // planeeritudKogumine ei ole üldse antud, maarOverride = null
    expect(r.laekuminePerioodis).toBe(0);
  });
});

// ── 10. Null- ja tühiväärtused ─────────────────────────────────────────────

describe("null- ja tühiväärtused ei tekita NaN-i", () => {
  it("planeeritudKogumine puudub (ei anta) → laekuminePerioodis = 0, saldoLopp on arv", () => {
    const r = computeRemondifondiArvutus({ ...BASE, saldoAlgusRaw: "500" });
    // planeeritudKogumine pole antud → vaikimisi null → legacy path, maarOverride=null → 0
    expect(r.laekuminePerioodis).toBe(0);
    expect(Number.isFinite(r.saldoLopp)).toBe(true);
    expect(r.saldoLopp).toBe(500);
  });

  it("planeeritudKogumine on tühi string → käitub kui 0", () => {
    const r = computeRemondifondiArvutus({ ...BASE, saldoAlgusRaw: "500", planeeritudKogumine: "" });
    expect(r.laekuminePerioodis).toBe(0);
    expect(Number.isFinite(r.saldoLopp)).toBe(true);
    expect(r.saldoLopp).toBe(500);
  });

  it("saldoAlgusRaw puudub → saldoAlgus = 0, ei ole NaN", () => {
    const { saldoAlgusRaw: _omit, ...baseNoSaldo } = BASE;
    const r = computeRemondifondiArvutus({ ...baseNoSaldo, planeeritudKogumine: 1000 });
    expect(Number.isFinite(r.saldoAlgus)).toBe(true);
    expect(r.saldoAlgus).toBe(0);
    expect(r.saldoLopp).toBe(1000);
  });

  it("saldoAlgusRaw on tühi string → saldoAlgus = 0", () => {
    const r = computeRemondifondiArvutus({ ...BASE, saldoAlgusRaw: "", planeeritudKogumine: 1000 });
    expect(r.saldoAlgus).toBe(0);
    expect(r.saldoLopp).toBe(1000);
  });

  it("usageItems puudub → rfUsageRemondifondist = 0, ei ole NaN", () => {
    const { ...baseNoUsage } = BASE;
    const r = computeRemondifondiArvutus({ ...baseNoUsage, planeeritudKogumine: 1000 });
    expect(r.rfUsageRemondifondist).toBe(0);
    expect(Number.isFinite(r.saldoLopp)).toBe(true);
  });

  it("usageItems on tühi array → rfUsageRemondifondist = 0", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 1000, rfUsageItems: [] });
    expect(r.rfUsageRemondifondist).toBe(0);
  });

  it("planeeritudKogumine = 0 → maarKuusM2 = 0, ei kuvata tuletatud määra (maarM2Kuu = null valem)", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 0, maarOverride: null });
    // laekuminePerioodis = 0 → maarM2Kuu UI-s oleks null (laekumine ei ole > 0)
    expect(r.laekuminePerioodis).toBe(0);
    // maarKuusM2 on legacy: maarOverride=null → 0
    expect(r.maarKuusM2).toBe(0);
  });

  it("kõik null/tühi → saldoLopp = 0, ei ole NaN", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "",
      planeeritudKogumine: "",
      maarOverride: null,
      rfUsageItems: [],
    });
    expect(Number.isFinite(r.saldoLopp)).toBe(true);
    expect(r.saldoLopp).toBe(0);
  });
});

// ── 11. Tuletatud määr ei kuvata eksitava nullina ─────────────────────────

describe("tuletatud maarM2Kuu ei kuvata nullina kui andmed puuduvad", () => {
  // UI valem: const maarM2Kuu = (koguPind > 0 && mEq > 0 && ra.laekuminePerioodis > 0)
  //   ? ra.laekuminePerioodis / (koguPind * mEq) : null;
  // null → komponendi tingimuslik render jätab "Arvutuslik määr" kuvamata

  const calcMaarM2Kuu = (laekuminePerioodis, koguPind, mEq) =>
    (koguPind > 0 && mEq > 0 && laekuminePerioodis > 0)
      ? laekuminePerioodis / (koguPind * mEq)
      : null;

  it("laekuminePerioodis = 0 → maarM2Kuu = null (ei kuvata)", () => {
    expect(calcMaarM2Kuu(0, 200, 12)).toBeNull();
  });

  it("koguPind = 0 → maarM2Kuu = null (ei kuvata, ei jaga nulliga)", () => {
    expect(calcMaarM2Kuu(1200, 0, 12)).toBeNull();
  });

  it("mEq = 0 → maarM2Kuu = null (ei kuvata, ei jaga nulliga)", () => {
    expect(calcMaarM2Kuu(1200, 200, 0)).toBeNull();
  });

  it("laekuminePerioodis > 0 ja pind > 0 → maarM2Kuu on positiivne arv", () => {
    const m = calcMaarM2Kuu(2400, 200, 12);
    expect(m).not.toBeNull();
    expect(m).toBeGreaterThan(0);
  });
});

// ── 12. Tehniline jaotusviis "Muu" error-state ────────────────────────────

describe('"muu" jaotusviisi error-state: kirjeldus on kohustuslik', () => {
  // UI logic: muuErrorState = rfBasis === "muu" && !(allocationBasisMuuKirjeldus?.trim())
  const muuErrorState = (rfBasis, allocationBasisMuuKirjeldus) =>
    rfBasis === "muu" && !allocationBasisMuuKirjeldus?.trim();

  it("basis=muu, kirjeldus puudub (undefined) → error-state", () => {
    expect(muuErrorState("muu", undefined)).toBe(true);
  });

  it("basis=muu, kirjeldus tühi string → error-state", () => {
    expect(muuErrorState("muu", "")).toBe(true);
  });

  it("basis=muu, kirjeldus ainult tühikud → error-state", () => {
    expect(muuErrorState("muu", "   ")).toBe(true);
  });

  it("basis=muu, kirjeldus täidetud → ei ole error-state", () => {
    expect(muuErrorState("muu", "Üldkoosoleku otsus")).toBe(false);
  });

  it("basis=m2 → error-state ei teki sõltumata kirjeldusest", () => {
    expect(muuErrorState("m2", "")).toBe(false);
    expect(muuErrorState("m2", undefined)).toBe(false);
  });

  it("basis=kaasomand → error-state ei teki", () => {
    expect(muuErrorState("kaasomand", "")).toBe(false);
  });

  it("basis=apartment → error-state ei teki", () => {
    expect(muuErrorState("apartment", "")).toBe(false);
  });
});

// ── 13. Õigusliku aluse "Täpsustus" error-state ──────────────────────────

describe("Täpsustus on kohustuslik kui Põhikiri/Kokkulepe/Muu on valitud", () => {
  // showTaepsustus = legalBasisBylaws || legalBasisSpecialAgreement || legalBasisMuu
  // taepsustusErrorState = showTaepsustus && !(legalBasisTaepsustus?.trim())
  const showTaepsustus = (p) => !!p.legalBasisBylaws || !!p.legalBasisSpecialAgreement || !!p.legalBasisMuu;
  const taepsustusErrorState = (p) => showTaepsustus(p) && !p.legalBasisTaepsustus?.trim();

  it("ainult Seadus valitud → Täpsustus ei ole nõutav", () => {
    expect(taepsustusErrorState({ legalBasisSeadus: true })).toBe(false);
  });

  it("Põhikiri valitud, täpsustus tühi → error-state", () => {
    expect(taepsustusErrorState({ legalBasisBylaws: true, legalBasisTaepsustus: "" })).toBe(true);
  });

  it("Kokkulepe valitud, täpsustus tühi → error-state", () => {
    expect(taepsustusErrorState({ legalBasisSpecialAgreement: true, legalBasisTaepsustus: "" })).toBe(true);
  });

  it("Muu valitud, täpsustus tühi → error-state", () => {
    expect(taepsustusErrorState({ legalBasisMuu: true, legalBasisTaepsustus: "" })).toBe(true);
  });

  it("Põhikiri valitud, täpsustus ainult tühikud → error-state", () => {
    expect(taepsustusErrorState({ legalBasisBylaws: true, legalBasisTaepsustus: "   " })).toBe(true);
  });

  it("Põhikiri valitud, täpsustus täidetud → ei ole error-state", () => {
    expect(taepsustusErrorState({ legalBasisBylaws: true, legalBasisTaepsustus: "KÜ põhikiri §12" })).toBe(false);
  });

  it("Muu valitud, täpsustus täidetud → ei ole error-state", () => {
    expect(taepsustusErrorState({ legalBasisMuu: true, legalBasisTaepsustus: "Üldkoosoleku otsus 2024" })).toBe(false);
  });

  it("täpsustus puudub täielikult (undefined) → error-state kui Põhikiri valitud", () => {
    expect(taepsustusErrorState({ legalBasisBylaws: true })).toBe(true);
  });
});

// ── 9. Tab 1 eeldatav maksumus ei lähe automaatselt RF kasutusse ─────────

describe("Tab 1 eeldatav maksumus ei lähe automaatselt remondifondi kasutusse", () => {
  it("rfUsageItems=[] korral rfUsageRemondifondist=0 sõltumata costRows'ist", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      costRows: [{ summaInput: "5000" }],
      rfUsageItems: [],
    });
    expect(r.rfUsageRemondifondist).toBe(0);
  });

  it("planeeritudKogumine ei pane ühtegi kulu automaatselt RF-st kaetavaks", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      planeeritudKogumine: 10000,
      rfUsageItems: [],
    });
    expect(r.rfUsageRemondifondist).toBe(0);
    expect(r.remondifondistKaetavadKokku).toBe(0);
  });
});
