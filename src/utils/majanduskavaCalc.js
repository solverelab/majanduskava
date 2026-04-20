// src/utils/majanduskavaCalc.js
// Pure financial calculation functions extracted from MajanduskavaApp.jsx

export const KOMMUNAALTEENUSED = ["Soojus", "Vesi ja kanalisatsioon", "Elekter", "Kütus", "Muu kommunaalteenus"];
export const HALDUSTEENUSED = ["Haldus", "Raamatupidamine", "Koristus", "Kindlustus", "Hooldus", "Prügivedu", "Muu haldusteenus"];
export const LAENUMAKSED = ["Laenumakse"];

// KrtS § 41 lg 1 p 5 — kommunaalteenuste liigid.
// Kanoniline mapping: kategooria → utilityType.
// Alamliik (nt kütuse liik: gaas/pellet/puit) jääb vabatekstina name-väljale.
// Eraldi utilitySubtype välja ei lisata enne, kui see mõjutab arvutust või raportit.
export const UTILITY_TYPE_BY_CATEGORY = {
  "Soojus": "heat",
  "Kütus": "fuel",
  "Vesi ja kanalisatsioon": "water_sewer",
  "Elekter": "electricity",
};

// Tagastab rea utilityType: eksplitsiitne väli või category fallback.
export function utilityTypeForRow(row) {
  return row.utilityType || UTILITY_TYPE_BY_CATEGORY[row.category] || null;
}

// P 5 rea täielikkuse kontroll.
// Tagastab { isUtility, complete, missing[] }.
export function utilityRowStatus(row) {
  const ut = utilityTypeForRow(row);
  if (!ut) return { isUtility: false, complete: true, missing: [] };
  const missing = [];
  if (!row.kogus) missing.push("kogus");
  if (!row.uhik || !String(row.uhik).trim()) missing.push("ühik");
  return { isUtility: true, complete: missing.length === 0, missing };
}

// Jaotusaluse kasutajasõbralik silt.
// Kanoniline tõekoht: UI, print ja kokkuvõte kasutavad seda.
export function jaotusalusSilt(jaotusalus) {
  if (jaotusalus === "korter") return "korterite vahel võrdselt";
  return "m² järgi";
}

// Kulurea jaotusaluse osakaalu arvutus.
// Kanoniline tõekoht: kõik korteritele jaotamised kasutavad seda.
export function kulureaOsa(jaotusalus, pind, koguPind, aptCount) {
  if (jaotusalus === "korter") return aptCount > 0 ? 1 / aptCount : 0;
  return koguPind > 0 ? pind / koguPind : 0;
}

// Investeeringu staatuse tuvastamine — puhas funktsioon, ei sõltu globaalsest loanStatus-est
export function investmentStatus(inv) {
  const fp = inv.fundingPlan || [];
  const realRows = fp.filter(r => (r.source || "").trim() !== "");
  const kaetud = realRows.reduce((s, r) => s + (r.amountEUR || 0), 0);
  const cost = inv.totalCostEUR || 0;

  if (cost < 0)                           return "BLOCKED";
  if (cost === 0 && kaetud > 0)           return "BLOCKED";
  if (cost > 0 && kaetud > cost)          return "BLOCKED";
  if (!inv.name)                          return "DRAFT";
  if (cost <= 0)                          return "DRAFT";
  if (realRows.length === 0)              return "DRAFT";
  if (realRows.some(r => (r.amountEUR || 0) <= 0)) return "DRAFT";
  return "READY";
}

