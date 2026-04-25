import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// RF perioodi piiri invariandid
//
// periodStartYear = periodiAasta
// periodEndYear   = periodiAasta + periodLength - 1  (periodLength = monthEq/12)
// nextPeriodStart = periodEndYear + 1
// nextPeriodEnd   = periodEndYear + periodLength
//
// investRemondifondist : periodStart <= plannedYear <= periodEnd
// nextPeriodRfVajadus  : nextPeriodStart <= plannedYear <= nextPeriodEnd
// invDetail            : kõik RF-investeeringud (sõltumata perioodist)
// maarKuusM2           : maarOverride ?? 0  (auto-tuletust pole)
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  saldoAlgusRaw: "0",
  koguPind: 100,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: null,
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 12, // 1-aastane periood → periodEnd:2027, nextEnd:2028
};

function mkInv(plannedYear, rfAmount) {
  return {
    id: String(plannedYear), name: `Töö-${plannedYear}`,
    plannedYear,
    totalCostEUR: rfAmount,
    fundingPlan: [{ source: "Remondifond", amountEUR: rfAmount }],
  };
}

// ── 1. Tööde maksumus ei muuda remondifondi makset ────────────────────

describe("tööde maksumus ei muuda remondifondi makset", () => {
  it("maarKuusM2 ei muutu investeeringute lisamise tõttu", () => {
    const r0 = computeRemondifondiArvutus({ ...BASE, investments: [] });
    const r1 = computeRemondifondiArvutus({ ...BASE, investments: [mkInv(2027, 10000)] });
    const r2 = computeRemondifondiArvutus({ ...BASE, investments: [mkInv(2027, 50000), mkInv(2028, 30000)] });

    // Kõigil sama maarKuusM2, sest auto-tuletust pole
    expect(r0.maarKuusM2).toBe(r1.maarKuusM2);
    expect(r1.maarKuusM2).toBe(r2.maarKuusM2);
    expect(r0.maarKuusM2).toBe(0);
  });
});

// ── 2. Käesoleva perioodi RF töö vähendab lõppsaldot ─────────────────

describe("käesoleva perioodi RF töö vähendab lõppsaldot", () => {
  it("2027 investeering (periodEndYear=2027) läheb investRemondifondist hulka", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [mkInv(2027, 15000)],
    });
    expect(r.investRemondifondist).toBe(15000);
    expect(r.saldoLopp).toBe(-15000); // saldoAlgus=0, laekumine=0
  });

  it("saldo väheneb investeeringu võrra", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "20000",
      investments: [mkInv(2027, 15000)],
    });
    expect(r.saldoLopp).toBe(5000); // 20000 - 15000
    expect(r.investRemondifondist).toBe(15000);
  });
});

// ── 3. Enne perioodi olev töö ei vähenda lõppsaldot ──────────────────

describe("enne perioodi olev töö ei vähenda käesoleva perioodi lõppsaldot", () => {
  it("2026 investeering (< periodStartYear:2027) ei lähe investRemondifondist hulka", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [mkInv(2026, 10000)],
    });
    expect(r.investRemondifondist).toBe(0);
    expect(r.saldoLopp).toBe(0); // saldoAlgus=0, laekumine=0, investRemondifondist=0
  });
});

// ── 4. Järgmise perioodi RF töö ei vähenda käesoleva saldot ──────────

describe("järgmise perioodi RF töö ei vähenda käesoleva perioodi lõppsaldot", () => {
  it("2028 investeering (nextPeriodStart:2028) ei lähe investRemondifondist hulka", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [mkInv(2028, 20000)],
    });
    expect(r.investRemondifondist).toBe(0);
    expect(r.saldoLopp).toBe(0);
  });
});

// ── 5. Järgmise perioodi RF töö läheb katvuskontrolli ────────────────

describe("järgmise perioodi RF töö läheb katvuskontrolli", () => {
  it("2028 investeering (nextPeriod:[2028,2028]) → nextPeriodRfVajadus", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [mkInv(2028, 20000)],
    });
    expect(r.nextPeriodRfVajadus).toBe(20000);
  });

  it("mitme-aastase perioodi järgmine periood on sama pikk", () => {
    // periodiAasta:2027, monthEq:60 → period:[2027,2031], next:[2032,2036]
    const r = computeRemondifondiArvutus({
      ...BASE,
      monthEq: 60,
      investments: [
        mkInv(2031, 5000),  // praegune periood
        mkInv(2032, 8000),  // järgmine periood algus
        mkInv(2036, 3000),  // järgmine periood lõpp
      ],
    });
    expect(r.investRemondifondist).toBe(5000);
    expect(r.nextPeriodRfVajadus).toBe(11000); // 8000+3000
  });
});

// ── 6. Hilisem kui järgmine periood ei lähe katvuskontrolli ──────────

describe("hilisem kui järgmine periood RF töö ei lähe katvuskontrolli", () => {
  it("2029 investeering (> nextPeriodEnd:2028) ei lähe nextPeriodRfVajadus hulka", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [mkInv(2029, 30000)],
    });
    expect(r.nextPeriodRfVajadus).toBe(0);
    // aga investeering kajastub invDetail-s
    expect(r.invDetail.length).toBe(1);
    expect(r.invDetail[0].rfSumma).toBe(30000);
  });

  it("5-aastase perioodi puhul: 2037 ei lähe järgmisse ([2032,2036])", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      monthEq: 60,
      investments: [mkInv(2037, 50000)],
    });
    expect(r.nextPeriodRfVajadus).toBe(0);
    expect(r.invDetail.length).toBe(1);
  });
});

