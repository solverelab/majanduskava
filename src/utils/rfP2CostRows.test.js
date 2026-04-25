import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// P2 kuluridade RF rahastusallikas invariandid
//
// fundingSource: "eelarve" | "remondifond"  (vaikimisi: "eelarve")
// recursNextPeriod: boolean                 (vaikimisi: false)
// nextPeriodAmount: number | null           (null = sama mis praegu)
//
// p2Remondifondist        : RF-kuluridade perioodisumma
// remondifondistKaetavadKokku = investRemondifondist + p2Remondifondist
// saldoLopp = saldoAlgus + laekuminePerioodis - remondifondistKaetavadKokku
// nextPeriodRfVajadus    += rekurseeruvate p2 RF-kulude summa
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
  monthEq: 12,
  investments: [],
};

function mkCostRow(fundingSource, summaInput, opts = {}) {
  return {
    id: String(Math.random()),
    category: "Haldus",
    arvutus: "perioodis",
    summaInput,
    fundingSource,
    recursNextPeriod: opts.recursNextPeriod ?? false,
    nextPeriodAmount: opts.nextPeriodAmount ?? null,
  };
}

// ── 1. Tühja costRows puhul p2Remondifondist on 0 ────────────────────

describe("tühja costRows puhul p2 väljad on 0", () => {
  it("costRows puudub → p2Remondifondist=0, remondifondistKaetavadKokku=0", () => {
    const r = computeRemondifondiArvutus({ ...BASE });
    expect(r.p2Remondifondist).toBe(0);
    expect(r.remondifondistKaetavadKokku).toBe(0);
  });

  it("costRows: [] → p2Remondifondist=0", () => {
    const r = computeRemondifondiArvutus({ ...BASE, costRows: [] });
    expect(r.p2Remondifondist).toBe(0);
    expect(r.nextPeriodRfVajadus).toBe(0);
  });
});

// ── 2. Eelarve allikaga read ei mõjuta RF-i ──────────────────────────

describe("fundingSource=eelarve read ei mõjuta RF arvutust", () => {
  it("eelarve allikas → p2Remondifondist=0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      costRows: [
        mkCostRow("eelarve", 5000),
        mkCostRow("eelarve", 3000),
      ],
    });
    expect(r.p2Remondifondist).toBe(0);
    expect(r.remondifondistKaetavadKokku).toBe(0);
  });
});

// ── 3. Remondifond allikaga read mõjutavad p2Remondifondist ──────────

describe("fundingSource=remondifond → p2Remondifondist korrektne", () => {
  it("üks RF-kulurida (perioodis) → p2Remondifondist = summaInput", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      costRows: [mkCostRow("remondifond", 6000)],
    });
    expect(r.p2Remondifondist).toBe(6000);
  });

  it("mitu RF-kulurida → p2Remondifondist = summa", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      costRows: [
        mkCostRow("remondifond", 4000),
        mkCostRow("remondifond", 2500),
        mkCostRow("eelarve", 10000),
      ],
    });
    expect(r.p2Remondifondist).toBe(6500);
  });

  it("arvutus=aastas 12kuuga → perioodisumma = summaInput", () => {
    const row = { ...mkCostRow("remondifond", 12000), arvutus: "aastas" };
    const r = computeRemondifondiArvutus({ ...BASE, costRows: [row] });
    expect(r.p2Remondifondist).toBe(12000); // 12000/12*12=12000
  });

  it("arvutus=kuus 12kuuga → perioodisumma = summaInput*12", () => {
    const row = { ...mkCostRow("remondifond", 500), arvutus: "kuus" };
    const r = computeRemondifondiArvutus({ ...BASE, costRows: [row] });
    expect(r.p2Remondifondist).toBe(6000); // 500*12
  });
});

// ── 4. remondifondistKaetavadKokku = investRemondifondist + p2Remondifondist ─

describe("remondifondistKaetavadKokku invariant", () => {
  it("Tab1 + p2 koos → remondifondistKaetavadKokku = nende summa", () => {
    const inv = {
      id: "i1", name: "Katus", plannedYear: 2027, totalCostEUR: 10000,
      fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
    };
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [inv],
      costRows: [mkCostRow("remondifond", 3000)],
    });
    expect(r.investRemondifondist).toBe(10000);
    expect(r.p2Remondifondist).toBe(3000);
    expect(r.remondifondistKaetavadKokku).toBe(13000);
  });
});

// ── 5. saldoLopp kasutab remondifondistKaetavadKokku ─────────────────

describe("saldoLopp = saldoAlgus + laekumine - remondifondistKaetavadKokku", () => {
  it("saldo kahaneb p2 RF-kulu võrra", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "20000",
      costRows: [mkCostRow("remondifond", 5000)],
    });
    expect(r.saldoLopp).toBe(15000); // 20000 - 5000
    expect(r.p2Remondifondist).toBe(5000);
    expect(r.remondifondistKaetavadKokku).toBe(5000);
  });
});

