import { describe, it, expect, beforeAll } from "vitest";
import { computePlan } from "../engine/computePlan";
import { defaultPlan, mkLoan } from "../domain/planSchema";

// ══════════════════════════════════════════════════════════════════════
// Tab 2 laenu teenindamise invariandid
//
// Kinnitab, et:
//   1. plan.loans jääb kanoniliseks allikaks (ei looda costRow-põhist paralleelmudelit)
//   2. Manuaalsed perioodi väljad (pohiosPerioodis + intressPerioodis + teenustasudPerioodis)
//      lähevad arvesse servicingPeriodEUR arvutuses
//   3. Planeeritavad laenud (sepiiriostudInvId) kasutavad alati amortisatsioonigraafikut
//   4. Laenumakse costRow + plan.loans topeltarvestus ei teki Tab 2 kaudu
//   5. mkLoan sisaldab kõiki vajalikke väljasid
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  ...defaultPlan({ year: 2027 }),
  period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
  building: { apartments: [{ id: "a1", label: "1", areaM2: 50 }] },
  budget: { costRows: [], incomeRows: [] },
};

// ── 1. plan.loans on kanoniline allikas ────────────────────────────────────

describe("plan.loans on kanoniline allikas (ei kasuta costRow-i)", () => {
  it("ilma plan.loans-ita → derived.loans.items on tühi", () => {
    const d = computePlan(BASE);
    expect(d.loans.items).toHaveLength(0);
    expect(d.loans.servicePeriodEUR).toBe(0);
  });

  it("laen plan.loans-is → derived.loans.items sisaldab kirjet", () => {
    const plan = {
      ...BASE,
      loans: [{ ...mkLoan(), sepiiriostudInvId: null, pohiosPerioodis: 3000, intressPerioodis: 500 }],
    };
    const d = computePlan(plan);
    expect(d.loans.items).toHaveLength(1);
    expect(d.loans.items[0].servicingPeriodEUR).toBe(3500);
  });

  it("Laenumakse costRow EI loo derived.loans.items kirjet", () => {
    const plan = {
      ...BASE,
      budget: {
        costRows: [{ id: "lm1", side: "COST", category: "Laenumakse", summaInput: "5000", calc: { type: "FIXED_PERIOD", params: { amountEUR: 5000 } } }],
        incomeRows: [],
      },
    };
    const d = computePlan(plan);
    expect(d.loans.items).toHaveLength(0);
    expect(d.loans.servicePeriodEUR).toBe(0);
  });
});

// ── 2. Manuaalsed perioodisummad lähevad servicingPeriodEUR arvutusse ─────

describe("manuaalsed perioodisummad lähevad servicingPeriodEUR arvutusse", () => {
  it("pohiosPerioodis + intressPerioodis → servicingPeriodEUR", () => {
    const plan = {
      ...BASE,
      loans: [{
        ...mkLoan(), sepiiriostudInvId: null,
        pohiosPerioodis: 4000, intressPerioodis: 600, teenustasudPerioodis: 0,
      }],
    };
    const d = computePlan(plan);
    expect(d.loans.items[0].principalPeriodEUR).toBe(4000);
    expect(d.loans.items[0].interestPeriodEUR).toBe(600);
    expect(d.loans.items[0].servicingPeriodEUR).toBe(4600);
  });

  it("teenustasudPerioodis lisatakse servicingPeriodEUR-le", () => {
    const plan = {
      ...BASE,
      loans: [{
        ...mkLoan(), sepiiriostudInvId: null,
        pohiosPerioodis: 4000, intressPerioodis: 600, teenustasudPerioodis: 150,
      }],
    };
    const d = computePlan(plan);
    expect(d.loans.items[0].feesPeriodEUR).toBe(150);
    expect(d.loans.items[0].servicingPeriodEUR).toBe(4750);
  });

  it("ilma manuaalsete summadeta → amortisatsioonigraafik (pohiosPerioodis=0)", () => {
    const plan = {
      ...BASE,
      loans: [{
        ...mkLoan({
          principalEUR: 12000, annualRatePct: 0, termMonths: 12, startYM: "2027-01",
        }),
        sepiiriostudInvId: null, pohiosPerioodis: 0, intressPerioodis: 0,
      }],
    };
    const d = computePlan(plan);
    // 0% intress, 12 kuud → 1000€/kuu põhiosa, 12000€ aastas
    expect(d.loans.items[0].servicingPeriodEUR).toBeCloseTo(12000, 0);
  });

  it("ainult teenustasud, pohiosa+intress=0 → amortisatsioon + tasud", () => {
    const plan = {
      ...BASE,
      loans: [{
        ...mkLoan({ principalEUR: 12000, annualRatePct: 0, termMonths: 12, startYM: "2027-01" }),
        sepiiriostudInvId: null, pohiosPerioodis: 0, intressPerioodis: 0, teenustasudPerioodis: 200,
      }],
    };
    const d = computePlan(plan);
    expect(d.loans.items[0].feesPeriodEUR).toBe(200);
    expect(d.loans.items[0].servicingPeriodEUR).toBeCloseTo(12200, 0);
  });
});

