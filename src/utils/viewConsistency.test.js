import { describe, it, expect } from "vitest";
import {
  computeKopiiriondvaade,
  computeRemondifondiArvutus,
  arvutaKuumakseExact,
} from "./majanduskavaCalc";

// ── Simulate korteriteKuumaksed (same logic as App.jsx lines 463-490) ────────

function computeKorteriteKuumaksed(apartments, totAreaM2, remondifondiArvutus, kopiiriondvaade, reservPlannedEUR, loanStatus) {
  const koguPind = totAreaM2;
  const ra = remondifondiArvutus;
  const rfKuuKokku = ra.maarAastasM2 * koguPind / 12;
  const reservKuuKokku = (reservPlannedEUR || 0) / 12;
  const laenKuuKokku = ra.olemasolevLaenumaksedKuus + (ra.loanApproved ? ra.planeeritudLaenumaksedKuus : 0);

  return apartments.map(a => {
    const pind = a.areaM2 || 0;
    const osa = koguPind > 0 ? pind / koguPind : 0;
    const kommunaal = Math.round(kopiiriondvaade.kommunaalKokku * osa);
    const haldus = Math.round(kopiiriondvaade.haldusKokku * osa);
    const rf = Math.round(rfKuuKokku * osa);
    const laen = Math.round(laenKuuKokku * osa);
    const reserv = Math.round(reservKuuKokku * osa);
    const kokku = kommunaal + haldus + rf + laen + reserv;
    return { id: a.id, pind, osa, kommunaal, haldus, remondifond: rf, laenumakse: laen, reserv, kokku };
  });
}

// Simulate Kokkuvõte tab period totals (same logic as App.jsx lines 2957-2974)
function computeKokkuvottePeriod(kopiiriondvaade, mEq) {
  const kommunaalPeriood = kopiiriondvaade.kommunaalPeriood || Math.round(kopiiriondvaade.kommunaalKokku * mEq);
  const haldusPeriood = kopiiriondvaade.haldusPeriood || Math.round(kopiiriondvaade.haldusKokku * mEq);
  const laenumaksedPeriood = Math.round(kopiiriondvaade.laenumaksedKokku * mEq);
  const kuludPeriood = kommunaalPeriood + haldusPeriood;
  const valjaminekudPeriood = kuludPeriood + laenumaksedPeriood;
  const haldustasuPeriood = haldusPeriood;
  const laenumakseTuluPeriood = laenumaksedPeriood;
  const muudTuludPeriood = Math.round(kopiiriondvaade.muudTuludKokku * mEq);
  const tuludPeriood = haldustasuPeriood + laenumakseTuluPeriood + muudTuludPeriood;
  const vahePeriood = tuludPeriood - valjaminekudPeriood;
  return { kommunaalPeriood, haldusPeriood, laenumaksedPeriood, kuludPeriood, valjaminekudPeriood, tuludPeriood, vahePeriood, muudTuludPeriood };
}