// ── 6. recursNextPeriod lisab nextPeriodRfVajadus hulka ──────────────

describe("recursNextPeriod=true lisab nextPeriodRfVajadus hulka", () => {
  it("rekursiivne RF-kulu (perioodis) → nextPeriodRfVajadus sisaldab seda", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      costRows: [mkCostRow("remondifond", 4000, { recursNextPeriod: true })],
    });
    expect(r.nextPeriodRfVajadus).toBe(4000);
  });

  it("Tab1 järgmine periood + rekursiivne p2 → summaarne nextPeriodRfVajadus", () => {
    const inv = {
      id: "i1", name: "Katus", plannedYear: 2028, totalCostEUR: 15000,
      fundingPlan: [{ source: "Remondifond", amountEUR: 15000 }],
    };
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [inv],
      costRows: [mkCostRow("remondifond", 5000, { recursNextPeriod: true })],
    });
    expect(r.nextPeriodRfVajadus).toBe(20000); // 15000 + 5000
  });
});

// ── 7. recursNextPeriod=false ei mõjuta nextPeriodRfVajadus ──────────

describe("recursNextPeriod=false ei mõjuta nextPeriodRfVajadus", () => {
  it("mitte-rekursiivne RF-kulu ei lähe järgmisse perioodi", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      costRows: [mkCostRow("remondifond", 8000, { recursNextPeriod: false })],
    });
    expect(r.nextPeriodRfVajadus).toBe(0);
  });
});

// ── 8. nextPeriodAmount overridib kui antud ───────────────────────────

describe("nextPeriodAmount overridib järgmise perioodi summa", () => {
  it("nextPeriodAmount > 0 → kasutatakse seda, mitte praegust summat", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      costRows: [mkCostRow("remondifond", 4000, { recursNextPeriod: true, nextPeriodAmount: 6000 })],
    });
    expect(r.nextPeriodRfVajadus).toBe(6000); // override
    expect(r.p2Remondifondist).toBe(4000);    // praegune ei muutu
  });
});

// ── 9. nextPeriodAmount=null → langeb tagasi praegusele summale ───────

describe("nextPeriodAmount=null langeb tagasi praegusele perioodisummale", () => {
  it("nextPeriodAmount null → nextPeriodRfVajadus = praeguse perioodi p2 summa", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      costRows: [mkCostRow("remondifond", 7000, { recursNextPeriod: true, nextPeriodAmount: null })],
    });
    expect(r.nextPeriodRfVajadus).toBe(7000);
  });
});

// ── 10. katab invariant kehtib p2-ga ─────────────────────────────────

describe("katab = saldoLopp >= nextPeriodRfVajadus (p2 arvesse võttes)", () => {
  it("katab=true kui saldoLopp >= nextPeriodRfVajadus (sh p2 rekursiivne)", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "10000",
      costRows: [mkCostRow("remondifond", 3000, { recursNextPeriod: true })],
    });
    expect(r.saldoLopp).toBe(7000); // 10000 - 3000
    expect(r.nextPeriodRfVajadus).toBe(3000);
    expect(r.katab).toBe(true);
  });

  it("katab=false kui p2 rekursiiv ületab saldoLopp", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "2000",
      costRows: [mkCostRow("remondifond", 2000, { recursNextPeriod: true, nextPeriodAmount: 5000 })],
    });
    expect(r.saldoLopp).toBe(0); // 2000 - 2000
    expect(r.nextPeriodRfVajadus).toBe(5000);
    expect(r.katab).toBe(false);
  });
});

// ── 11. Tab1 investRemondifondist ei muutu costRows lisamisel ─────────

describe("investRemondifondist (Tab1) ei muutu costRows lisamisel", () => {
  it("sama investeering, erinev costRows → investRemondifondist identne", () => {
    const inv = {
      id: "i1", name: "Katus", plannedYear: 2027, totalCostEUR: 12000,
      fundingPlan: [{ source: "Remondifond", amountEUR: 12000 }],
    };
    const r0 = computeRemondifondiArvutus({ ...BASE, investments: [inv], costRows: [] });
    const r1 = computeRemondifondiArvutus({
      ...BASE,
      investments: [inv],
      costRows: [mkCostRow("remondifond", 5000)],
    });
    expect(r0.investRemondifondist).toBe(12000);
    expect(r1.investRemondifondist).toBe(12000); // muutumatu
    expect(r1.p2Remondifondist).toBe(5000);
    expect(r1.remondifondistKaetavadKokku).toBe(17000);
  });
});
