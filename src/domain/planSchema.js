// src/domain/planSchema.js
const uid = () => Math.random().toString(36).slice(2, 9);

export function mkApartment({ label = "", areaM2 = 0, notes = "" } = {}) {
  return { id: uid(), label, areaM2, notes };
}

export function mkCashflowRow({
  side = "COST",
  name = "",
  legal = { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
  calc = { type: "FIXED_PERIOD", params: { amountEUR: 0 } },
} = {}) {
  return { id: uid(), side, name, legal, calc };
}

export function mkInvestmentItem({
  name = "",
  plannedYear = 2026,
  quarter = "Q1",
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
  name = "Laen",
  principalEUR = 50000,
  annualRatePct = 4.5,
  termMonths = 120,
  type = "annuity",
  startYM = "2026-01",
  reservePct = 10,
} = {}) {
  return { id: uid(), name, principalEUR, annualRatePct, termMonths, type, startYM, reservePct };
}

export function defaultPlan({ year = 2026 } = {}) {
  return {
    profile: { name: "Korteriühistu majanduskava" },
    period: {
      year,
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    },
    building: {
      apartments: [
        mkApartment({ label: "A1",  areaM2: 35.0 }),
        mkApartment({ label: "A2",  areaM2: 42.5 }),
        mkApartment({ label: "A3",  areaM2: 48.0 }),
        mkApartment({ label: "A4",  areaM2: 52.3 }),
        mkApartment({ label: "A5",  areaM2: 55.0 }),
        mkApartment({ label: "A6",  areaM2: 58.7 }),
        mkApartment({ label: "A7",  areaM2: 61.2 }),
        mkApartment({ label: "A8",  areaM2: 64.0 }),
        mkApartment({ label: "A9",  areaM2: 67.5 }),
        mkApartment({ label: "A10", areaM2: 70.0 }),
        mkApartment({ label: "A11", areaM2: 74.8 }),
        mkApartment({ label: "A12", areaM2: 78.0 }),
      ],
    },
    budget: {
      costRows: [
        mkCashflowRow({ side: "COST", name: "Haldus", legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null }, calc: { type: "MONTHLY_FIXED", params: { monthlyEUR: 350 } } }),
        mkCashflowRow({ side: "COST", name: "Koristus", legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null }, calc: { type: "MONTHLY_FIXED", params: { monthlyEUR: 180 } } }),
        mkCashflowRow({ side: "COST", name: "Prügivedu", legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null }, calc: { type: "MONTHLY_FIXED", params: { monthlyEUR: 95 } } }),
        mkCashflowRow({ side: "COST", name: "Vesi", legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null }, calc: { type: "MONTHLY_FIXED", params: { monthlyEUR: 220 } } }),
        mkCashflowRow({ side: "COST", name: "Elekter (üldala)", legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null }, calc: { type: "MONTHLY_FIXED", params: { monthlyEUR: 130 } } }),
        mkCashflowRow({ side: "COST", name: "Kindlustus", legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null }, calc: { type: "ANNUAL_FIXED", params: { annualEUR: 960 } } }),
      ],
      incomeRows: [
        mkCashflowRow({ side: "INCOME", name: "Halduskulu laekumine", legal: { bucket: "OPERATIONAL", category: "OTHER", targetedFund: null }, calc: { type: "MONTHLY_FIXED", params: { monthlyEUR: 1100 } } }),
      ],
    },
    investmentsPipeline: {
      items: [
        mkInvestmentItem({ name: "Katuse remont", plannedYear: year, quarter: "Q2", totalCostEUR: 25000 }),
      ],
    },
    funds: {
      repairFund: { monthlyRateEurPerM2: 0.50 },
      reserve: { plannedEUR: 5000 },
    },
    loans: [
      mkLoan({ name: "Renoveerimislaen", principalEUR: 30000, annualRatePct: 4.5, termMonths: 120, startYM: `${year}-01` }),
    ],
    openingBalances: {
      repairFundEUR: 2400,
      reserveEUR: 1500,
    },
  };
}