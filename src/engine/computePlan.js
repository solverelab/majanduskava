// src/engine/computePlan.js

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const N = (v) => Number(v) || 0;
import { compareInvestmentsCanonical } from "../utils/sortInvestments";
import { isInvestmentReady } from "../utils/investmentInclusion";
import { getEffectiveAllocationBasis } from "../domain/planSchema";

const RISK_LIMITS = {
  loanWarnPerM2: 0.5,
  loanErrorPerM2: 1.0,
  ownersWarnPerM2: 1.5,
  ownersErrorPerM2: 2.5,
};

function daysBetween(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}
function monthEquiv(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return (d2.getFullYear() - d1.getFullYear()) * 12
    + (d2.getMonth() - d1.getMonth())
    + (d2.getDate() - d1.getDate()) / 30;
}
function yearFraction(a, b) { return monthEquiv(a, b) / 12; }

export function euro(n) {
  const rounded = Math.round(Number(n) || 0);
  const abs = Math.abs(rounded);
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (rounded < 0 ? "−" : "") + grouped + " \u20ac";
}

function calcRowPeriodEUR(row, yearFrac, monthEq) {
  const calc = row?.calc || {};
  const p = calc.params || {};
  switch (calc.type) {
    case "FIXED_PERIOD":      return round2(N(p.amountEUR));
    case "MONTHLY_FIXED":     return round2(N(p.monthlyEUR) * monthEq);
    case "ANNUAL_FIXED":      return round2(N(p.annualEUR) * yearFrac);
    case "QTY_PRICE_ANNUAL":  return round2(N(p.qty) * N(p.unitEUR) * yearFrac);
    default:                  return 0;
  }
}

function generateLoanSchedule(principal, annualRate, months, type, startYM) {
  const r = annualRate / 100 / 12;
  const schedule = [];
  let balance = principal;

  for (let t = 1; t <= months; t++) {
    const interest = round2(balance * r);
    let princ;

    if (String(type).toLowerCase() === "annuity") {
      const annuity = r > 0
        ? round2(principal * r / (1 - Math.pow(1 + r, -months)))
        : round2(principal / months);
      princ = round2(annuity - interest);
    } else {
      princ = round2(principal / months);
    }

    const total = round2(princ + interest);
    balance = round2(balance - princ);

    const d = new Date(startYM + "-01");
    d.setMonth(d.getMonth() + t - 1);

    schedule.push({
      month: t,
      date: d.toISOString().slice(0, 7),
      principal: princ,
      interest,
      total,
      balance: Math.max(0, balance),
    });
  }

  return schedule;
}

function loanServiceInPeriod(schedule, start, end) {
  const ps = String(start).slice(0, 7), pe = String(end).slice(0, 7);
  return schedule
    .filter(r => r.date >= ps && r.date <= pe)
    .reduce((s, r) => ({
      principal: s.principal + r.principal,
      interest: s.interest + r.interest,
      total: s.total + r.total,
    }), { principal: 0, interest: 0, total: 0 });
}

function sumFundingBySource(fundingPlan = [], source) {
  return round2((fundingPlan || [])
    .filter(x => x?.source === source)
    .reduce((s, x) => s + N(x.amountEUR), 0));
}

function issue(severity, message, code, section, extra = {}) {
  const f = { severity, message, code, section };
  if (extra.facts) f.facts = extra.facts;
  if (extra.thresholds) f.thresholds = extra.thresholds;
  if (extra.marginToThreshold) f.marginToThreshold = extra.marginToThreshold;
  if (extra.remedyHints) f.remedyHints = extra.remedyHints;
  return f;
}

