import { describe, it, expect } from "vitest";
import { isInvestmentCounted, isInvestmentRecommendable, isInvestmentReady } from "./investmentInclusion";

const inv = (overrides) => ({
  name: "Katus",
  totalCostEUR: 50000,
  fundingPlan: [{ source: "Remondifond", amountEUR: 50000 }],
  ...overrides,
});

const draftInv = inv({ name: "", totalCostEUR: 0, fundingPlan: [] });
const readyInv = inv();
const blockedInv = inv({
  totalCostEUR: 30000,
  fundingPlan: [{ source: "Remondifond", amountEUR: 40000 }],
});

describe("isInvestmentCounted", () => {
  it("DRAFT => false", () => expect(isInvestmentCounted(draftInv)).toBe(false));
  it("READY => true", () => expect(isInvestmentCounted(readyInv)).toBe(true));
  it("BLOCKED => true", () => expect(isInvestmentCounted(blockedInv)).toBe(true));
});

describe("isInvestmentRecommendable", () => {
  it("DRAFT => false", () => expect(isInvestmentRecommendable(draftInv)).toBe(false));
  it("READY => true", () => expect(isInvestmentRecommendable(readyInv)).toBe(true));
  it("BLOCKED => false", () => expect(isInvestmentRecommendable(blockedInv)).toBe(false));
});

describe("isInvestmentReady", () => {
  it("DRAFT => false", () => expect(isInvestmentReady(draftInv)).toBe(false));
  it("READY => true", () => expect(isInvestmentReady(readyInv)).toBe(true));
  it("BLOCKED => false", () => expect(isInvestmentReady(blockedInv)).toBe(false));
});
