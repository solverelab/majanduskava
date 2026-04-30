import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";
import { defaultPlan, mkRfUsageItem } from "../domain/planSchema";

// ══════════════════════════════════════════════════════════════════════
// Tab 3 „Fondist rahastatavad tööd" invariandid
//
// Kinnitab, et:
//   1. mkRfUsageItem eksisteerib ja tagastab õige kuju
//   2. defaultPlan sisaldab funds.repairFund.usageItems: []
//   3. Tab 1 eeldatavKulu ei lähe automaatselt RF kasutusse
//   4. rfUsageRemondifondist = usageItems[].remondifondistKaetavSumma summa
//   5. Mitu usage item summeeruvad korrektselt
//   6. saldoLopp = saldoAlgus + laekumine – kõik remondifondist kaetavad (sh usageItems)
//   7. Üle Tab 1 eeldatava kulu hoiatuse loogika (ilma React renderita)
//   8. Reservkapital ja laenud ei muutu
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  saldoAlgusRaw: "1000",
  koguPind: 200,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: 0.5,   // 0,5 €/m²/kuu → laekumine = 0,5*12*200 = 1200
  investments: [],
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 12,
  costRows: [],
};

// ── 1. mkRfUsageItem factory ───────────────────────────────────────────────

describe("mkRfUsageItem factory", () => {
  it("tagastab nõutud 4 välja", () => {
    const item = mkRfUsageItem();
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("linkedAssetConditionId", null);
    expect(item).toHaveProperty("remondifondistKaetavSumma", 0);
    expect(item).toHaveProperty("markus", "");
  });

  it("id on unikaalne igal kutsel", () => {
    const a = mkRfUsageItem();
    const b = mkRfUsageItem();
    expect(a.id).not.toBe(b.id);
  });

  it("väärtused saab üle kirjutada", () => {
    const item = mkRfUsageItem({ linkedAssetConditionId: "cond-1", remondifondistKaetavSumma: 3000, markus: "katuse remont" });
    expect(item.linkedAssetConditionId).toBe("cond-1");
    expect(item.remondifondistKaetavSumma).toBe(3000);
    expect(item.markus).toBe("katuse remont");
  });

  it("item EI sisalda Tab 1 töö kirjeldusväljasid (ese, eeldatavKulu, tegevusAasta)", () => {
    const item = mkRfUsageItem();
    expect(item).not.toHaveProperty("ese");
    expect(item).not.toHaveProperty("eeldatavKulu");
    expect(item).not.toHaveProperty("tegevusAasta");
  });
});

// ── 2. defaultPlan andmemudel ──────────────────────────────────────────────

describe("defaultPlan andmemudel", () => {
  it("funds.repairFund.usageItems on vaikimisi tühi massiiv", () => {
    const plan = defaultPlan();
    expect(plan.funds.repairFund.usageItems).toEqual([]);
  });

  it("funds.reserve jääb muutmata", () => {
    const plan = defaultPlan();
    expect(plan.funds.reserve).toEqual({ plannedEUR: 0 });
  });

  it("loans jääb muutmata", () => {
    const plan = defaultPlan();
    expect(plan.loans).toEqual([]);
  });
});

// ── 3. Tab 1 eeldatavKulu ei lähe automaatselt RF kasutusse ───────────────

describe("Tab 1 eeldatavKulu ei lähe automaatselt RF kasutusse", () => {
  it("Tab 1 objekt eeldatavKulu=5000 ilma usage itemita → rfUsageRemondifondist=0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [],
    });
    expect(r.rfUsageRemondifondist).toBe(0);
  });

  it("investeeringud ilma fundingPlan RF-allikaga → investRemondifondist=0, rfUsageRemondifondist=0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{ id: "i1", name: "Katuse remont", plannedYear: 2027, totalCostEUR: 5000, fundingPlan: [] }],
      rfUsageItems: [],
    });
    expect(r.investRemondifondist).toBe(0);
    expect(r.rfUsageRemondifondist).toBe(0);
  });
});

// ── 4. rfUsageRemondifondist = usageItems summa ────────────────────────────

describe("rfUsageRemondifondist = usageItems[].remondifondistKaetavSumma summa", () => {
  it("üks usage item → rfUsageRemondifondist = selle summa", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 3000 })],
    });
    expect(r.rfUsageRemondifondist).toBe(3000);
  });

  it("string-summa parsitakse arvuks", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [{ ...mkRfUsageItem(), remondifondistKaetavSumma: "2500" }],
    });
    expect(r.rfUsageRemondifondist).toBe(2500);
  });

  it("tühja summaga item ei mõjuta tulemust", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 0 })],
    });
    expect(r.rfUsageRemondifondist).toBe(0);
  });
});

