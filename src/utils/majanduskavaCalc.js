// src/utils/majanduskavaCalc.js
// Pure financial calculation functions extracted from MajanduskavaApp.jsx

export const KOMMUNAALTEENUSED = ["Soojus", "Vesi", "Kanalisatsioon", "Elekter", "Kütus", "Muu kommunaalteenus"];
export const HALDUSTEENUSED = [
  // Legacy values kept for backward compat with saved plans
  "Haldus", "Hooldus", "Muu haldusteenus",
  // Current Tab 2 haldus category values
  "Valitseja / halduri tasu", "Raamatupidamine", "Koristus", "Kindlustus",
  "Tehnosüsteemide hooldus", "Pangatasud", "Audit / revisjon", "Õigusabi",
  "Heakord", "Liftihooldus", "Tuleohutuse kontroll / hooldus", "Prügivedu", "Muu teenus",
];
export const LAENUMAKSED = ["Laenumakse"];

// KrtS § 41 lg 1 p 5 — kommunaalteenuste liigid.
// Kanoniline mapping: kategooria → utilityType.
// Alamliik (nt kütuse liik: gaas/pellet/puit) jääb vabatekstina name-väljale.
// Eraldi utilitySubtype välja ei lisata enne, kui see mõjutab arvutust või raportit.
export const UTILITY_TYPE_BY_CATEGORY = {
  "Soojus": "heat",
  "Kütus": "fuel",
  "Vesi": "water",
  "Kanalisatsioon": "sewer",
  "Elekter": "electricity",
  "Muu kommunaalteenus": "other",
};

// Tagastab rea utilityType: eksplitsiitne väli või category fallback.
export function utilityTypeForRow(row) {
  return row.utilityType || UTILITY_TYPE_BY_CATEGORY[row.category] || null;
}

// KrtS § 40 lg 2 kommunaalteenuste arveldusviiside kanooniline loend.
// "advance_*" — ettemaks; "posthoc_by_coownership_*" — pärast tegeliku kulu selgumist kaasomandi osa järgi;
// "posthoc_by_consumption_*" — tarbimismahu järgi (nõuab consumptionDeterminationMethod).
export const UTILITY_SETTLEMENT_MODES = [
  "advance_by_coownership",
  "posthoc_by_coownership_bylaws",
  "posthoc_by_coownership_agreement",
  "posthoc_by_consumption_bylaws",
  "posthoc_by_consumption_agreement",
];

// Tagastab true kui kommunaalrea arveldusmudel on konsistentne.
// Puuduv utilitySettlementMode loetakse "advance_by_coownership"-ks (legacy-ühilduvus).
export function kommunaalRowSettlementValid(r) {
  const mode = r.utilitySettlementMode || "advance_by_coownership";
  if (!UTILITY_SETTLEMENT_MODES.includes(mode)) return false;
  if (mode === "posthoc_by_consumption_bylaws" || mode === "posthoc_by_consumption_agreement") {
    if (!r.consumptionDeterminationMethod?.trim()) return false;
  }
  return true;
}

// Tagastab true kui kommunaalrea tasumiskord on posthoc (pärast tegeliku kulu selgumist).
// Kasutab utilitySettlementMode välja; langeb tagasi settledPostHoc boolean-ile legacy andmete puhul.
export function isUtilityPostHoc(row) {
  if (row.utilitySettlementMode) return row.utilitySettlementMode.startsWith("posthoc_");
  return row.settledPostHoc === true;
}

const _SETTLEMENT_LABELS = {
  posthoc_by_coownership_bylaws:    "Tasutakse pärast tegeliku kulu selgumist põhikirja alusel kaasomandi osa järgi",
  posthoc_by_coownership_agreement: "Tasutakse pärast tegeliku kulu selgumist kokkuleppe alusel kaasomandi osa järgi",
  posthoc_by_consumption_bylaws:    "Tasutakse pärast tegeliku kulu selgumist põhikirja alusel tarbitud teenuse mahu järgi",
  posthoc_by_consumption_agreement: "Tasutakse pärast tegeliku kulu selgumist kokkuleppe alusel tarbitud teenuse mahu järgi",
};

