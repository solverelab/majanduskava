// src/utils/rfOtsusloogika.test.js
// Lukustab Tab 3 Remondifondi ploki otsustusloogika:
// erandi ploki nähtavus, makse määra ühikud, soovituslik määr, soovitud saldo.

import { describe, it, expect, beforeAll } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";
import { mkRfUsageItem } from "../domain/planSchema";

let src;
let rfBlock;      // sec === 4 blokk lõpuni Reservkapitalini

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");

  // sec === 4 blokk: algab "Remondifond" kaardist, lõpeb Reservkapitali kaardiga
  const start = src.indexOf("{/* ── Pealkirja rida (ühtne teiste tabidega) ── */}");
  const end = src.indexOf(">Rahastamine</div>", start);
  rfBlock = start >= 0 && end > start ? src.slice(start, end) : "";
});

// ── 1. Jaotuse alus: erandi ploki nähtavus ───────────────────────────────────

describe("Jaotuse aluse erandi ploki nähtavus", () => {
  it("kaasomand ei kuva erandi plokki — isRfErand kaitseb nähtavuse eest", () => {
    // Erandi plokk on tingimuse { isRfErand && (...) } taga
    // isRfErand = rfSelectVal !== "kaasomand"
    expect(rfBlock).toContain("isRfErand");
    // kaasomand valikul isRfErand = false → plokk peidetud
    expect(rfBlock).toMatch(/isRfErand\s*&&/);
  });

  it("rfSelectVal 'kaasomand' korral isRfErand on false — loogika on koodis", () => {
    expect(rfBlock).toContain('rfSelectVal !== "kaasomand"');
  });

  it("korteri kohta (apartment) avab erandi ploki — isRfErand kehtib", () => {
    // apartment → rfSelectVal = "apartment" → isRfErand = true → erandi plokk nähtav
    // Kontrollime, et erandi plokk sõltub isRfErand-ist
    const erandStart = rfBlock.indexOf("isRfErand && (");
    expect(erandStart).toBeGreaterThan(-1);
    const erandBody = rfBlock.slice(erandStart, erandStart + 1000);
    expect(erandBody).toContain("Erandi alus");
    expect(erandBody).toContain('"legalBasisBylaws"');
    expect(erandBody).toContain('"legalBasisSpecialAgreement"');
    expect(erandBody).toContain('"legalBasisMuu"');
  });

  it("muu avab erandi ploki ja lisaks Jaotuse kirjelduse välja", () => {
    // rfSelectVal === "muu" → isRfErand = true + jaotuse kirjeldus
    expect(rfBlock).toContain('rfSelectVal === "muu"');
    expect(rfBlock).toContain("Jaotuse kirjeldus");
  });

  it("kaasomand valides puhastatakse erandi väljad", () => {
    // Kui select → kaasomand, siis patchRfPolicy puhastab kõik erandväljad
    // Ankur: patchRfPolicy({ defaultBasis: "kaasomand" ... })
    const anchor = rfBlock.indexOf('patchRfPolicy({ defaultBasis: "kaasomand"');
    expect(anchor).toBeGreaterThan(-1);
    const kaasomandBranch = rfBlock.slice(anchor, anchor + 400);
    expect(kaasomandBranch).toContain("legalBasisBylaws: false");
    expect(kaasomandBranch).toContain("legalBasisSpecialAgreement: false");
    expect(kaasomandBranch).toContain("legalBasisMuu: false");
  });
});

// ── 2. Makse määra ühik muutub jaotuse aluse järgi ───────────────────────────

describe("Makse määra ühik sõltub jaotuse alusest", () => {
  it("kaasomand-blokis on label 'Remondifondi makse määr' (ilma ühikuta)", () => {
    // Ankur: JSX renderdamise plokk, mitte soovituslik arvutus
    const renderStart = rfBlock.indexOf('{rfSelectVal === "kaasomand" && (');
    const renderEnd = rfBlock.indexOf('{rfSelectVal === "apartment" && (');
    const kaasomandBlock = renderStart >= 0 && renderEnd > renderStart
      ? rfBlock.slice(renderStart, renderEnd) : "";
    expect(kaasomandBlock).toContain("Remondifondi makse määr");
    expect(kaasomandBlock).not.toMatch(/label.*€\/m²\/kuu|€\/m²\/kuu.*label/);
  });

  it("kaasomand-blokis on €/m²/kuu ainult readonly abikuvana 'Arvutuslik määr:'", () => {
    const renderStart = rfBlock.indexOf('{rfSelectVal === "kaasomand" && (');
    const renderEnd = rfBlock.indexOf('{rfSelectVal === "apartment" && (');
    const kaasomandBlock = renderStart >= 0 && renderEnd > renderStart
      ? rfBlock.slice(renderStart, renderEnd) : "";
    expect(kaasomandBlock).toContain("Arvutuslik määr:");
    expect(kaasomandBlock).toContain("€/m²/kuu");
  });

  it("apartment-blokis on label 'Remondifondi makse määr (€/korter/kuu)'", () => {
    // apartment renderblokk tuleb kaasomand-bloki järel; muu-blokk tuleb apartment-bloki järel
    const aptStart = rfBlock.indexOf('{rfSelectVal === "apartment" && (');
    const muuStart = rfBlock.lastIndexOf('{rfSelectVal === "muu" && (');
    const aptBlock = aptStart >= 0 && muuStart > aptStart ? rfBlock.slice(aptStart, muuStart) : "";
    expect(aptBlock).toContain("Remondifondi makse määr (€/korter/kuu)");
  });

  it("muu-blokis on label 'Planeeritud kogumine perioodis'", () => {
    const muuBlock = rfBlock.slice(
      rfBlock.lastIndexOf('{rfSelectVal === "muu" && ('),
      rfBlock.indexOf("Fondist rahastatavad tööd")
    );
    expect(muuBlock).toContain("Planeeritud kogumine perioodis");
  });
});

