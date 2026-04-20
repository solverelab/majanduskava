import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// kogumisViis regressioonitestid
//   – UI toggle on eemaldatud, aga state parameeter jääb alles
//   – RF arvutus peab olema identne sõltumata kogumisViis väärtusest
//   – puuduv kogumisViis ei tohi midagi murda
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  saldoAlgusRaw: "5000",
  koguPind: 200,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  pangaMaarOverride: null,
  maarOverride: null,
  loans: [],
  loanStatus: "NONE",
  monthEq: 60,
  investments: [
    {
      name: "Katus",
      plannedYear: 2029,
      totalCostEUR: 30000,
      fundingPlan: [{ source: "Remondifond", amountEUR: 30000 }],
    },
  ],
};

describe("kogumisViis ei mõjuta RF arvutust", () => {
  it('"eraldi" ja "uhine" annavad identse tulemuse', () => {
    const eraldi = computeRemondifondiArvutus({ ...BASE, kogumisViis: "eraldi" });
    const uhine = computeRemondifondiArvutus({ ...BASE, kogumisViis: "uhine" });

    expect(eraldi.maarAastasM2).toBe(uhine.maarAastasM2);
    expect(eraldi.investRemondifondist).toBe(uhine.investRemondifondist);
    expect(eraldi.saldoAlgus).toBe(uhine.saldoAlgus);
    expect(eraldi.arvutusread).toEqual(uhine.arvutusread);
  });

  it("puuduv kogumisViis (undefined) ei murra arvutust", () => {
    const withoutKV = computeRemondifondiArvutus({ ...BASE });
    const withKV = computeRemondifondiArvutus({ ...BASE, kogumisViis: "eraldi" });

    expect(withoutKV.maarAastasM2).toBe(withKV.maarAastasM2);
    expect(withoutKV.investRemondifondist).toBe(withKV.investRemondifondist);
  });

  it("suvaline kogumisViis väärtus ei mõjuta tulemust", () => {
    const normal = computeRemondifondiArvutus({ ...BASE, kogumisViis: "eraldi" });
    const bogus = computeRemondifondiArvutus({ ...BASE, kogumisViis: "foobar" });

    expect(bogus.maarAastasM2).toBe(normal.maarAastasM2);
  });
});

describe("RF arvutuse põhiflow töötab pärast UI eemaldust", () => {
  it("investeeringuga RF → positiivne kogumismäär", () => {
    const ra = computeRemondifondiArvutus({ ...BASE, kogumisViis: "eraldi" });
    expect(ra.maarAastasM2).toBeGreaterThan(0);
    expect(ra.investRemondifondist).toBe(30000);
  });

  it("investeeringuteta RF → null kogumismäär", () => {
    const ra = computeRemondifondiArvutus({
      ...BASE,
      kogumisViis: "eraldi",
      investments: [],
    });
    expect(ra.maarAastasM2).toBe(0);
    expect(ra.investRemondifondist).toBe(0);
  });

  it("saldoAlgus vähendab kogumise vajadust", () => {
    const noSaldo = computeRemondifondiArvutus({
      ...BASE,
      kogumisViis: "eraldi",
      saldoAlgusRaw: "0",
    });
    const withSaldo = computeRemondifondiArvutus({
      ...BASE,
      kogumisViis: "eraldi",
      saldoAlgusRaw: "10000",
    });
    expect(withSaldo.maarAastasM2).toBeLessThan(noSaldo.maarAastasM2);
  });
});