// Tagastab kommunaalrea posthoc teksti prindis. Tühi string kui ettemaks.
export function utilitySettlementLabel(row) {
  if (row.utilitySettlementMode) return _SETTLEMENT_LABELS[row.utilitySettlementMode] || "";
  if (row.settledPostHoc === true) return "Tasutakse pärast kulude suuruse selgumist";
  return "";
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
// Aktsepteerib MÕLEMAT sõnastikku ajutiselt: legacy "korter" (allocationPolicies kaudu)
// ja canonical "apartment" (rea-mudel allocationBasis). Backward-compat kiht, mitte
// uus paralleelne canonical mudel — eemaldatakse, kui allocationPolicies migreeritud.
export function jaotusalusSilt(jaotusalus) {
  if (jaotusalus === "korter" || jaotusalus === "apartment") return "Korteri kohta";
  if (jaotusalus === "muu" || jaotusalus === "other") return "Muu";
  return "Kaasomandi osa suurus"; // m2, kaasomand, null, undefined
}

// Reapõhise kulurea efektiivne jaotusalus (Valik B).
// Kui valitud alus erineb seadusjärgsest (m²) ja puudub õiguslik alus,
// tagastatakse kanoniliselt "m2". HALDUSTEENUSED on policy-põhised —
// nende jaoks kasuta getEffectiveAllocationBasis allocationPolicies pealt.
export function getEffectiveRowAllocationBasis(r) {
  const raw = r.allocationBasis || "m2";
  if (raw === "m2") return "m2";
  if (r.legalBasisBylaws || r.legalBasisSpecialAgreement) return raw;
  return "m2";
}

// Kulurea jaotusaluse osakaalu arvutus.
// Kanoniline tõekoht: kõik korteritele jaotamised kasutavad seda.
// Aktsepteerib mõlemat sõnastikku — vt jaotusalusSilt kommentaari.
export function kulureaOsa(jaotusalus, pind, koguPind, aptCount) {
  if (jaotusalus === "korter" || jaotusalus === "apartment") return aptCount > 0 ? 1 / aptCount : 0;
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
      isPostHoc: isUtilityPostHoc(r),
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
    .filter(k => KOMMUNAALTEENUSED.includes(k.kategooria) && !k.isPostHoc)
    .reduce((sum, k) => sum + (parseFloat(k.summaKuus) || 0), 0));

  const haldusKokku = Math.round(kulud
    .filter(k => HALDUSTEENUSED.includes(k.kategooria))
    .reduce((sum, k) => sum + (parseFloat(k.summaKuus) || 0), 0));

  const kommunaalPeriood = costRows
    .filter(r => KOMMUNAALTEENUSED.includes(r.category) && !isUtilityPostHoc(r))
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
  costRows = [],
  rfUsageItems = [],
  planeeritudKogumine = null,
  fondiMuuTulu = 0,
}) {
  const saldoAlgus = Math.round(parseFloat(String(saldoAlgusRaw).replace(",", ".")) || 0);
  const fondiMuuTuluRaw = Math.round(parseFloat(String(fondiMuuTulu || 0).replace(",", ".")) || 0);
  const koikInv = investments;

  const isConditional = (inv) => (inv.fundingPlan || []).some(fp => fp.source === "Laen");
  const kindladInv = koikInv.filter(inv => !isConditional(inv));

  const computeRF = (investeeringud, stsenaariumiLaenud) => {
    // onLaen tuleneb tegelikest laenudest, mitte fundingPlan deklaratsioonist.
    // baseScenario saab tühja laenumassiivi → onLaen = false.
    const onLaen = stsenaariumiLaenud.some(l => l.sepiiriostudInvId);

    const mEq = monthEq || 12;
    // periodLength >= 1 aastat; nextPeriood on sama pikk vahetult järel.
    // Puuduva/mittearvulise plannedYear-iga investeeringuid ei arvestata kummagi perioodi alla.
    const periodLength = Math.max(1, Math.floor(mEq / 12));
    const periodStartYear = periodiAasta;
    const periodEndYear = periodiAasta + periodLength - 1;
    const nextPeriodStartYear = periodEndYear + 1;
    const nextPeriodEndYear = periodEndYear + periodLength;

    const rfSumFromInv = (inv) =>
      (inv.fundingPlan || [])
        .filter(fp => fp.source === "Remondifond")
        .reduce((s, fp) => s + Math.round(fp.amountEUR || 0), 0);

    const investRemondifondist = investeeringud
      .filter(inv => typeof inv.plannedYear === "number" && inv.plannedYear >= periodStartYear && inv.plannedYear <= periodEndYear)
      .reduce((sum, inv) => sum + rfSumFromInv(inv), 0);

    const invNextPeriodRfVajadus = investeeringud
      .filter(inv => typeof inv.plannedYear === "number" && inv.plannedYear >= nextPeriodStartYear && inv.plannedYear <= nextPeriodEndYear)
      .reduce((sum, inv) => sum + rfSumFromInv(inv), 0);

    const rowToPeriodSum = (r) => {
      const val = parseFloat(String(r.summaInput || 0).replace(",", ".")) || 0;
      switch (r.arvutus) {
        case "kuus": return val * mEq;
        case "aastas": return val / 12 * mEq;
        case "perioodis": return val;
        default: return val * mEq;
      }
    };

    const rfCostRows = costRows.filter(r => r.fundingSource === "remondifond");
    const p2Remondifondist = Math.round(rfCostRows.reduce((sum, r) => sum + rowToPeriodSum(r), 0));
    const p2NextPeriodRfVajadus = Math.round(
      rfCostRows
        .filter(r => r.recursNextPeriod)
        .reduce((sum, r) => {
          const nextAmt = (r.nextPeriodAmount != null && r.nextPeriodAmount > 0)
            ? r.nextPeriodAmount
            : rowToPeriodSum(r);
          return sum + nextAmt;
        }, 0)
    );

    const nextPeriodRfVajadus = invNextPeriodRfVajadus + p2NextPeriodRfVajadus;

    const invDetail = investeeringud
      .map(inv => {
        const rfSumma = rfSumFromInv(inv);
        if (rfSumma <= 0) return null;
        const nimetus = inv.name || "Investeering";
        const aasta = typeof inv.plannedYear === "number" ? inv.plannedYear : periodiAasta;
        const kogumisaastad = Math.max(1, aasta - periodiAasta);
        return { nimetus, rfSumma, aasta, kogumisaastad };
      })
      .filter(Boolean)
      .sort((a, b) => a.aasta - b.aasta);

    const planeeritudLaenumaksedKuus = stsenaariumiLaenud
      .filter(l => l.sepiiriostudInvId)
      .reduce((sum, l) => sum + arvutaKuumakse(l.principalEUR, l.annualRatePct, parseInt(l.termMonths) || 0), 0);
    const olemasolevLaenumaksedKuus = loans
      .filter(l => !l.sepiiriostudInvId)
      .reduce((sum, l) => sum + arvutaKuumakse(l.principalEUR, l.annualRatePct, parseInt(l.termMonths) || 0), 0);
    const laenumaksedKuus = planeeritudLaenumaksedKuus + olemasolevLaenumaksedKuus;

    const plKogumine = planeeritudKogumine != null
      ? Math.round(parseFloat(String(planeeritudKogumine).replace(",", ".")) || 0) : null;
    const maarKuusM2Legacy = maarOverride ?? 0;
    const laekuminePerioodis = (plKogumine != null && plKogumine > 0)
      ? plKogumine
      : Math.round(maarKuusM2Legacy * 12 * koguPind * mEq / 12);
    const maarKuusM2 = (plKogumine != null && plKogumine > 0)
      ? (koguPind > 0 && mEq > 0 ? laekuminePerioodis / (koguPind * mEq) : 0)
      : maarKuusM2Legacy;
    const maarAastasM2 = maarKuusM2 * 12;
    const rfUsageRemondifondist = Math.round(rfUsageItems.reduce((s, it) => s + (parseFloat(it.remondifondistKaetavSumma) || 0), 0));
    const remondifondistKaetavadKokku = investRemondifondist + p2Remondifondist + rfUsageRemondifondist;
    const saldoLopp = saldoAlgus + laekuminePerioodis + fondiMuuTuluRaw - remondifondistKaetavadKokku;
    const katab = saldoLopp >= nextPeriodRfVajadus;

    return {
      saldoAlgus, maarAastasM2, koguPind, laekuminePerioodis,
      investRemondifondist, p2Remondifondist, rfUsageRemondifondist, remondifondistKaetavadKokku,
      nextPeriodRfVajadus, katab,
      saldoLopp, onLaen, invDetail,
      laenumaksedKuus, planeeritudLaenumaksedKuus, olemasolevLaenumaksedKuus,
      maarKuusM2,
      kasitsiMaar: maarOverride != null || (plKogumine != null && plKogumine > 0),
      fondiMuuTulu: fondiMuuTuluRaw,
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

// ── Kommunaalteenuste vaikimisi ühikud ja standardread ──────────────────────
export const KOMMUNAAL_VAIKE_UHIK = {
  "Kütus": "m³",
  "Soojus": "MWh",
  "Vesi": "m³",
  "Kanalisatsioon": "m³",
  "Elekter": "kWh",
};

// KrtS § 41 lg 1 p 5 — kütuse alamliigid ja nende ühikud.
export const FUEL_TYPES = ["Maagaas", "Pellet", "Hakkepuit", "Kütteõli", "Vedelgaas", "Muu"];
export const FUEL_TYPE_UNITS = {
  "Maagaas":   ["m³"],
  "Pellet":    ["t"],
  "Hakkepuit": ["t", "rm"],
  "Kütteõli":  ["l"],
  "Vedelgaas": ["l", "t"],
  "Muu":       [],
};

// KrtS § 41 lg 1 p 5 — kohustuslikud standardteenused uuel plaanil.
export const KOMMUNAAL_DEFAULT_CATEGORIES = ["Soojus", "Vesi", "Kanalisatsioon", "Elekter", "Kütus"];

const _uid = () => Math.random().toString(36).slice(2, 9);

// Creates a fully-initialised kommunaal cost row with isDefault: true.
export function makeKommunaalRow(category) {
  return {
    id: _uid(),
    side: "COST",
    category,
    name: category,
    utilityType: UTILITY_TYPE_BY_CATEGORY[category] || null,
    fuelType: null,
    kogus: "",
    uhik: KOMMUNAAL_VAIKE_UHIK[category] || "",
    uhikuHind: "",
    summaInput: 0,
    selgitus: "",
    isDefault: true,
    notApplicable: false,
    forecastAdjustmentEnabled: false,
    forecastAdjustmentType: null,
    forecastAdjustmentPercent: null,
    forecastAdjustmentNote: "",
    allocationBasis: "m2",
    legalBasisBylaws: false,
    legalBasisSpecialAgreement: false,
    allocationExplanation: "",
    settledPostHoc: false,
    utilitySettlementMode: "advance_by_coownership",
    consumptionDeterminationMethod: "",
    fundingSource: "eelarve",
    recursNextPeriod: false,
    nextPeriodAmount: null,
    legalBasisSeadus: true,
    legalBasisMuu: false,
    legalBasisTaepsustus: "",
    allocationBasisMuuKirjeldus: "",
    muuTeenusKirjeldus: "",
    legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
    calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } },
  };
}

// Migrates legacy "Vesi ja kanalisatsioon" category to "Vesi".
// Idempotent: no-op if no legacy row exists.
// Also updates removedDefaultKommunaalCategories if needed.
export function migrateLegacyKommunaalCategories(plan) {
  const costRows = plan.budget?.costRows || [];
  const removedCats = plan.removedDefaultKommunaalCategories || [];
  const hasLegacyRow = costRows.some(r => r.category === "Vesi ja kanalisatsioon");
  const hasLegacyRemoved = removedCats.includes("Vesi ja kanalisatsioon");
  if (!hasLegacyRow && !hasLegacyRemoved) return plan;
  const patch = {};
  if (hasLegacyRow) {
    patch.budget = {
      ...plan.budget,
      costRows: costRows.map(r =>
        r.category === "Vesi ja kanalisatsioon" ? { ...r, category: "Vesi" } : r
      ),
    };
  }
  if (hasLegacyRemoved) {
    const updated = removedCats
      .filter(c => c !== "Vesi ja kanalisatsioon")
      .concat(["Vesi", "Kanalisatsioon"]);
    patch.removedDefaultKommunaalCategories = [...new Set(updated)];
  }
  return { ...plan, ...patch };
}

// Idempotent: seeds missing standard kommunaalread into a plan without duplicating.
// Applies legacy category migration first.
// Respects plan.removedDefaultKommunaalCategories — categories the user has intentionally removed.
// "Tühjenda" resets removedDefaultKommunaalCategories: [] before calling this.
export function seedDefaultKommunaalRows(plan) {
  const migrated = migrateLegacyKommunaalCategories(plan);
  const removed = new Set(migrated.removedDefaultKommunaalCategories || []);
  const existing = new Set(
    (migrated.budget?.costRows || [])
      .filter(r => KOMMUNAAL_DEFAULT_CATEGORIES.includes(r.category))
      .map(r => r.category)
  );
  const missing = KOMMUNAAL_DEFAULT_CATEGORIES.filter(cat => !existing.has(cat) && !removed.has(cat));
  if (missing.length === 0) return migrated;
  return {
    ...migrated,
    budget: {
      ...migrated.budget,
      costRows: [...(migrated.budget?.costRows || []), ...missing.map(makeKommunaalRow)],
    },
  };
}

// Allowed allocation targets. "reserve" is intentionally excluded — reservkapital
// linking is a separate work block.
const INCOME_ALLOWED_TARGETS = new Set(["repairFund", "general", "other"]);

// Normalizes income row allocations.
// Primary source: incomeAllocations array (targets: repairFund | general | other).
// Empty / missing incomeAllocations = general KÜ income (valid, not an error).
// Legacy fallback: incomeUse / targetFund / fundDirectedAmount accepted for
//   repairFund and general only — any other target (e.g. reserve) is flagged as error.
// Returns { allocations, totalAllocated, unallocatedAmount, isDirected, isValid, errors }.
export function normalizeIncomeAllocations(row) {
  const rowSumma = Math.round(parseFloat(row.summaInput) || 0);

  if (Array.isArray(row.incomeAllocations) && row.incomeAllocations.length > 0) {
    const allocs = row.incomeAllocations;
    const errors = [];
    allocs.forEach(a => {
      const amt = parseFloat(a.amount) || 0;
      if (!a.target) {
        errors.push("Kõigil suunamistel peab olema sihtkoht.");
      } else if (a.target === "reserve") {
        errors.push("Reservkapitali suunamine ei ole selles tööplokis lubatud.");
      } else if (!INCOME_ALLOWED_TARGETS.has(a.target)) {
        errors.push("Kõigil suunamistel peab olema kehtiv sihtkoht.");
      }
      if (amt < 0) {
        errors.push("Summa ei tohi olla negatiivne.");
      } else if (!(amt > 0)) {
        errors.push("Kõigil suunamistel peab olema summa.");
      }
    });
    const totalAllocated = Math.round(allocs.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0));
    if (errors.length === 0 && rowSumma > 0 && totalAllocated !== rowSumma)
      errors.push("Suunatud summad peavad kokku andma kogu tulu summa.");
    return {
      allocations: allocs,
      totalAllocated,
      unallocatedAmount: rowSumma - totalAllocated,
      isDirected: true,
      isValid: errors.length === 0,
      errors,
    };
  }

  // Legacy fallback: old incomeUse/targetFund/fundDirectedAmount model.
  // Only repairFund and general are supported; other targets (e.g. reserve) are flagged.
  if (row.incomeUse === "fund" && row.targetFund) {
    if (!INCOME_ALLOWED_TARGETS.has(row.targetFund)) {
      return {
        allocations: [],
        totalAllocated: 0,
        unallocatedAmount: rowSumma,
        isDirected: false,
        isValid: false,
        errors: [`Legacy suunamine sihtkohale "${row.targetFund}" ei ole toetatud.`],
      };
    }
    const directed = (row.fundDirectedAmount !== "" && row.fundDirectedAmount != null)
      ? Math.round(parseFloat(row.fundDirectedAmount) || 0)
      : rowSumma;
    if (directed > rowSumma) {
      return {
        allocations: [],
        totalAllocated: 0,
        unallocatedAmount: rowSumma,
        isDirected: false,
        isValid: false,
        errors: [`Legacy fundDirectedAmount (${directed} €) ületab tulurea summa (${rowSumma} €).`],
      };
    }
    return {
      allocations: [{ id: "__legacy__", target: row.targetFund, amount: Math.max(0, directed), note: "" }],
      totalAllocated: Math.max(0, directed),
      unallocatedAmount: rowSumma - Math.max(0, directed),
      isDirected: true,
      isValid: true,
      errors: [],
    };
  }

  // General KÜ income — empty or absent incomeAllocations with no legacy fund directive.
  return {
    allocations: [],
    totalAllocated: 0,
    unallocatedAmount: rowSumma,
    isDirected: false,
    isValid: true,
    errors: [],
  };
}