// ── 3. Korteri kohta arvutab laekumise õigesti ────────────────────────────────

describe("Korteri kohta: laekuminePerioodis = määr × aptCount × mEq", () => {
  const BASE = {
    saldoAlgusRaw: "0",
    koguPind: 500,
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
    rfUsageItems: [],
  };

  it("5 korterit × 20 €/kuu × 12 kuud = 1200 €", () => {
    const total = Math.round(20 * 5 * 12);
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: total });
    expect(r.laekuminePerioodis).toBe(1200);
  });

  it("muu: planeeritudKogumine 4500 → laekuminePerioodis 4500", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 4500 });
    expect(r.laekuminePerioodis).toBe(4500);
  });
});

// ── 4. Fondi suunatud muu tulu suurendab lõppsaldot ──────────────────────────

describe("Fondi suunatud muu tulu", () => {
  const BASE = {
    saldoAlgusRaw: "2000",
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

  it("fondiMuuTulu 600 tõstab saldoLopp 600 võrra", () => {
    const r1 = computeRemondifondiArvutus({ ...BASE });
    const r2 = computeRemondifondiArvutus({ ...BASE, fondiMuuTulu: 600 });
    expect(r2.saldoLopp).toBe(r1.saldoLopp + 600);
  });

  it("Tab 2 incomeRows ei ole computeRemondifondiArvutus sisendis", () => {
    // Funktsioonil pole incomeRows parameetrit — Tab 2 tulud ei lähe automaatselt RF-i
    const r = computeRemondifondiArvutus({ ...BASE });
    expect(r.laekuminePerioodis).toBe(Math.round(0.5 * 300 * 12));
  });
});

// ── 5. Tab 1 töö maksumus ei lähe automaatselt RF kasutusse ──────────────────

describe("Tab 1 eeldatav maksumus ei muutu automaatselt RF kasutusse", () => {
  const BASE = {
    saldoAlgusRaw: "0",
    koguPind: 200,
    periodiAasta: 2027,
    pangaKoef: 1.15,
    kogumisViis: "eraldi",
    pangaMaarOverride: null,
    maarOverride: 0.3,
    investments: [],
    loans: [],
    loanStatus: "APPLIED",
    monthEq: 12,
    costRows: [],
    rfUsageItems: [],
  };

  it("rfUsageItems ilma remondifondistKaetavSumma'ta → rfUsageRemondifondist = 0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [mkRfUsageItem({ linkedAssetConditionId: "abc", remondifondistKaetavSumma: "" })],
    });
    expect(r.rfUsageRemondifondist).toBe(0);
  });

  it("märgitud töö RF summa 800 vähendab saldoLopp 800 võrra", () => {
    const rIlma = computeRemondifondiArvutus({ ...BASE });
    const rKoos = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [mkRfUsageItem({ linkedAssetConditionId: "abc", remondifondistKaetavSumma: "800" })],
    });
    expect(rKoos.saldoLopp).toBe(rIlma.saldoLopp - 800);
  });
});

// ── 6. Soovitud saldo ja puudujääk/ülejääk ───────────────────────────────────

describe("Soovitud saldo: puudujääk ja ülejääk UI-s", () => {
  it("'Soovitud minimaalne lõppsaldo perioodi lõpus' label on ilma '(valikuline)' täienditaeta", () => {
    expect(rfBlock).toContain("Soovitud minimaalne lõppsaldo perioodi lõpus");
    const soovitudIdx = rfBlock.indexOf("Soovitud minimaalne lõppsaldo perioodi lõpus");
    const soovitudContext = rfBlock.slice(soovitudIdx, soovitudIdx + 200);
    expect(soovitudContext).not.toContain("valikuline");
  });

  it("UI kuvab 'Puudujääk soovitud saldoni' teksti kui diff < 0", () => {
    expect(rfBlock).toContain("Puudujääk soovitud saldoni");
  });

  it("UI kuvab 'Ülejääk soovitud saldost' teksti kui diff >= 0", () => {
    expect(rfBlock).toContain("Ülejääk soovitud saldost");
  });

  it("diff arvutatakse ra.saldoLopp - soovitudSaldo alusel", () => {
    expect(rfBlock).toContain("ra.saldoLopp - soovitudSaldo");
  });
});