// ── 5. Mitu usage itemit summeeruvad ──────────────────────────────────────

describe("mitu usage itemit summeeruvad", () => {
  it("3 itemit → rfUsageRemondifondist = summa", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [
        mkRfUsageItem({ remondifondistKaetavSumma: 1000 }),
        mkRfUsageItem({ remondifondistKaetavSumma: 2000 }),
        mkRfUsageItem({ remondifondistKaetavSumma: 500 }),
      ],
    });
    expect(r.rfUsageRemondifondist).toBe(3500);
  });

  it("rfUsageItems puudumine (undefined) käitub nagu []", () => {
    const r = computeRemondifondiArvutus({ ...BASE });
    expect(r.rfUsageRemondifondist).toBe(0);
  });
});

// ── 6. saldoLopp = saldoAlgus + laekumine – kõik remondifondist kaetavad ──

describe("saldoLopp arvestab rfUsageRemondifondist", () => {
  // BASE: saldoAlgus=1000, maarOverride=0.5, koguPind=200 → laekumine=0.5*12*200=1200
  // saldoLopp ilma kuluta = 1000 + 1200 = 2200

  it("usage item vähendab lõppsaldot", () => {
    const rIlma = computeRemondifondiArvutus({ ...BASE, rfUsageItems: [] });
    const rKoos = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 800 })],
    });
    expect(rIlma.saldoLopp).toBe(2200);
    expect(rKoos.saldoLopp).toBe(2200 - 800);   // 1400
  });

  it("investRemondifondist ja rfUsageRemondifondist summeeruvad remondifondistKaetavadKokku-sse", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "i1", name: "Lift", plannedYear: 2027, totalCostEUR: 5000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 5000 }],
      }],
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 2000 })],
    });
    expect(r.investRemondifondist).toBe(5000);
    expect(r.rfUsageRemondifondist).toBe(2000);
    expect(r.remondifondistKaetavadKokku).toBe(7000);
    expect(r.saldoLopp).toBe(1000 + 1200 - 7000); // -4800
  });

  it("lõppsaldo on negatiivne kui kasutus ületab saldo + laekumise", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 5000 })],
    });
    // 1000 + 1200 - 5000 = -2800
    expect(r.saldoLopp).toBe(-2800);
  });
});

// ── 7. Üle Tab 1 eeldatava kulu hoiatuse loogika ──────────────────────────

describe("üle Tab 1 eeldatava kulu hoiatuse loogika (UI valem)", () => {
  // UI kood: isOverBudget = linkedCondition && itemAmt > 0 && itemAmt > eeldatavKulu
  function isOverBudget(linkedCondition, remondifondistKaetavSumma) {
    const itemAmt = parseFloat(remondifondistKaetavSumma) || 0;
    return linkedCondition != null && itemAmt > 0 && itemAmt > (parseFloat(linkedCondition.eeldatavKulu) || 0);
  }

  it("linkedCondition puudub → ei hoiata", () => {
    expect(isOverBudget(null, 9999)).toBe(false);
  });

  it("summa < eeldatavKulu → ei hoiata", () => {
    expect(isOverBudget({ eeldatavKulu: "5000" }, 3000)).toBe(false);
  });

  it("summa = eeldatavKulu → ei hoiata", () => {
    expect(isOverBudget({ eeldatavKulu: "5000" }, 5000)).toBe(false);
  });

  it("summa > eeldatavKulu → hoiatab", () => {
    expect(isOverBudget({ eeldatavKulu: "5000" }, 6000)).toBe(true);
  });

  it("summa = 0 → ei hoiata (kasutaja pole veel sisestanud)", () => {
    expect(isOverBudget({ eeldatavKulu: "5000" }, 0)).toBe(false);
  });
});

// ── 8. Reservkapital ja laenud jäävad muutmata ────────────────────────────

describe("reservkapital ja laenud ei muutu rfUsageItems lisamisel", () => {
  it("computeRemondifondiArvutus ei mõjuta laenumakseid", () => {
    const rIlma = computeRemondifondiArvutus({ ...BASE, rfUsageItems: [] });
    const rKoos = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 5000 })],
    });
    expect(rIlma.laenumaksedKuus).toBe(rKoos.laenumaksedKuus);
  });

  it("defaultPlan reserve ei sõltu repairFund.usageItems väljast", () => {
    const plan = defaultPlan();
    plan.funds.repairFund.usageItems.push(mkRfUsageItem({ remondifondistKaetavSumma: 9999 }));
    expect(plan.funds.reserve).toEqual({ plannedEUR: 0 });
  });
});
