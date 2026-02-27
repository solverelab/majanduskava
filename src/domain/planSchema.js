// src/domain/planSchema.js
const uid = () => Math.random().toString(36).slice(2, 9);

export function mkApartment({ label = "", areaM2 = 0, notes = "" } = {}) {
  return { id: uid(), label, areaM2, notes };
}

export function mkCashflowRow({
  side = "COST",
  name = "",
  category = "",
  legal = { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
  calc = { type: "FIXED_PERIOD", params: { amountEUR: 0 } },
} = {}) {
  return { id: uid(), side, name, category, legal, calc };
}

export function mkInvestmentItem({
  name = "",
  plannedYear = 2026,
  quarter = 1,
  totalCostEUR = 0,
  notes = "",
} = {}) {
  return {
    id: uid(),
    name,
    plannedYear,
    quarter,
    totalCostEUR,
    notes,
    fundingPlan: [],
  };
}

export function mkLoan({
  name = "",
  principalEUR = 0,
  annualRatePct = 0,
  termMonths = 0,
  type = "annuity",
  startYM = "",
  reservePct = 0,
} = {}) {
  return { id: uid(), name, principalEUR, annualRatePct, termMonths, type, startYM, reservePct };
}

export function defaultPlan({ year = 2026 } = {}) {
  return {
    profile: { name: "Korteriühistu majanduskava" },
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
    investmentsPipeline: {
      items: [],
    },
    funds: {
      repairFund: { monthlyRateEurPerM2: 0 },
      reserve: { plannedEUR: 0 },
    },
    loans: [],
    openingBalances: {
      repairFundEUR: 0,
      reserveEUR: 0,
    },
  };
}