// v1 Tee1: “liigiti” tugi (kulud) + tulude kategooriad + fondide closing + investeeringute normid
export function computePlan(plan) {
  const p = plan || {};
  const period = p.period || {};
  const building = p.building || {};
  const budget = p.budget || { costRows: [], incomeRows: [] };
  const investmentsPipeline = p.investments || p.investmentsPipeline || { items: [] };
  const funds = p.funds || { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } };
  const loans = p.loans || [];

  const days = daysBetween(period.start, period.end);
  const monthEq = Math.max(0.001, monthEquiv(period.start, period.end));
  const yearFrac = Math.max(0.001, yearFraction(period.start, period.end));

  const apartments = building.apartments || [];
  const totAreaM2 = round2(apartments.reduce((s, a) => s + N(a?.areaM2), 0));
  const apartmentsCount = apartments.length;

  // --- Costs / incomes ---
  const costRows = budget.costRows || [];
  const incomeRows = budget.incomeRows || [];

  const costPeriodEUR = round2(costRows.reduce((s, r) => s + calcRowPeriodEUR(r, yearFrac, monthEq), 0));
  const incomePeriodEUR = round2(incomeRows.reduce((s, r) => s + calcRowPeriodEUR(r, yearFrac, monthEq), 0));

  const costMonthlyEUR = round2(costPeriodEUR / monthEq);
  const incomeMonthlyEUR = round2(incomePeriodEUR / monthEq);

  const netOperationalPeriodEUR = round2(costPeriodEUR - incomePeriodEUR);
  const netOperationalMonthlyEUR = round2(netOperationalPeriodEUR / monthEq);

  // --- “liigiti”: costs by category (KrtS §41 loogika) ---
  const costByCategory = {};
  for (const r of costRows) {
    const cat = r?.legal?.category || "UNSPECIFIED";
    const amt = calcRowPeriodEUR(r, yearFrac, monthEq);
    costByCategory[cat] = round2(N(costByCategory[cat]) + amt);
  }

  // --- Incomes by category (OWNERS_PAYMENTS vs other) ---
  const incomeByCategory = {};
  for (const r of incomeRows) {
    const cat = r?.legal?.category || "OTHER";
    const amt = calcRowPeriodEUR(r, yearFrac, monthEq);
    incomeByCategory[cat] = round2(N(incomeByCategory[cat]) + amt);
  }
  const ownersPaymentsPeriodEUR = round2(N(incomeByCategory.OWNERS_PAYMENTS));
  const otherIncomePeriodEUR = round2(incomePeriodEUR - ownersPaymentsPeriodEUR);
  const otherIncomeMonthlyEUR = round2(otherIncomePeriodEUR / monthEq);

  // --- Investments (this year) ---
  const year = N(period.year);
  const items = investmentsPipeline.items || [];
  const thisYearItems = items.filter(it => N(it?.plannedYear) === year);
  const readyThisYear = thisYearItems
    .filter(isInvestmentReady)
    .sort(compareInvestmentsCanonical);
  const thisYearCount = readyThisYear.length;
  const costThisYearEUR = round2(thisYearItems.reduce((s, it) => s + N(it?.totalCostEUR), 0));

  // outflows for simplified fund closings (Tee 1)
  const rfOutflowThisYearEUR = round2(thisYearItems.reduce((s, it) => s + sumFundingBySource(it?.fundingPlan, "Remondifond"), 0));
  const reserveOutflowThisYearEUR = round2(thisYearItems.reduce((s, it) => s + sumFundingBySource(it?.fundingPlan, "RESERVE"), 0));
  const loanOutflowThisYearEUR = round2(
    thisYearItems.reduce((s, it) => s + ((it.fundingPlan || [])
      .filter(r => r.source === "Laen")
      .reduce((ss, r) => ss + (r.amountEUR || 0), 0)
    ), 0)
  );

  // --- Loans ---
  const loanItems = loans.map(ln => {
    const sched = generateLoanSchedule(
      N(ln.principalEUR),
      N(ln.annualRatePct),
      Math.max(0, Math.floor(N(ln.termMonths))),
      (ln.type || "annuity"),
      (ln.startYM || `${year}-01`)
    );
    const svc = loanServiceInPeriod(sched, period.start, period.end);
    const servicingPeriodEUR = round2(svc.total);
    const servicingMonthlyEUR = round2(servicingPeriodEUR / monthEq);
    const reservePeriodEUR = round2(servicingPeriodEUR * N(ln.reservePct) / 100);
    return { id: ln.id, servicingPeriodEUR, servicingMonthlyEUR, reservePeriodEUR };
  });

  const loanServicePeriodEUR = round2(loanItems.reduce((s, l) => s + N(l.servicingPeriodEUR), 0));
  const loanServiceMonthlyEUR = round2(loanServicePeriodEUR / monthEq);
  const loanReservePeriodEUR = round2(loanItems.reduce((s, l) => s + N(l.reservePeriodEUR), 0));
  const loanReserveMonthlyEUR = round2(loanReservePeriodEUR / monthEq);

  // --- Funds ---
  const rfRate = N(funds?.repairFund?.monthlyRateEurPerM2);
  const repairFundIncomePeriodEUR = round2(rfRate * totAreaM2 * monthEq);

  // Reserve requirement policy (1/12 annual obligations)
  const expAnnualOps = Math.max(0, netOperationalPeriodEUR) / yearFrac;
  const expAnnualLoan = loanServicePeriodEUR / yearFrac;
  const reserveRequiredEUR = round2((expAnnualOps + expAnnualLoan) / 12);

  const ownersNeedMonthlyEUR = round2(netOperationalMonthlyEUR + loanServiceMonthlyEUR + loanReserveMonthlyEUR);

  // simplified closing balances (Tee 1)
  const openingBalances = p.openingBalances || {};
  const repairFundOpeningEUR = N(openingBalances.repairFundEUR);
  const reserveOpeningEUR = N(openingBalances.reserveEUR);

  const reservePlannedEUR = N(funds?.reserve?.plannedEUR);

  const repairFundClosingEUR = round2(repairFundOpeningEUR + repairFundIncomePeriodEUR - rfOutflowThisYearEUR);
  const reserveClosingEUR = round2(reserveOpeningEUR + reservePlannedEUR - reserveOutflowThisYearEUR);

  // --- Repair fund shortfall & suggestions ---
  const rfShortfallEUR = repairFundClosingEUR < 0 ? round2(Math.abs(repairFundClosingEUR)) : 0;
  const rfSuggestedMonthlyRateEurPerM2 = (rfShortfallEUR > 0 && totAreaM2 > 0 && monthEq > 0)
    ? round2((rfShortfallEUR / (totAreaM2 * monthEq)) * 100) / 100 + rfRate
    : rfRate;
  const rfSuggestedOneOffTotalEUR = rfShortfallEUR;

  const maintenanceBasis = getEffectiveAllocationBasis(p.allocationPolicies?.maintenance);
  const repairFundBasis = getEffectiveAllocationBasis(p.allocationPolicies?.remondifond);
  const shareFor = (basis, apt) => {
    if (basis === "korter") return apartmentsCount > 0 ? 1 / apartmentsCount : 0;
    return totAreaM2 > 0 ? N(apt.areaM2) / totAreaM2 : 0;
  };

  const rfOneOffByApartment = apartments.map(a => {
    const share = shareFor(repairFundBasis, a);
    return { aptId: a.id, label: a.label, amountEUR: round2(rfShortfallEUR * share) };
  });

  // --- Apartment payments ---
  const rfMonthlyTotalEUR = rfRate * totAreaM2;
  const apartmentPayments = apartments.map(a => {
    const share = totAreaM2 > 0 ? N(a.areaM2) / totAreaM2 : 0;
    const maintShare = shareFor(maintenanceBasis, a);
    const rfShare = shareFor(repairFundBasis, a);
    const operationalMonthlyEUR = round2(ownersNeedMonthlyEUR * maintShare);
    const repairFundMonthlyEUR = round2(rfMonthlyTotalEUR * rfShare);
    const totalMonthlyEUR = round2(operationalMonthlyEUR + repairFundMonthlyEUR);
    return {
      aptId: a.id, label: a.label, areaM2: N(a.areaM2), share,
      operationalMonthlyEUR, repairFundMonthlyEUR, totalMonthlyEUR,
    };
  });

  // ===== RISKIANALÜÜS =====
  const totalLoanMonthlyEUR = round2(loanServiceMonthlyEUR + loanReserveMonthlyEUR);
  const loanBurdenEurPerM2 = totAreaM2 > 0 ? round2(totalLoanMonthlyEUR / totAreaM2) : 0;
  const ownersNeedEurPerM2 = totAreaM2 > 0 ? round2(ownersNeedMonthlyEUR / totAreaM2) : 0;

  // --- Controls / issues ---
  const issues = [];

  if (apartmentsCount < 1)
    issues.push(issue("ERROR", "Vähemalt 1 korter on nõutud.", "APT_MIN", "Periood & korterid"));
  if (totAreaM2 <= 0)
    issues.push(issue("ERROR", "Korterite kogupind peab olema > 0.", "AREA_ZERO", "Periood & korterid"));
  if (period.start && period.end && new Date(period.end) < new Date(period.start))
    issues.push(issue("ERROR", "Perioodi lõpp peab olema ≥ algus.", "PERIOD_INV", "Periood & korterid"));

  // KrtS §41 – kulud peavad olema olemas
  if ((budget.costRows || []).length === 0)
    issues.push(issue("ERROR", "Majandamiskulud (kulud) on sisestamata.", "NO_COSTS", "Kulud"));

  // “liigiti” praktiline kontroll: cost row category
  for (const r of costRows) {
    const cat = r?.legal?.category;
    if (!cat) {
      issues.push(issue("ERROR", `Kulureal "${r?.name || "?"}" puudub kategooria.`, "COST_CAT_MISSING", "Kulud"));
    } else if (cat === "OTHER") {
      issues.push(issue("WARN", `Kulurea "${r?.name || "?"}" kategooria on OTHER (kaalu täpsemat liigitust).`, "COST_CAT_OTHER", "Kulud"));
    }
  }

  // Tulud – kui puuduvad, siis warn (võib olla 0, aga märgi selgelt)
  if ((budget.incomeRows || []).length === 0)
    issues.push(issue("WARN", "Tulud on sisestamata (kui tulusid ei ole, jäta selge märge).", "NO_INCOME", "Tulud"));

  // Investeeringud – kui sellel aastal pole, lisa “dokumendilausena” info
  if (thisYearCount === 0) {
    issues.push(issue("INFO", "Perioodil ei ole valideeritud investeeringuid.", "INV_NONE_THIS_YEAR", "Investeeringud"));
  }

  // Investeeringute miinimumkontrollid (Tee 1)
  // readyThisYear on juba filtreeritud (ainult READY) ja sorteeritud (plannedYear ASC, totalCostEUR DESC, name ASC)
  for (const it of readyThisYear) {
    const name = String(it?.name || "").trim();
    const cost = N(it?.totalCostEUR);
    const fp = (it?.fundingPlan || []);
    const funded = round2(fp.reduce((s, r) => s + N(r.amountEUR), 0));

    if (!name) {
      issues.push(issue("ERROR", "Investeeringu nimetus on puudu.", "INV_NAME_MISSING", "Investeeringud"));
    }
    if (cost <= 0) {
      issues.push(issue("ERROR", `Investeering "${name || "?"}" maksumus peab olema > 0.`, "INV_COST_ZERO", "Investeeringud"));
    }

    if (cost > 0 && funded < cost)
      issues.push(issue("ERROR", `"${name || "?"}" rahastus (${euro(funded)}) < maksumus (${euro(cost)})`, "INV_UNDER", "Investeeringud"));
    if (cost > 0 && funded > cost)
      issues.push(issue("WARN", `"${name || "?"}" rahastus (${euro(funded)}) > maksumus (${euro(cost)})`, "INV_OVER", "Investeeringud"));

  }

  // Reserve check (Tee 1)
  if (reservePlannedEUR < reserveRequiredEUR && reserveRequiredEUR > 0)
    issues.push(issue("ERROR", `Reservkapital (${euro(reservePlannedEUR)}) < nõutav (${euro(reserveRequiredEUR)})`, "RESERVE_LOW", "Fondid & laen"));

  if (repairFundClosingEUR < 0)
    issues.push(issue("ERROR", `Remondifondi lõppjääk on negatiivne (${euro(repairFundClosingEUR)}).`, "RF_NEG", "Fondid & laen", {
      facts: { repairFundClosingEUR },
      thresholds: { minClosingEUR: 0 },
      marginToThreshold: { toZero: round2(0 - repairFundClosingEUR) },
      remedyHints: ["Tõsta remondifondi kuumäära.", "Vähenda investeeringute fondikasutust.", "Lisa ühekordne makse."],
    }));
  if (reserveClosingEUR < 0)
    issues.push(issue("ERROR", `Reservi lõppjääk on negatiivne (${euro(reserveClosingEUR)}).`, "RES_NEG", "Fondid & laen", {
      facts: { reserveClosingEUR, reserveRequiredEUR },
      thresholds: { minClosingEUR: 0 },
      marginToThreshold: { toZero: round2(0 - reserveClosingEUR) },
      remedyHints: ["Suurenda reservkapitali planeeritud laekumist.", "Vähenda reservist rahastatavaid investeeringuid."],
    }));

  if (ownersNeedMonthlyEUR < 0)
    issues.push(issue("WARN", "Kavandatavad tulud ületavad kulusid – tekib ülejääk (selgita kuhu jääk suunatakse).", "NET_SURPLUS", "Kontroll & kokkuvõte", {
      facts: { ownersNeedMonthlyEUR },
    }));

  // Laenukoormus risk
  if (loanBurdenEurPerM2 > RISK_LIMITS.loanErrorPerM2) {
    issues.push(issue("ERROR", `Laenukoormus ${loanBurdenEurPerM2} €/m²/kuu ületab kriitilise piiri`, "LOAN_BURDEN_HIGH", "Riskianalüüs", {
      facts: { loanBurdenEurPerM2 },
      thresholds: { warnPerM2: RISK_LIMITS.loanWarnPerM2, errorPerM2: RISK_LIMITS.loanErrorPerM2 },
      marginToThreshold: { overError: round2(loanBurdenEurPerM2 - RISK_LIMITS.loanErrorPerM2) },
      remedyHints: ["Pikenda laenu tähtaega.", "Vähenda laenusummat.", "Kasuta rohkem remondifondi."],
    }));
  } else if (loanBurdenEurPerM2 > RISK_LIMITS.loanWarnPerM2) {
    issues.push(issue("WARN", `Laenukoormus ${loanBurdenEurPerM2} €/m²/kuu on kõrge`, "LOAN_BURDEN_WARN", "Riskianalüüs", {
      facts: { loanBurdenEurPerM2 },
      thresholds: { warnPerM2: RISK_LIMITS.loanWarnPerM2, errorPerM2: RISK_LIMITS.loanErrorPerM2 },
      marginToThreshold: { toError: round2(RISK_LIMITS.loanErrorPerM2 - loanBurdenEurPerM2) },
    }));
  }
  // Omanike kogukoormus risk
  if (ownersNeedEurPerM2 > RISK_LIMITS.ownersErrorPerM2) {
    issues.push(issue("ERROR", `Omanike kogukoormus ${ownersNeedEurPerM2} €/m²/kuu ületab kriitilise piiri`, "OWNERS_BURDEN_HIGH", "Riskianalüüs", {
      facts: { ownersNeedEurPerM2 },
      thresholds: { warnPerM2: RISK_LIMITS.ownersWarnPerM2, errorPerM2: RISK_LIMITS.ownersErrorPerM2 },
      marginToThreshold: { overError: round2(ownersNeedEurPerM2 - RISK_LIMITS.ownersErrorPerM2) },
      remedyHints: ["Vähenda kulusid.", "Otsi lisatuluallikaid.", "Kaalutle laenu restruktureerimist."],
    }));
  } else if (ownersNeedEurPerM2 > RISK_LIMITS.ownersWarnPerM2) {
    issues.push(issue("WARN", `Omanike kogukoormus ${ownersNeedEurPerM2} €/m²/kuu on kõrge`, "OWNERS_BURDEN_WARN", "Riskianalüüs", {
      facts: { ownersNeedEurPerM2 },
      thresholds: { warnPerM2: RISK_LIMITS.ownersWarnPerM2, errorPerM2: RISK_LIMITS.ownersErrorPerM2 },
      marginToThreshold: { toError: round2(RISK_LIMITS.ownersErrorPerM2 - ownersNeedEurPerM2) },
    }));
  }

  const hasErrors = issues.some(i => i.severity === "ERROR");
  if (!hasErrors && (costRows.length > 0 || items.length > 0))
    issues.push(issue("INFO", "Kõik kontrollid läbitud!", "ALL_OK", "Kontroll & kokkuvõte"));

  return {
    period: { days, monthEq, yearFrac, year },
    building: { totAreaM2, apartmentsCount },

    investments: {
      thisYearCount,
      costThisYearEUR,
      rfOutflowThisYearEUR,
      reserveOutflowThisYearEUR,
      loanOutflowThisYearEUR,
      // UI jaoks: “dokumendilausena”
      noteThisYear: thisYearCount === 0 ? "Perioodil ei ole valideeritud investeeringuid." : null,
    },

    totals: {
      costPeriodEUR, costMonthlyEUR,
      incomePeriodEUR, incomeMonthlyEUR,
      ownersPaymentsPeriodEUR,
      otherIncomePeriodEUR, otherIncomeMonthlyEUR,
      netOperationalPeriodEUR, netOperationalMonthlyEUR,
      ownersNeedMonthlyEUR,

      costByCategory,
      incomeByCategory,
    },

    funds: {
      repairFundIncomePeriodEUR,
      reservePlannedEUR,
      reserveRequiredEUR,

      repairFundOpeningEUR,
      repairFundClosingEUR,

      reserveOpeningEUR,
      reserveClosingEUR,
      repairFundShortfallEUR: rfShortfallEUR,
      repairFundSuggestedMonthlyRateEurPerM2: rfSuggestedMonthlyRateEurPerM2,
      repairFundSuggestedOneOffTotalEUR: rfSuggestedOneOffTotalEUR,
      repairFundSuggestedOneOffByApartment: rfOneOffByApartment,
    },

    loans: {
      items: loanItems,
      servicePeriodEUR: loanServicePeriodEUR,
      serviceMonthlyEUR: loanServiceMonthlyEUR,
      reservePeriodEUR: loanReservePeriodEUR,
      reserveMonthlyEUR: loanReserveMonthlyEUR,
    },

    apartmentPayments,

    risks: {
      loanBurdenEurPerM2,
      ownersNeedEurPerM2,
      totalLoanMonthlyEUR,
    },

    controls: { issues, hasErrors },
  };
}