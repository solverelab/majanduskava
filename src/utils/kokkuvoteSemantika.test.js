import { describe, it, expect } from "vitest";
import { computeKopiiriondvaade, computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// Kokkuvõtte semantika: vahendatav kommunaalkulu ei tohi näida puudujäägina.
//
// Kokkuvõtte loogika (Tab 6 + print):
//   kulud = kommunaal + haldus + laen
//   tulud = kommunaal + haldus + laen + muudTulud
//   vahe = tulud - kulud = muudTulud (kui muud tulud puuduvad → 0)
// ══════════════════════════════════════════════════════════════════════

// Simuleerime Tab 6 / print kokkuvõtte loogikat
function kokkuvoteSummary(kopiiriondvaade, muudTuludKokku, mEq) {
  const kommunaalPeriood = kopiiriondvaade.kommunaalPeriood || Math.round(kopiiriondvaade.kommunaalKokku * mEq);
  const haldusPeriood = kopiiriondvaade.haldusPeriood || Math.round(kopiiriondvaade.haldusKokku * mEq);
  const laenumaksedPeriood = Math.round(kopiiriondvaade.laenumaksedKokku * mEq);
  const muudTuludPeriood = Math.round(muudTuludKokku * mEq);

  const kuludPeriood = kommunaalPeriood + haldusPeriood;
  const valjaminekudPeriood = kuludPeriood + laenumaksedPeriood;

  // Tulud: vahendatavad kulud peegelduvad
  const tuludPeriood = kommunaalPeriood + haldusPeriood + laenumaksedPeriood + muudTuludPeriood;
  const vahePeriood = tuludPeriood - valjaminekudPeriood;

  return { kommunaalPeriood, haldusPeriood, laenumaksedPeriood, valjaminekudPeriood, tuludPeriood, vahePeriood, muudTuludPeriood };
}

describe("kommunaalkulu peegeldub tulude poolel", () => {
  it("ainult kommunaal → vahe on 0, mitte negatiivne", () => {
    const kv = computeKopiiriondvaade(
      [{ category: "Soojus", summaInput: "50000" }],
      [], [], 12, "APPLIED"
    );
    const s = kokkuvoteSummary(kv, 0, 12);
    expect(s.kommunaalPeriood).toBe(50000);
    expect(s.vahePeriood).toBe(0); // mitte -50000
  });

  it("kommunaal + haldus + muu tulu → vahe = muuTulu", () => {
    const kv = computeKopiiriondvaade(
      [
        { category: "Soojus", summaInput: "50000" },
        { category: "Haldus", summaInput: "10000", arvutus: "perioodis" },
      ],
      [], [], 12, "APPLIED"
    );
    const s = kokkuvoteSummary(kv, 100, 12); // 100 €/kuu muu tulu
    expect(s.vahePeriood).toBe(1200); // ainult muuTulud
  });
});

describe("haldus ja laen jäävad endiselt peegeldatuks", () => {
  it("ainult haldus → vahe 0", () => {
    const kv = computeKopiiriondvaade(
      [{ category: "Haldus", summaInput: "12000", arvutus: "perioodis" }],
      [], [], 12, "APPLIED"
    );
    const s = kokkuvoteSummary(kv, 0, 12);
    expect(s.haldusPeriood).toBe(12000);
    expect(s.vahePeriood).toBe(0);
  });
});

describe("muud tulud lisanduvad endiselt eraldi", () => {
  it("muu tulu tekitab positiivse vahe", () => {
    const kv = computeKopiiriondvaade([], [], [], 12, "APPLIED");
    const s = kokkuvoteSummary(kv, 500, 12); // 500 €/kuu
    expect(s.muudTuludPeriood).toBe(6000);
    expect(s.vahePeriood).toBe(6000);
  });
});

describe("korterimaksete arvutus ei muutu", () => {
  it("computeRemondifondiArvutus ei sõltu kokkuvõtte semantikast", () => {
    const r = computeRemondifondiArvutus({
      saldoAlgusRaw: "0", koguPind: 200, periodiAasta: 2027,
      pangaKoef: 1.15, kogumisViis: "eraldi",
      pangaMaarOverride: null, maarOverride: null,
      loans: [], loanStatus: "APPLIED", monthEq: 60,
      investments: [{
        id: "i1", name: "Katus", plannedYear: 2029, totalCostEUR: 10000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
      }],
    });
    expect(r.maarKuusM2).toBeGreaterThan(0);
  });
});