// ── 7. Soovituslik uus makse määr ────────────────────────────────────────────

describe("Soovituslik uus makse määr", () => {
  it("'Soovituslik uus makse määr' tekst on kokkuvõtte sektsioonis", () => {
    // Kasutame rfBlock asemel rfBlock'i laiema aknaga — soovituslik on valemi järel
    const summaryStart = rfBlock.lastIndexOf("Prognoositav remondifondi saldo perioodi lõpus");
    const summaryBody = rfBlock.slice(summaryStart, summaryStart + 3000);
    expect(summaryBody).toContain("Soovituslik uus makse määr");
  });

  it("soovituslik määr arvutatakse ainult kui hasSoovitud && diff < 0", () => {
    // Koodis peab olema tingimus: diff < 0
    expect(rfBlock).toContain("diff < 0");
    // Ja soovituslikMaar !== null tingimus kuvamiseks
    expect(rfBlock).toContain("soovituslikMaar !== null");
  });

  it("soovituslik määr ei kirjuta maarOverride üle — setRemondifond puudub soovitusliku arvutuse plokis", () => {
    // soovituslikMaar arvutus on puhtalt lokaalne muutuja, mitte setState väljakutse
    const soovituslikIdx = rfBlock.indexOf("soovituslikMaar = neededLaekumine");
    expect(soovituslikIdx).toBeGreaterThan(-1);
    const calcBlock = rfBlock.slice(Math.max(0, soovituslikIdx - 200), soovituslikIdx + 500);
    expect(calcBlock).not.toContain("setRemondifond");
    expect(calcBlock).not.toContain("maarOverride:");
  });

  it("soovituslik määr for kaasomand: neededLaekumine / (koguPind × mEq)", () => {
    expect(rfBlock).toContain("neededLaekumine / (koguPind * mEq)");
  });

  it("soovituslik määr for apartment: neededLaekumine / (aptCount × mEq)", () => {
    expect(rfBlock).toContain("neededLaekumine / (aptCount * mEq)");
  });

  it("soovituslik määra arvutus: neededLaekumine = soovitudSaldo − saldoAlgus − fondiMuuTulu + kaetavad", () => {
    expect(rfBlock).toContain("soovitudSaldo - ra.saldoAlgus - ra.fondiMuuTulu + ra.remondifondistKaetavadKokku");
  });

  it("soovituslik määr kuvatakse monospace fondiga, mitte kasutaja sisendväljas", () => {
    const soovituslikMaarIdx = rfBlock.lastIndexOf("Soovituslik uus makse määr");
    const displayCtx = rfBlock.slice(Math.max(0, soovituslikMaarIdx - 100), soovituslikMaarIdx + 200);
    // Kuvatakse tekstina (div/span), mitte input-ina
    expect(displayCtx).not.toContain("<input");
    expect(displayCtx).toContain("monospace");
  });
});

// ── 8. Nähtav valem (formula rows) ───────────────────────────────────────────

describe("Nähtav valem: kõik read on kokkuvõttes olemas", () => {
  it("algussaldo rida on valemis", () => {
    expect(rfBlock).toContain("Remondifondi saldo perioodi alguses");
  });

  it("+ Perioodis koguneb rida on valemis", () => {
    expect(rfBlock).toContain("+ Perioodis koguneb");
  });

  it("+ Fondi suunatud muu tulu rida on valemis", () => {
    expect(rfBlock).toContain("+ Fondi suunatud muu tulu");
  });

  it("− Remondifondist kaetavad summad read on valemis", () => {
    expect(rfBlock).toMatch(/−.*[Rr]emondifondist|−.*RF-st/);
  });

  it("= Prognoositav lõppsaldo rida on valemis", () => {
    expect(rfBlock).toContain("= Prognoositav remondifondi saldo perioodi lõpus");
  });
});

// ── 9. computePlan ja Reservkapital jäid muutmata ────────────────────────────

describe("computePlan deterministlik, Reservkapital muutmata", () => {
  it("computePlan on deterministlik", async () => {
    const { computePlan } = await import("../engine/computePlan");
    const plan = {
      period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 100 }] },
      budget: { costRows: [], incomeRows: [] },
      investments: { items: [] },
      funds: { repairFund: { monthlyRateEurPerM2: 0.5 }, reserve: { plannedEUR: 0 } },
      loans: [],
      openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
      allocationPolicies: {},
    };
    const r1 = computePlan(plan);
    const r2 = computePlan(plan);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("Reservkapitali blokk on eraldi kaardis — 'Reservkapital' heading on failis", () => {
    expect(src).toContain(">Reservkapital</div>");
  });

  it("Reservkapitali arvutus ei kasuta remondifond state'i muutujaid", () => {
    const rkStart = src.indexOf("Reservkapital</div>");
    const rkBody = src.slice(rkStart, rkStart + 2000);
    expect(rkBody).not.toContain("remondifond.saldoAlgus");
    expect(rkBody).not.toContain("remondifondiArvutus");
  });
});