// ── 3. Planeeritavad laenud kasutavad amortisatsioonigraafikut ─────────────

describe("planeeritavad laenud (sepiiriostudInvId) kasutavad amortisatsioonigraafikut", () => {
  it("sepiiriostudInvId → pohiosPerioodis ignoreeritakse, kasutatakse amortisatsiooni", () => {
    const plan = {
      ...BASE,
      loans: [{
        ...mkLoan({ principalEUR: 12000, annualRatePct: 0, termMonths: 12, startYM: "2027-01" }),
        sepiiriostudInvId: "inv-1",
        pohiosPerioodis: 99999, intressPerioodis: 99999,  // peaks ignoreerima
      }],
    };
    const d = computePlan(plan);
    // Peaks kasutama amortisatsiooni, mitte manuaalseid summasid
    expect(d.loans.items[0].servicingPeriodEUR).toBeCloseTo(12000, 0);
    expect(d.loans.items[0].servicingPeriodEUR).not.toBe(99999 + 99999);
  });
});

// ── 4. Topeltarvestuse vältimine ───────────────────────────────────────────

describe("topeltarvestuse vältimine: plan.loans + Laenumakse costRow", () => {
  it("plan.loans-i servicingPeriodEUR ei sõltu Laenumakse costRow-ist", () => {
    const planIlmaRow = {
      ...BASE,
      loans: [{ ...mkLoan(), sepiiriostudInvId: null, pohiosPerioodis: 5000 }],
    };
    const planKoosRow = {
      ...BASE,
      loans: [{ ...mkLoan({ id: "same-id" }), sepiiriostudInvId: null, pohiosPerioodis: 5000 }],
      budget: {
        costRows: [{ id: "lm1", category: "Laenumakse", summaInput: "5000", calc: { type: "FIXED_PERIOD", params: { amountEUR: 5000 } } }],
        incomeRows: [],
      },
    };
    const d1 = computePlan(planIlmaRow);
    const d2 = computePlan(planKoosRow);

    // derived.loans.servicePeriodEUR on sama — ei sõltu costRow-ist
    expect(d1.loans.servicePeriodEUR).toBe(5000);
    expect(d2.loans.servicePeriodEUR).toBe(5000);

    // Aga totals.costPeriodEUR erineb — Laenumakse costRow lisab summa ka costRows-i kaudu
    // (see on hoiatuse põhjus Tab 2-s — andmemudeli puhtuse eest vastutab kasutaja)
    expect(d2.totals.costPeriodEUR).toBeGreaterThan(d1.totals.costPeriodEUR);
  });
});

// ── Tab 2 "Kulud kokku perioodis" arvutuse kontroll ───────────────────────

