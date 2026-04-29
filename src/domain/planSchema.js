// src/domain/planSchema.js
const uid = () => Math.random().toString(36).slice(2, 9);

export function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function mkApartment({ label = "", areaM2 = 0, notes = "" } = {}) {
  return { id: uid(), label, areaM2, notes };
}

export function mkCashflowRow({
  side = "COST",
  name = "",
  category = "",
  utilityType = null,
  legal = { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
  calc = { type: "FIXED_PERIOD", params: { amountEUR: 0 } },
} = {}) {
  return { id: uid(), side, name, category, utilityType, legal, calc };
}

export function mkInvestmentItem({
  name = "",
  plannedYear = 0,
  totalCostEUR = 0,
} = {}) {
  return {
    id: uid(),
    name,
    plannedYear,
    totalCostEUR,
    fundingPlan: [],
  };
}

export function mkRfUsageItem({
  linkedAssetConditionId = null,
  remondifondistKaetavSumma = 0,
  markus = "",
} = {}) {
  return { id: uid(), linkedAssetConditionId, remondifondistKaetavSumma, markus };
}

export function mkLoan({
  name = "",
  principalEUR = 0,
  annualRatePct = 0,
  termMonths = 0,
  type = "annuity",
  startYM = "",
  reservePct = 0,
  sepiiriostudInvId = null,
  // Tab 2 metaandmed ja perioodikulu väljad
  laenuandja = "",
  laenuandjaKirjeldus = "",
  eesmärk = "",
  eesmärkKirjeldus = "",
  pohiosPerioodis = 0,
  intressPerioodis = 0,
  teenustasudPerioodis = 0,
  allocationBasis = "m2",
  legalBasisSeadus = true,
  legalBasisBylaws = false,
  legalBasisSpecialAgreement = false,
  legalBasisMuu = false,
  legalBasisTaepsustus = "",
} = {}) {
  return {
    id: uid(), name, principalEUR, annualRatePct, termMonths, type, startYM, reservePct, sepiiriostudInvId,
    laenuandja, laenuandjaKirjeldus, eesmärk, eesmärkKirjeldus,
    pohiosPerioodis, intressPerioodis, teenustasudPerioodis,
    allocationBasis, legalBasisSeadus, legalBasisBylaws, legalBasisSpecialAgreement, legalBasisMuu, legalBasisTaepsustus,
  };
}

export function defaultPlan({ year = new Date().getFullYear() } = {}) {
  return {
    profile: { name: "Korteriühistu majanduskava" },
    preparedAt: todayYmd(),
    period: {
      year,
      start: "",
      end: "",
    },
    building: {
      apartments: [],
    },
    budget: {
      costRows: [],
      incomeRows: [],
    },
    investments: {
      items: [],
    },
    assetCondition: {
      items: [],
    },
    funds: {
      repairFund: { monthlyRateEurPerM2: 0, usageItems: [] },
      reserve: { plannedEUR: 0 },
    },
    loans: [],
    removedDefaultKommunaalCategories: [],
    openingBalances: {
      repairFundEUR: 0,
      reserveEUR: 0,
    },
    draftApproval: {
      isLocked: false,
      lockedAt: null,
      stateSignature: null,
    },
    materialsPackage: {
      isCreated: false,
      createdAt: null,
      stateSignature: null,
      items: [],
    },
    writtenVotingPackage: {
      isCreated: false,
      createdAt: null,
      stateSignature: null,
      deadline: null,
      agendaItems: [],
      materialItems: [],
    },
    allocationPolicies: {
      maintenance: {
        defaultBasis: "m2",
        overrideBasis: null,
        legalBasis: null,
        legalBasisNote: "",
        legalBasisType: "DEFAULT_KRTS40_1",
        legalBasisText: "",
      },
      remondifond: {
        defaultBasis: "m2",
        overrideBasis: null,
        legalBasis: null,
        legalBasisNote: "",
        legalBasisType: "DEFAULT_KRTS40_1",
        legalBasisText: "",
      },
      reserve: {
        defaultBasis: "m2",
        overrideBasis: null,
        legalBasis: null,
        legalBasisNote: "",
        legalBasisType: "DEFAULT_KRTS40_1",
        legalBasisText: "",
      },
    },
  };
}

export function deriveLegalBasisType(policy) {
  return (policy?.overrideBasis && policy?.legalBasis) ? "BYLAWS_EXCEPTION" : "DEFAULT_KRTS40_1";
}

export function getEffectiveAllocationBasis(policy) {
  if (!policy) return "m2";
  if (policy.overrideBasis && policy.legalBasis) return policy.overrideBasis;
  return policy.defaultBasis || "m2";
}

export function patchAllocationPolicy(plan, key, patch) {
  const current = plan?.allocationPolicies?.[key] || {
    defaultBasis: "m2", overrideBasis: null, legalBasis: null, legalBasisNote: "",
  };
  return {
    ...plan,
    allocationPolicies: {
      ...(plan?.allocationPolicies || {}),
      [key]: { ...current, ...patch },
    },
  };
}