// Laenu kuumakse arvutamine (annuiteet), ümardatud täisarvuks
export function arvutaKuumakse(summa, aastaneIntress, tahtaegKuudes) {
  const s = parseFloat(summa) || 0;
  const r = Math.max(0, parseFloat(String(aastaneIntress).replace(',', '.')) || 0) / 100 / 12;
  const n = parseInt(tahtaegKuudes) || 0;
  if (s <= 0 || n <= 0) return 0;
  if (r === 0) return Math.round(s / n);
  return Math.round(s * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
}

// Sama valem ilma ümardamiseta — perioodi koguarvestuste jaoks
export function arvutaKuumakseExact(summa, aastaneIntress, tahtaegKuudes) {
  const s = parseFloat(summa) || 0;
  const r = Math.max(0, parseFloat(String(aastaneIntress).replace(',', '.')) || 0) / 100 / 12;
  const n = parseInt(tahtaegKuudes) || 0;
  if (s <= 0 || n <= 0) return 0;
  if (r === 0) return s / n;
  return s * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

// Reservkapitali miinimum: KrtS § 8 — 1/12 aastakuludest
export function computeReserveMin(costRows, monthEq) {
  const mEq = monthEq || 12;
  const periodiKulud = costRows.reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
  const noutavMiinimum = Math.max(0, Math.round(periodiKulud / mEq));
  const aastaKulud = noutavMiinimum * 12;
  return { aastaKulud, noutavMiinimum };
}

// INVARIANT: summaInput on kanoniline maksumuse sisend kõigil kuluridadel.
// P 5 ridadel (utilityType != null) on kogus ja uhik kohustuslik sisuline info,
// aga maksumus tuleneb alati summaInput-ist, mitte kogus × uhikuHind-ist.
// uhikuHind on ainult derived/info väli ja ei mõjuta arvutust.

// Kopiiriondvaade — kuude kokkuvõte: kommunaal, haldus, tulud, laenud
export function computeKopiiriondvaade(costRows, incomeRows, loans, monthEq, loanStatus) {
  const mEq = monthEq || 12;

  const kulud = costRows.map(r => {
    const v = Math.max(0, parseFloat(r.summaInput) || 0);
    return {
      kategooria: r.category,
      summaKuus: KOMMUNAALTEENUSED.includes(r.category)
        ? v / mEq
        : r.arvutus === "aastas" ? v / 12
        : r.arvutus === "perioodis" ? v / mEq
        : v,
    };
  });

  const tulud = incomeRows.map(r => {
    const v = Math.max(0, parseFloat(r.summaInput) || 0);
    return {
      summaKuus: r.arvutus === "aastas" ? v / 12
        : r.arvutus === "perioodis" ? v / mEq
        : v,
    };
  });

  const laenud = loans.map(l => ({
    summa: l.principalEUR,
    intpiiri: l.annualRatePct,
    tahtaeg: l.termMonths,
  }));

  const kommunaalKokku = Math.round(kulud
    .filter(k => KOMMUNAALTEENUSED.includes(k.kategooria))
    .reduce((sum, k) => sum + (parseFloat(k.summaKuus) || 0), 0));

  const haldusKokku = Math.round(kulud
    .filter(k => HALDUSTEENUSED.includes(k.kategooria))
    .reduce((sum, k) => sum + (parseFloat(k.summaKuus) || 0), 0));

  const kommunaalPeriood = costRows
    .filter(r => KOMMUNAALTEENUSED.includes(r.category))
    .reduce((sum, r) => sum + (Math.round(parseFloat(r.summaInput) || 0)), 0);

  const haldusPeriood = costRows
    .filter(r => HALDUSTEENUSED.includes(r.category))
    .reduce((sum, r) => sum + (Math.round(parseFloat(r.summaInput) || 0)), 0);

  const kuludKokku = kommunaalKokku + haldusKokku;

  const muudTuludKokku = Math.round(tulud
    .reduce((sum, t) => sum + (parseFloat(t.summaKuus) || 0), 0));

  const olemasolevadLaenudKuus = loans
    .filter(l => !l.sepiiriostudInvId)
    .reduce((sum, l) => sum + arvutaKuumakseExact(l.principalEUR, l.annualRatePct, parseInt(l.termMonths) || 0), 0);

  const planeeritudLaenudKuus = loans
    .filter(l => l.sepiiriostudInvId)
    .reduce((sum, l) => sum + arvutaKuumakseExact(l.principalEUR, l.annualRatePct, parseInt(l.termMonths) || 0), 0);

  const laenumaksedKokku = olemasolevadLaenudKuus + (loanStatus === "APPROVED" ? planeeritudLaenudKuus : 0);
  const tuludKokku = haldusKokku + laenumaksedKokku + muudTuludKokku;
  const valjaminekudKokku = kuludKokku + laenumaksedKokku;
  const vaheKommunaalJaMuuTulu = muudTuludKokku - kommunaalKokku;

  return {
    kommunaalKokku,
    haldusKokku,
    kommunaalPeriood,
    haldusPeriood,
    kuludKokku,
    muudTuludKokku,
    tuludKokku,
    olemasolevadLaenudKuus,
    planeeritudLaenudKuus,
    laenumaksedKokku,
    valjaminekudKokku,
    vaheKommunaalJaMuuTulu,
  };
}

// Remondifondi arvutus — keeruline, palju sisendeid
export function computeRemondifondiArvutus({
  saldoAlgusRaw,
  koguPind,
  periodiAasta,
  pangaKoef,
  kogumisViis,
  pangaMaarOverride,
  maarOverride,
  investments,
  loans,
  loanStatus,
  monthEq,
}) {
  const saldoAlgus = Math.round(parseFloat(String(saldoAlgusRaw).replace(",", ".")) || 0);
  const koikInv = investments;

  const isConditional = (inv) => (inv.fundingPlan || []).some(fp => fp.source === "Laen");
  const kindladInv = koikInv.filter(inv => !isConditional(inv));

  const computeRF = (investeeringud, stsenaariumiLaenud) => {
    // onLaen tuleneb tegelikest laenudest, mitte fundingPlan deklaratsioonist.
    // baseScenario saab tühja laenumassiivi → onLaen = false → kasutab ajajoone määra.
    const onLaen = stsenaariumiLaenud.some(l => l.sepiiriostudInvId);

    const investRemondifondist = investeeringud.reduce((sum, inv) =>
      sum + (inv.fundingPlan || [])
        .filter(fp => fp.source === "Remondifond")
        .reduce((s, fp) => s + Math.round(fp.amountEUR || 0), 0),
    0);

    const invDetail = investeeringud
      .map(inv => {
        const rfSumma = (inv.fundingPlan || [])
          .filter(fp => fp.source === "Remondifond")
          .reduce((s, fp) => s + Math.round(fp.amountEUR || 0), 0);
        if (rfSumma <= 0) return null;
        const nimetus = inv.name || "Investeering";
        const aasta = inv.plannedYear || periodiAasta;
        const kogumisaastad = Math.max(1, aasta - periodiAasta);
        return { nimetus, rfSumma, aasta, kogumisaastad };
      })
      .filter(Boolean)
      .sort((a, b) => a.aasta - b.aasta);

    let jaakSaldo = saldoAlgus;
    const invArvutusread = invDetail.map(d => {
      const saldost = Math.min(jaakSaldo, d.rfSumma);
      jaakSaldo = Math.max(0, jaakSaldo - d.rfSumma);
      const koguda = Math.max(0, d.rfSumma - saldost);
      const aastasKoguda = d.kogumisaastad > 0 ? koguda / d.kogumisaastad : koguda;
      return { ...d, saldost, koguda, aastasKoguda };
    });

    // Minimaalne püsiv RF määr: väikseim €/m²/a, mille korral saldo ei lange
    // ühegi aasta lõpus alla nulli. Aastapõhine ajajoon:
    //   saldo(y) = saldo(y-1) - outflow(y) + rate * koguPind
    //   nõue: saldo(y) >= 0 igal aastal
    let maarIlmaLaenuta = 0;
    if (koguPind > 0 && invDetail.length > 0) {
      const viimaneAasta = Math.max(periodiAasta, ...invDetail.map(d => d.aasta));
      const esimeneAasta = Math.min(periodiAasta, ...invDetail.map(d => d.aasta));
      // Grupeeri RF outflow aasta järgi
      const outflowByYear = {};
      for (const d of invDetail) { outflowByYear[d.aasta] = (outflowByYear[d.aasta] || 0) + d.rfSumma; }
      // Kogu kokku perioodi-eelsed outflow'd (investeeringud enne periodiAastat)
      let eelneOutflow = 0;
      for (let y = esimeneAasta; y < periodiAasta; y++) {
        eelneOutflow += outflowByYear[y] || 0;
      }
      // Leia minimaalne rate: iga aasta lõpuks peab saldo >= 0
      // saldo(y) = saldoAlgus + aastad * rate * koguPind - kumulatiivneOutflow >= 0
      // → rate >= (kumulatiivneOutflow - saldoAlgus) / (aastad * koguPind)
      let kumulatiivneOutflow = eelneOutflow;
      let maxRate = 0;
      for (let y = periodiAasta; y <= viimaneAasta; y++) {
        kumulatiivneOutflow += outflowByYear[y] || 0;
        const aastad = y - periodiAasta + 1;
        const vajalikRate = (kumulatiivneOutflow - saldoAlgus) / (aastad * koguPind);
        if (vajalikRate > maxRate) maxRate = vajalikRate;
      }
      maarIlmaLaenuta = Math.max(0, maxRate);
    }

    const planeeritudLaenumaksedKuus = stsenaariumiLaenud
      .filter(l => l.sepiiriostudInvId)
      .reduce((sum, l) => sum + arvutaKuumakse(l.principalEUR, l.annualRatePct, parseInt(l.termMonths) || 0), 0);
    const olemasolevLaenumaksedKuus = loans
      .filter(l => !l.sepiiriostudInvId)
      .reduce((sum, l) => sum + arvutaKuumakse(l.principalEUR, l.annualRatePct, parseInt(l.termMonths) || 0), 0);
    const laenumaksedKuus = planeeritudLaenumaksedKuus + olemasolevLaenumaksedKuus;
    const laenumakseM2Kuus = koguPind > 0 ? planeeritudLaenumaksedKuus / koguPind : 0;

    const soovitusMaarAastasM2 = laenumakseM2Kuus * pangaKoef * 12;
    const maarLaenuga = pangaMaarOverride != null
      ? pangaMaarOverride
      : soovitusMaarAastasM2;

    // Kanoniline kuumäär: ümardatud üles 0.01 €/m²/kuu täpsusega.
    // Kõik nähtavad summad tuleb sellest tuletada.
    // Käsitsi override on juba kasutaja valitud kuumäär — ei ümarda üles.
    const maarKuusM2 = maarOverride != null
      ? maarOverride
      : Math.ceil((onLaen ? maarLaenuga : maarIlmaLaenuta) / 12 * 100) / 100;
    const maarAastasM2 = maarKuusM2 * 12;
    const mEq = monthEq || 12;
    const laekuminePerioodis = Math.round(maarAastasM2 * koguPind * mEq / 12);
    const saldoLopp = saldoAlgus + laekuminePerioodis - investRemondifondist;
    const tase = !onLaen
      ? (maarKuusM2 <= 0 ? "puudub"
        : maarKuusM2 <= 1.5 ? "normaalne"
        : maarKuusM2 <= 3.0 ? "korgendatud"
        : "kriitiline")
      : "normaalne";

    return {
      saldoAlgus, maarAastasM2, maarIlmaLaenuta, maarLaenuga,
      soovitusMaarAastasM2, koguPind, laekuminePerioodis,
      investRemondifondist, saldoLopp, onLaen, invDetail, invArvutusread,
      laenumaksedKuus, planeeritudLaenumaksedKuus, olemasolevLaenumaksedKuus,
      laenumakseM2Kuus, maarKuusM2, tase,
      maarSoovituslik: maarIlmaLaenuta,
      kasitsiMaar: maarOverride != null,
    };
  };

  const koikInvLaenud = loans.filter(l =>
    koikInv.some(inv => inv.id === l.sepiiriostudInvId || inv.sourceRefId === l.sepiiriostudInvId)
  );
  const kindladInvLaenud = loans.filter(l =>
    kindladInv.some(inv => inv.id === l.sepiiriostudInvId || inv.sourceRefId === l.sepiiriostudInvId)
  );

  const loanScenario = computeRF(koikInv, koikInvLaenud);
  // baseScenario: kõik investeeringud (sh segarahastuse RF osa), aga laenud ainult kindlatelt
  const baseScenario = computeRF(koikInv, kindladInvLaenud);
  const active = loanStatus === "APPROVED" ? loanScenario : baseScenario;

  return {
    ...active,
    baseScenario,
    loanScenario,
    loanApproved: loanStatus === "APPROVED",
  };
}