describe("Tab 2 'Kulud kokku perioodis' = haldus + muud + laenu teenindamine", () => {
  it("1000 haldus + 500 muu + 300 laen = 1800", () => {
    const plan = {
      ...BASE,
      budget: {
        costRows: [
          { id: "h1", side: "COST", category: "Valitseja / halduri tasu", summaInput: "1000",
            calc: { type: "FIXED_PERIOD", params: { amountEUR: 1000 } } },
          { id: "m1", side: "COST", category: "Jooksev remont", summaInput: "500",
            calc: { type: "FIXED_PERIOD", params: { amountEUR: 500 } } },
        ],
        incomeRows: [],
      },
      loans: [{
        ...mkLoan(), sepiiriostudInvId: null,
        pohiosPerioodis: 300, intressPerioodis: 0, teenustasudPerioodis: 0,
      }],
    };
    const d = computePlan(plan);
    // costPeriodEUR katab ainult costRows
    expect(d.totals.costPeriodEUR).toBe(1500);
    // servicePeriodEUR katab laenud
    expect(d.loans.servicePeriodEUR).toBe(300);
    // Tab 2 "Kulud kokku perioodis" UI valem: costPeriodEUR + servicePeriodEUR
    const tab2KuludKokku = d.totals.costPeriodEUR + (d.loans?.servicePeriodEUR || 0);
    expect(tab2KuludKokku).toBe(1800);
  });

  it("auto-arvutatud laen (principalEUR>0, pohiosPerioodis=0): olemasolevadLaenudPeriood = servicingPeriodEUR", () => {
    // Kinnitab, et UI-muutuja olemasolevadLaenudPeriood kasutab derived.loans.items.servicingPeriodEUR
    // (mitte arvutaKuumakseExact otse), kuna need peavad näitama sama arvu.
    const plan = {
      ...BASE,
      budget: {
        costRows: [
          { id: "h1", side: "COST", category: "Valitseja / halduri tasu", summaInput: "1000",
            calc: { type: "FIXED_PERIOD", params: { amountEUR: 1000 } } },
        ],
        incomeRows: [],
      },
      loans: [{
        ...mkLoan({ principalEUR: 12000, annualRatePct: 0, termMonths: 12, startYM: "2027-01" }),
        sepiiriostudInvId: null, pohiosPerioodis: 0, intressPerioodis: 0, teenustasudPerioodis: 0,
      }],
    };
    const d = computePlan(plan);
    // servicingPeriodEUR on allikas, mida UI kasutab olemasolevadLaenudPeriood arvutuses
    expect(d.loans.items[0].servicingPeriodEUR).toBeCloseTo(12000, 0);
    // Tab 2 kokkuvõte: haldus(1000) + laen(~12000)
    const tab2KuludKokku = d.totals.costPeriodEUR + (d.loans?.servicePeriodEUR || 0);
    expect(tab2KuludKokku).toBeCloseTo(13000, 0);
  });

  it("ilma laenuta: kulud kokku = ainult costRows summa", () => {
    const plan = {
      ...BASE,
      budget: {
        costRows: [
          { id: "h1", side: "COST", category: "Valitseja / halduri tasu", summaInput: "2000",
            calc: { type: "FIXED_PERIOD", params: { amountEUR: 2000 } } },
        ],
        incomeRows: [],
      },
    };
    const d = computePlan(plan);
    const tab2KuludKokku = d.totals.costPeriodEUR + (d.loans?.servicePeriodEUR || 0);
    expect(tab2KuludKokku).toBe(2000);
  });
});

// ── 5. mkLoan sisaldab kõiki vajalikke Tab 2 väljasid ─────────────────────

