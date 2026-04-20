import { investmentStatus } from "./majanduskavaCalc";

// Aggregate totals/counts: READY + BLOCKED, not DRAFT
export function isInvestmentCounted(inv) {
  return investmentStatus(inv) !== "DRAFT";
}

// Recommendations/validation: only READY
export function isInvestmentRecommendable(inv) {
  return investmentStatus(inv) === "READY";
}

// thisYearCount, noteThisYear: only READY
export function isInvestmentReady(inv) {
  return investmentStatus(inv) === "READY";
}