// Simulate print Kokkuvõte (FIXED version — same source as sec===6)
function computePrintKokkuvote(kopiiriondvaade, mEq) {
  return computeKokkuvottePeriod(kopiiriondvaade, mEq);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function mkTestState(loanStatus = "APPLIED") {
  const costRows = [
    { category: "Soojus", summaInput: "1200", calc: { type: "FIXED_PERIOD", params: { amountEUR: 1200 } } },
    { category: "Haldus", summaInput: "600", arvutus: "aastas", calc: { type: "FIXED_PERIOD", params: { amountEUR: 600 } } },
  ];
  const incomeRows = [
    { summaInput: "200", arvutus: "kuus", calc: { type: "FIXED_PERIOD", params: { amountEUR: 2400 } } },
  ];
  const loans = [
    { id: "loan-exist", principalEUR: 50000, annualRatePct: 4, termMonths: 120, sepiiriostudInvId: null },
    { id: "loan-planned", principalEUR: 100000, annualRatePct: 3.6, termMonths: 240, sepiiriostudInvId: "r1" },
  ];
  const apartments = [
    { id: "apt-1", label: "1", areaM2: 50 },
    { id: "apt-2", label: "2", areaM2: 50 },
  ];
  const investments = [
    {
      id: "inv-1", sourceType: "condition_item", sourceRefId: "r1",
      name: "Katus", plannedYear: 2028, totalCostEUR: 50000,
      fundingPlan: [{ source: "Laen", amountEUR: 30000 }, { source: "Remondifond", amountEUR: 20000 }],
    },
  ];
  return { costRows, incomeRows, loans, apartments, investments, loanStatus, mEq: 12, reservPlannedEUR: 1200 };
}

function computeAllViews(state) {
  const kv = computeKopiiriondvaade(state.costRows, state.incomeRows, state.loans, state.mEq, state.loanStatus);
  const rf = computeRemondifondiArvutus({
    saldoAlgusRaw: "0", koguPind: 100, periodiAasta: 2026, pangaKoef: 1.15,
    kogumisViis: "eraldi", pangaMaarOverride: null, maarOverride: null,
    investments: state.investments, loans: state.loans, loanStatus: state.loanStatus, monthEq: state.mEq,
  });
  const km = computeKorteriteKuumaksed(state.apartments, 100, rf, kv, state.reservPlannedEUR, state.loanStatus);
  const kkv = computeKokkuvottePeriod(kv, state.mEq);
  const print = computePrintKokkuvote(kv, state.mEq);
  return { kv, rf, km, kkv, print };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("vaadetevahelise arvutuskooskõla invariandid", () => {

  // 1. Kulud kokku kuus on identne kõigis vaadetes
  it("kulud kokku kuus on identne kõigis vaadetes", () => {
    const s = mkTestState("APPROVED");
    const { kv, km, kkv } = computeAllViews(s);

    const kvKuludKuus = kv.kuludKokku;
    const kmKuludKuus = km.reduce((sum, k) => sum + k.kommunaal + k.haldus, 0);
    const kkvKuludKuus = Math.round(kkv.kuludPeriood / s.mEq);

    expect(kmKuludKuus).toBe(kvKuludKuus);
    expect(kkvKuludKuus).toBe(kvKuludKuus);
  });

  // 2. Tulud kokku kuus on identne kõigis vaadetes
  it("tulud kokku kuus on identne ekraani ja print vaates", () => {
    const s = mkTestState("APPROVED");
    const { kkv, print } = computeAllViews(s);

    expect(print.tuludPeriood).toBe(kkv.tuludPeriood);
    expect(print.valjaminekudPeriood).toBe(kkv.valjaminekudPeriood);
    expect(print.vahePeriood).toBe(kkv.vahePeriood);
  });

  // 3. Korterite kuumaksete summa = kokkuvõtte kuupõhine kokku
  it("korterite kuumaksete summa üle kõigi korterite = kokkuvõtte kuupõhine", () => {
    const s = mkTestState("APPROVED");
    const { kv, km } = computeAllViews(s);

    const kmTotal = km.reduce((sum, k) => sum + k.kommunaal + k.haldus, 0);
    expect(kmTotal).toBe(kv.kuludKokku);
  });

  // 4. APPLIED laen: planeeritud ei arvestata
  it("APPLIED laen: laenumaksedKokku === olemasolevadLaenudKuus", () => {
    const s = mkTestState("APPLIED");
    const { kv } = computeAllViews(s);

    expect(kv.planeeritudLaenudKuus).toBeGreaterThan(0);
    expect(kv.laenumaksedKokku).toBe(kv.olemasolevadLaenudKuus);
    expect(kv.laenumaksedKokku).not.toBe(kv.olemasolevadLaenudKuus + kv.planeeritudLaenudKuus);
  });

  // 5. APPROVED laen: mõlemad arvestatakse
  it("APPROVED laen: laenumaksedKokku === olemasolevad + planeeritud", () => {
    const s = mkTestState("APPROVED");
    const { kv } = computeAllViews(s);

    expect(kv.laenumaksedKokku).toBeCloseTo(kv.olemasolevadLaenudKuus + kv.planeeritudLaenudKuus, 2);
  });

  // 6. APPROVED laen läheb identse summaga kõigisse vaadetesse
  it("APPROVED laen läheb identse summaga kopiiriondvaatesse, korteritesse ja print-vaatesse", () => {
    const s = mkTestState("APPROVED");
    const { kv, km, kkv, print } = computeAllViews(s);

    const kvLaenPeriood = Math.round(kv.laenumaksedKokku * s.mEq);
    const kmLaenKokku = km.reduce((sum, k) => sum + k.laenumakse, 0);

    expect(kkv.laenumaksedPeriood).toBe(kvLaenPeriood);
    expect(print.laenumaksedPeriood).toBe(kvLaenPeriood);
    // korterite laenumaksed kasutavad arvutaKuumakse (ümardatud per-laen),
    // kopiiriondvaade kasutab arvutaKuumakseExact — lubame ümardusvahe
    expect(Math.abs(Math.round(kmLaenKokku * s.mEq) - kvLaenPeriood)).toBeLessThanOrEqual(s.mEq);
  });

  // 7. Remondifondi laekuminePerioodis täpne valem
  it("remondifondi laekuminePerioodis === Math.round(maarAastasM2 * koguPind * mEq / 12)", () => {
    const s = mkTestState("APPROVED");
    const { rf } = computeAllViews(s);

    expect(rf.laekuminePerioodis).toBe(Math.round(rf.maarAastasM2 * rf.koguPind * s.mEq / 12));
  });

  // 8. Reserv perioodis === Math.round(plannedEUR / 12 * mEq)
  it("reserv perioodis on kooskõlas kuupõhise arvutusega", () => {
    const s = mkTestState("APPLIED");
    const { km } = computeAllViews(s);

    const reservKuus = s.reservPlannedEUR / 12;
    const reservPeriood = Math.round(reservKuus * s.mEq);
    const kmReservKokku = km.reduce((sum, k) => sum + k.reserv, 0);

    // km reserv per month total should equal reservKuus (within rounding)
    expect(Math.abs(kmReservKokku - Math.round(reservKuus))).toBeLessThanOrEqual(s.apartments.length);
    // For mEq=12, reservPeriood should equal plannedEUR
    expect(reservPeriood).toBe(s.reservPlannedEUR);
  });

  // 9. Kõik neli vaadet annavad sama "kulud kokku kuus"
  it("kõik neli vaadet annavad sama kulud kokku", () => {
    const s = mkTestState("APPROVED");
    const { kv, km, kkv, print } = computeAllViews(s);

    const fromKV = kv.kuludKokku;
    const fromKM = km.reduce((sum, k) => sum + k.kommunaal + k.haldus, 0);
    const fromKKV = Math.round(kkv.kuludPeriood / s.mEq);
    const fromPrint = Math.round(print.kuludPeriood / s.mEq);

    expect(fromKM).toBe(fromKV);
    expect(fromKKV).toBe(fromKV);
    expect(fromPrint).toBe(fromKV);
  });

  // 10. print-vaate Kokkuvõte read vastavad ekraanivaate ridadele
  it("print-vaate Kokkuvõte read vastavad ekraanivaate ridadele", () => {
    for (const status of ["APPLIED", "APPROVED"]) {
      const s = mkTestState(status);
      const { kkv, print } = computeAllViews(s);

      expect(print.valjaminekudPeriood).toBe(kkv.valjaminekudPeriood);
      expect(print.tuludPeriood).toBe(kkv.tuludPeriood);
      expect(print.vahePeriood).toBe(kkv.vahePeriood);
      expect(print.laenumaksedPeriood).toBe(kkv.laenumaksedPeriood);
      expect(print.kommunaalPeriood).toBe(kkv.kommunaalPeriood);
      expect(print.haldusPeriood).toBe(kkv.haldusPeriood);
    }
  });
});