describe("mkLoan sisaldab kõiki vajalikke Tab 2 metaandmete väljasid", () => {
  it("mkLoan() tagastab kõik vajalikud väljad vaikeväärtustega", () => {
    const ln = mkLoan();
    expect(ln).toHaveProperty("laenuandja", "");
    expect(ln).toHaveProperty("laenuandjaKirjeldus", "");
    expect(ln).toHaveProperty("eesmärk", "");
    expect(ln).toHaveProperty("eesmärkKirjeldus", "");
    expect(ln).toHaveProperty("pohiosPerioodis", 0);
    expect(ln).toHaveProperty("intressPerioodis", 0);
    expect(ln).toHaveProperty("teenustasudPerioodis", 0);
    expect(ln).toHaveProperty("allocationBasis", "m2");
    expect(ln).toHaveProperty("legalBasisSeadus", true);
    expect(ln).toHaveProperty("legalBasisBylaws", false);
    expect(ln).toHaveProperty("legalBasisSpecialAgreement", false);
    expect(ln).toHaveProperty("legalBasisMuu", false);
    expect(ln).toHaveProperty("legalBasisTaepsustus", "");
  });

  it("mkLoan säilitab olemasolevad väljad (backward compat)", () => {
    const ln = mkLoan({ name: "KredEx", principalEUR: 50000, annualRatePct: 3, termMonths: 120 });
    expect(ln.name).toBe("KredEx");
    expect(ln.principalEUR).toBe(50000);
    expect(ln.annualRatePct).toBe(3);
    expect(ln.termMonths).toBe(120);
    // Uued väljad olemas vaikeväärtustega
    expect(ln.laenuandja).toBe("");
    expect(ln.legalBasisSeadus).toBe(true);
  });
});

// ── 6. Tab 2 "Kulud kokkuvõte" UI: olemasoleva laenu rida ─────────────────

describe("Tab 2 'Kulud kokkuvõte' UI: olemasoleva laenu teenindamine eraldi real", () => {
  let kokkuvoteSection;

  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
    const start = src.indexOf("Kulud kokkuvõte");
    const end = src.indexOf("Kommunaalkulud kajastatakse", start);
    kokkuvoteSection = start >= 0 ? src.slice(start, end > start ? end : start + 2000) : "";
  });

  it("kokkuvõte sisaldab silti 'Olemasoleva laenu teenindamine'", () => {
    expect(kokkuvoteSection).toContain("Olemasoleva laenu teenindamine");
  });

  it("laenu rida on alati nähtav — ei ole peidetud tingimusega > 0", () => {
    expect(kokkuvoteSection).not.toContain("olemasolevadLaenudPeriood > 0");
  });

  it("haldus 1000 + muud 500 + laen 300 → kulud kokku perioodis = 1800", () => {
    const base = {
      ...defaultPlan({ year: 2027 }),
      period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 50 }] },
    };
    const plan = {
      ...base,
      budget: {
        costRows: [
          { id: "h1", side: "COST", category: "Valitseja / halduri tasu", summaInput: "1000",
            calc: { type: "FIXED_PERIOD", params: { amountEUR: 1000 } } },
          { id: "m1", side: "COST", category: "Jooksev remont", summaInput: "500",
            calc: { type: "FIXED_PERIOD", params: { amountEUR: 500 } } },
        ],
        incomeRows: [],
      },
      loans: [{
        ...mkLoan(), sepiiriostudInvId: null,
        pohiosPerioodis: 300, intressPerioodis: 0, teenustasudPerioodis: 0,
      }],
    };
    const d = computePlan(plan);
    // haldusSum = 1000, muudKuluSum = 500 → costPeriodEUR = 1500
    expect(d.totals.costPeriodEUR).toBe(1500);
    // olemasolevadLaenudPeriood = 300 (from servicePeriodEUR)
    expect(d.loans.servicePeriodEUR).toBe(300);
    // Kulud kokku perioodis = haldus + muud + laen = 1800
    expect(d.totals.costPeriodEUR + d.loans.servicePeriodEUR).toBe(1800);
  });
});
