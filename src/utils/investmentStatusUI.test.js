import { describe, it, expect } from "vitest";
import { investmentStatus } from "./majanduskavaCalc";

/**
 * Tests the UI signal logic extracted from MajanduskavaApp.jsx coverage display blocks
 * (condition-item ~L1939-1949, standalone ~L2028-2038).
 *
 * Both blocks share identical logic:
 *   const status = investmentStatus(inv);
 *   if (status === "DRAFT") return null;                          // no indicator
 *   color: status === "BLOCKED" ? "#c53030" : vahe === 0 ? N.text : N.sub
 */

const N = { text: "#222222", sub: "#666666" };
const BLOCKED_COLOR = "#c53030";

// Mirrors the inline coverage display logic from MajanduskavaApp.jsx
function coverageSignal(inv) {
  const status = investmentStatus(inv);
  if (status === "DRAFT") return { visible: true, indicator: null };

  const maksumus = inv.totalCostEUR || 0;
  const kaetud = (inv.fundingPlan || [])
    .filter(r => (r.source || "").trim() !== "")
    .reduce((s, fp) => s + (fp.amountEUR || 0), 0);
  const vahe = maksumus - kaetud;

  const color = status === "BLOCKED" ? BLOCKED_COLOR : vahe === 0 ? N.text : N.sub;

  let text;
  if (status === "BLOCKED" && vahe < 0) {
    text = `ületab`;
  } else if (vahe === 0) {
    text = "✓ Täielikult kaetud";
  } else {
    text = `katmata`;
  }

  return { visible: true, indicator: { color, text, status } };
}

const inv = (overrides) => ({
  name: "Katus — Remont",
  totalCostEUR: 50000,
  fundingPlan: [{ source: "Remondifond", amountEUR: 50000 }],
  ...overrides,
});

// ── DRAFT: visible, no indicator ──

describe("UI signal: DRAFT investment", () => {
  const draft = inv({ name: "", totalCostEUR: 0, fundingPlan: [] });

  it("DRAFT investment is visible (card renders)", () => {
    expect(coverageSignal(draft).visible).toBe(true);
  });

  it("DRAFT investment has no coverage indicator", () => {
    expect(coverageSignal(draft).indicator).toBeNull();
  });

  it("DRAFT with placeholder funding rows: still no indicator", () => {
    const d = inv({ name: "", fundingPlan: [{ source: "", amountEUR: 0 }] });
    expect(coverageSignal(d).indicator).toBeNull();
  });
});

// ── READY: visible, no BLOCKED signal ──

describe("UI signal: READY investment", () => {
  it("READY fully funded: visible with indicator", () => {
    const signal = coverageSignal(inv());
    expect(signal.visible).toBe(true);
    expect(signal.indicator).not.toBeNull();
  });

  it("READY fully funded: color is N.text (not red)", () => {
    expect(coverageSignal(inv()).indicator.color).toBe(N.text);
  });

  it("READY fully funded: shows success text", () => {
    expect(coverageSignal(inv()).indicator.text).toBe("✓ Täielikult kaetud");
  });

  it("READY partially funded: color is N.sub (not red)", () => {
    const partial = inv({ fundingPlan: [{ source: "Remondifond", amountEUR: 30000 }] });
    const signal = coverageSignal(partial);
    expect(signal.indicator.color).toBe(N.sub);
    expect(signal.indicator.color).not.toBe(BLOCKED_COLOR);
  });

  it("READY partially funded: shows katmata text", () => {
    const partial = inv({ fundingPlan: [{ source: "Remondifond", amountEUR: 30000 }] });
    expect(coverageSignal(partial).indicator.text).toBe("katmata");
  });

  it("READY: indicator status is not BLOCKED", () => {
    expect(coverageSignal(inv()).indicator.status).not.toBe("BLOCKED");
  });
});

// ── BLOCKED: visible, red error signal ──

describe("UI signal: BLOCKED investment", () => {
  const blocked = inv({
    totalCostEUR: 30000,
    fundingPlan: [
      { source: "Remondifond", amountEUR: 20000 },
      { source: "Laen", amountEUR: 15000 },
    ],
  });

  it("BLOCKED investment is visible", () => {
    expect(coverageSignal(blocked).visible).toBe(true);
  });

  it("BLOCKED investment has indicator (not null)", () => {
    expect(coverageSignal(blocked).indicator).not.toBeNull();
  });

  it("BLOCKED investment has red color #c53030", () => {
    expect(coverageSignal(blocked).indicator.color).toBe(BLOCKED_COLOR);
  });

  it("BLOCKED overfunded: shows ületab text", () => {
    expect(coverageSignal(blocked).indicator.text).toBe("ületab");
  });

  it("BLOCKED zero cost with real funding: red signal", () => {
    const zeroCost = inv({
      totalCostEUR: 0,
      fundingPlan: [{ source: "Laen", amountEUR: 10000 }],
    });
    expect(coverageSignal(zeroCost).indicator.color).toBe(BLOCKED_COLOR);
  });

  it("BLOCKED negative cost: red signal", () => {
    const neg = inv({ totalCostEUR: -100 });
    expect(coverageSignal(neg).indicator.color).toBe(BLOCKED_COLOR);
  });
});