// ── 7. Puuduva plannedYear-iga investeering ei lähe kummaski perioodi ─

describe("puuduva/mittearvulise plannedYear-iga investeering", () => {
  it("plannedYear puudub → ei arvestata ühegi perioodi alla", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "x", name: "Ilma aastata", plannedYear: null,
        totalCostEUR: 10000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
      }],
    });
    expect(r.investRemondifondist).toBe(0);
    expect(r.nextPeriodRfVajadus).toBe(0);
    // Kajastub invDetail-s (plannedYear puudumisel langeb periodiAasta-le)
    expect(r.invDetail.length).toBe(1);
  });

  it("plannedYear: 0 → ei arvestata ühegi perioodi alla", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "y", name: "Null aasta", plannedYear: 0,
        totalCostEUR: 10000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
      }],
    });
    // 0 on number aga < periodStartYear:2027 → ei investRemondifondist
    // 0 < nextPeriodStart:2028 → ei nextPeriodRfVajadus
    expect(r.investRemondifondist).toBe(0);
    expect(r.nextPeriodRfVajadus).toBe(0);
  });
});

// ── 8. Kommunaalid ei mõjuta RF arvutust ─────────────────────────────

describe("kommunaalid ei lähe remondifondi loogikasse", () => {
  it("kommunaali allikaga investeering ei mõjuta RF-i", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "k1", name: "Soojus", plannedYear: 2027, totalCostEUR: 5000,
        fundingPlan: [{ source: "Kommunaal", amountEUR: 5000 }],
      }],
    });
    expect(r.investRemondifondist).toBe(0);
    expect(r.invDetail.length).toBe(0); // ei ole RF-investeering
  });

  it("osalise RF allikaga: ainult RF osa arvestatakse", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "k2", name: "Sega", plannedYear: 2027, totalCostEUR: 10000,
        fundingPlan: [
          { source: "Remondifond", amountEUR: 4000 },
          { source: "Kommunaal", amountEUR: 6000 },
        ],
      }],
    });
    expect(r.investRemondifondist).toBe(4000);
    expect(r.invDetail[0].rfSumma).toBe(4000);
  });
});

// ── 9. Ei tagastata hinnangusilte ─────────────────────────────────────

describe("computeRemondifondiArvutus ei tagasta hinnangusilte", () => {
  it("return-objektis puuduvad tase, normaalne, kriitiline jms", () => {
    const r = computeRemondifondiArvutus({ ...BASE, investments: [mkInv(2027, 5000)] });

    expect(r).not.toHaveProperty("tase");
    expect(r).not.toHaveProperty("maarSoovituslik");
    expect(r).not.toHaveProperty("invArvutusread");
    expect(r).not.toHaveProperty("maarIlmaLaenuta");
    expect(r).not.toHaveProperty("maarLaenuga");
    expect(r).not.toHaveProperty("soovitusMaarAastasM2");
  });

  it("loanScenario ei sisalda hinnangusilte", () => {
    const r = computeRemondifondiArvutus({ ...BASE, investments: [mkInv(2027, 5000)] });
    expect(r.loanScenario).not.toHaveProperty("tase");
    expect(r.loanScenario).not.toHaveProperty("maarSoovituslik");
    expect(r.loanScenario).not.toHaveProperty("invArvutusread");
  });
});

// ── 10. katab semantika ───────────────────────────────────────────────

describe("katab = saldoLopp >= nextPeriodRfVajadus", () => {
  it("katab=true kui saldo katab järgmise perioodi vajaduse", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "25000",
      investments: [mkInv(2028, 20000)], // järgmine periood
    });
    expect(r.saldoLopp).toBe(25000); // 25000+0-0
    expect(r.nextPeriodRfVajadus).toBe(20000);
    expect(r.katab).toBe(true);
  });

  it("katab=false kui saldo ei kata järgmise perioodi vajadust", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "5000",
      investments: [mkInv(2028, 20000)],
    });
    expect(r.saldoLopp).toBe(5000);
    expect(r.katab).toBe(false);
  });
});

// ── 11. "Määramata" vs 0 eristus ─────────────────────────────────────

describe("maarKuusM2=0 ja kasitsiMaar=false eristub käsitsi määratud nullist", () => {
  it("maarOverride null → kasitsiMaar=false, maarKuusM2=0", () => {
    const r = computeRemondifondiArvutus({ ...BASE, maarOverride: null, investments: [] });
    expect(r.maarKuusM2).toBe(0);
    expect(r.kasitsiMaar).toBe(false);
  });

  it("maarOverride 0.5 → kasitsiMaar=true, maarKuusM2=0.5", () => {
    const r = computeRemondifondiArvutus({ ...BASE, maarOverride: 0.5, investments: [] });
    expect(r.maarKuusM2).toBe(0.5);
    expect(r.kasitsiMaar).toBe(true);
  });
});
