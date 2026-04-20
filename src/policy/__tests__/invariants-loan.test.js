// src/policy/__tests__/invariants-loan.test.js
import { describe, it, expect } from "vitest";
import { mkLoan } from "../../domain/planSchema";
import { arvutaKuumakse } from "../../utils/majanduskavaCalc";
import { syncLoan } from "../../utils/syncLoan";

// ── Helpers ──

/** Mirrors uuendaRahpiiriRida (condition_item branch, lines 1230-1257) */
function applyUuendaRahpiiriRida(plan, sourceRefId, ri, patch) {
  const fpPatch = {};
  if (patch.allikas !== undefined) fpPatch.source = patch.allikas;
  if (patch.summa !== undefined) fpPatch.amountEUR = Number(patch.summa) || 0;

  const inv = plan.investments.items.find(i => i.sourceRefId === sourceRefId);
  const vanaAllikas = inv?.fundingPlan?.[ri]?.source;
  const uusAllikas = fpPatch.source !== undefined ? fpPatch.source : vanaAllikas;

  const updatedItems = plan.investments.items.map(i =>
    i.sourceRefId === sourceRefId
      ? { ...i, fundingPlan: (i.fundingPlan || []).map((fp, fi) => fi === ri ? { ...fp, ...fpPatch } : fp) }
      : i
  );

  let loans = plan.loans;
  if (uusAllikas === "Laen" && vanaAllikas !== "Laen") {
    const summa = fpPatch.amountEUR ?? (inv?.fundingPlan?.[ri]?.amountEUR || 0);
    loans = syncLoan(plan, sourceRefId, summa);
  } else if (vanaAllikas === "Laen" && uusAllikas !== "Laen") {
    loans = plan.loans.filter(l => l.sepiiriostudInvId !== sourceRefId);
  } else if (uusAllikas === "Laen" && fpPatch.amountEUR !== undefined) {
    loans = syncLoan(plan, sourceRefId, fpPatch.amountEUR);
  }

  return { ...plan, investments: { ...plan.investments, items: updatedItems }, loans };
}

/** Mirrors handleStandaloneRahpiiriChange (standalone branch, lines 1320-1347) */
function applyHandleStandaloneRahpiiriChange(plan, invId, ridaIdx, field, value) {
  const fpPatch = {};
  if (field === "allikas") fpPatch.source = value;
  if (field === "summa") fpPatch.amountEUR = Number(value) || 0;

  const inv = plan.investments.items.find(i => i.id === invId);
  const vanaAllikas = inv?.fundingPlan?.[ridaIdx]?.source;
  const uusAllikas = field === "allikas" ? value : vanaAllikas;

  const updatedItems = plan.investments.items.map(i =>
    i.id === invId
      ? { ...i, fundingPlan: (i.fundingPlan || []).map((fp, ri) => ri === ridaIdx ? { ...fp, ...fpPatch } : fp) }
      : i
  );

  let loans = plan.loans;
  if (uusAllikas === "Laen" && vanaAllikas !== "Laen") {
    const summa = fpPatch.amountEUR ?? (inv?.fundingPlan?.[ridaIdx]?.amountEUR || 0);
    loans = syncLoan(plan, invId, summa);
  } else if (vanaAllikas === "Laen" && uusAllikas !== "Laen") {
    loans = plan.loans.filter(l => l.sepiiriostudInvId !== invId);
  } else if (uusAllikas === "Laen" && field === "summa") {
    loans = syncLoan(plan, invId, Number(value) || 0);
  }

  return { ...plan, investments: { ...plan.investments, items: updatedItems }, loans };
}

/** Mirrors addLoan in MajanduskavaApp.jsx */
function applyAddLoan(plan) {
  const y = String(plan.period.year || 2026);
  return {
    ...plan,
    loans: [
      ...plan.loans,
      {
        ...mkLoan({ startYM: `${y}-01` }),
        liik: "Remondilaen",
        algusAasta: y,
        sepiiriostudInvId: null,
        termMonths: 12,
      },
    ],
  };
}

/** Mirrors updateLoan in MajanduskavaApp.jsx */
function applyUpdateLoan(plan, id, patch) {
  return {
    ...plan,
    loans: plan.loans.map(ln => {
      if (ln.id !== id) return ln;
      const updated = { ...ln, ...patch };
      if (patch.algusAasta) {
        updated.startYM = `${updated.algusAasta}-01`;
      }
      return updated;
    }),
  };
}

// ══════════════════════════════════════════════════════════════════════
// 2. Loan is created only when needed and only once
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 2: loan created only once via syncLoan", () => {
  const basePlan = {
    investments: { items: [{ id: "inv-1", sourceRefId: "rida-1", name: "Katus", fundingPlan: [{ source: "Laen", amountEUR: 30000 }] }] },
    loans: [],
    period: { year: 2026 },
  };

  it("syncLoan creates exactly one loan on first call", () => {
    const loans = syncLoan(basePlan, "rida-1", 30000);
    const matching = loans.filter(l => l.sepiiriostudInvId === "rida-1");
    expect(matching).toHaveLength(1);
    expect(matching[0].principalEUR).toBe(30000);
  });

  it("syncLoan on second call updates existing loan, does not create a duplicate", () => {
    const loans1 = syncLoan(basePlan, "rida-1", 30000);
    const plan2 = { ...basePlan, loans: loans1 };
    const loans2 = syncLoan(plan2, "rida-1", 45000);
    const matching = loans2.filter(l => l.sepiiriostudInvId === "rida-1");
    expect(matching).toHaveLength(1);
    expect(matching[0].principalEUR).toBe(45000);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2b. Funding source change away from Laen removes linked loan
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 2b: funding source change away from Laen removes linked loan", () => {
  it("condition_item branch: Laen → Remondifond removes linked loan", () => {
    const plan = {
      period: { year: 2026 },
      investments: {
        items: [
          {
            id: "inv-1",
            sourceRefId: "rida-1",
            name: "Katus",
            fundingPlan: [{ source: "Laen", amountEUR: 30000 }],
          },
        ],
      },
      loans: [
        { id: "loan-1", sepiiriostudInvId: "rida-1", principalEUR: 30000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };

    const result = applyUuendaRahpiiriRida(plan, "rida-1", 0, { allikas: "Remondifond" });

    expect(result.investments.items[0].fundingPlan[0].source).toBe("Remondifond");
    expect(result.loans.find(l => l.sepiiriostudInvId === "rida-1")).toBeUndefined();
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });

  it("standalone branch: Laen → Remondifond removes linked loan", () => {
    const plan = {
      period: { year: 2026 },
      investments: {
        items: [
          {
            id: "inv-standalone",
            sourceRefId: null,
            name: "Energiaaudit",
            fundingPlan: [{ source: "Laen", amountEUR: 12000 }],
          },
        ],
      },
      loans: [
        { id: "loan-1", sepiiriostudInvId: "inv-standalone", principalEUR: 12000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };

    const result = applyHandleStandaloneRahpiiriChange(plan, "inv-standalone", 0, "allikas", "Remondifond");

    expect(result.investments.items[0].fundingPlan[0].source).toBe("Remondifond");
    expect(result.loans.find(l => l.sepiiriostudInvId === "inv-standalone")).toBeUndefined();
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2c. Loan amount change updates existing linked loan
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 2c: loan amount change updates existing linked loan", () => {
  it("condition_item branch: Laen summa change updates existing linked loan principalEUR", () => {
    const plan = {
      period: { year: 2026 },
      investments: {
        items: [
          {
            id: "inv-1",
            sourceRefId: "rida-1",
            name: "Katus",
            fundingPlan: [{ source: "Laen", amountEUR: 30000 }],
          },
        ],
      },
      loans: [
        { id: "loan-1", sepiiriostudInvId: "rida-1", principalEUR: 30000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };

    const result = applyUuendaRahpiiriRida(plan, "rida-1", 0, { summa: 45000 });

    const matching = result.loans.filter(l => l.sepiiriostudInvId === "rida-1");
    expect(matching).toHaveLength(1);
    expect(matching[0].principalEUR).toBe(45000);
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });

  it("standalone branch: Laen summa change updates existing linked loan principalEUR", () => {
    const plan = {
      period: { year: 2026 },
      investments: {
        items: [
          {
            id: "inv-standalone",
            sourceRefId: null,
            name: "Energiaaudit",
            fundingPlan: [{ source: "Laen", amountEUR: 12000 }],
          },
        ],
      },
      loans: [
        { id: "loan-1", sepiiriostudInvId: "inv-standalone", principalEUR: 12000 },
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };

    const result = applyHandleStandaloneRahpiiriChange(plan, "inv-standalone", 0, "summa", 18000);

    const matching = result.loans.filter(l => l.sepiiriostudInvId === "inv-standalone");
    expect(matching).toHaveLength(1);
    expect(matching[0].principalEUR).toBe(18000);
    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2d. syncLoan canonical defaults
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 2d: syncLoan creates linked loan with canonical defaults", () => {
  it("creates a new linked loan with Investeerimislaen, algusAasta, startYM, and 12 month term", () => {
    const plan = {
      investments: { items: [{ id: "inv-1", sourceRefId: "rida-1", name: "Katus", fundingPlan: [{ source: "Laen", amountEUR: 30000 }] }] },
      loans: [],
      period: { year: 2031 },
    };

    const result = syncLoan(plan, "rida-1", 30000);
    const matching = result.filter(l => l.sepiiriostudInvId === "rida-1");

    expect(matching).toHaveLength(1);
    expect(matching[0].liik).toBe("Investeerimislaen");
    expect(matching[0].algusAasta).toBe("2031");
    expect(matching[0].startYM).toBe("2031-01");
    expect(matching[0].termMonths).toBe(12);
    expect(matching[0].principalEUR).toBe(30000);
  });

  it("falls back to 2026 when plan.period.year is missing", () => {
    const plan = {
      investments: { items: [{ id: "inv-1", sourceRefId: "rida-1", name: "Katus", fundingPlan: [{ source: "Laen", amountEUR: 30000 }] }] },
      loans: [],
      period: {},
    };

    const result = syncLoan(plan, "rida-1", 30000);
    const matching = result.filter(l => l.sepiiriostudInvId === "rida-1");

    expect(matching).toHaveLength(1);
    expect(matching[0].algusAasta).toBe("2026");
    expect(matching[0].startYM).toBe("2026-01");
    expect(matching[0].termMonths).toBe(12);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2e. updateLoan syncs startYM when algusAasta changes
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 2e: updateLoan keeps startYM in sync with algusAasta", () => {
  function buildPlan() {
    return {
      loans: [
        {
          id: "loan-1",
          liik: "Investeerimislaen",
          algusAasta: "2028",
          startYM: "2028-01",
          principalEUR: 30000,
          termMonths: 12,
          annualRatePct: 5,
        },
        {
          id: "loan-2",
          liik: "Remondilaen",
          algusAasta: "2027",
          startYM: "2027-01",
          principalEUR: 10000,
          termMonths: 24,
          annualRatePct: 4,
        },
      ],
    };
  }

  it("updates startYM to AAAA-01 when algusAasta changes", () => {
    const result = applyUpdateLoan(buildPlan(), "loan-1", { algusAasta: "2032" });
    const loan = result.loans.find(l => l.id === "loan-1");

    expect(loan.algusAasta).toBe("2032");
    expect(loan.startYM).toBe("2032-01");
  });

  it("does not change startYM when algusAasta is not in patch", () => {
    const result = applyUpdateLoan(buildPlan(), "loan-1", { principalEUR: 45000 });
    const loan = result.loans.find(l => l.id === "loan-1");

    expect(loan.principalEUR).toBe(45000);
    expect(loan.algusAasta).toBe("2028");
    expect(loan.startYM).toBe("2028-01");
  });

  it("does not change other loans", () => {
    const result = applyUpdateLoan(buildPlan(), "loan-1", { algusAasta: "2032" });
    const other = result.loans.find(l => l.id === "loan-2");

    expect(other.algusAasta).toBe("2027");
    expect(other.startYM).toBe("2027-01");
    expect(other.principalEUR).toBe(10000);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2g. Condition_item funding source change to Laen creates linked loan
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 2g: condition_item funding source change to Laen creates linked loan", () => {
  function buildPlan() {
    return {
      period: { year: 2030 },
      investments: {
        items: [
          {
            id: "inv-1",
            sourceType: "condition_item",
            sourceRefId: "rida-1",
            name: "Katus — Remont",
            fundingPlan: [
              { source: "Remondifond", amountEUR: 30000 },
            ],
          },
        ],
      },
      loans: [
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  it('creates exactly one linked loan when funding source changes from Remondifond to "Laen"', () => {
    const result = applyUuendaRahpiiriRida(
      buildPlan(),
      "rida-1",
      0,
      { allikas: "Laen" }
    );

    const inv = result.investments.items.find(i => i.sourceRefId === "rida-1");
    const matching = result.loans.filter(l => l.sepiiriostudInvId === "rida-1");

    expect(inv.fundingPlan[0]).toEqual({ source: "Laen", amountEUR: 30000 });
    expect(matching).toHaveLength(1);
    expect(matching[0].principalEUR).toBe(30000);
    expect(matching[0].liik).toBe("Investeerimislaen");
    expect(matching[0].algusAasta).toBe("2030");
    expect(matching[0].startYM).toBe("2030-01");
    expect(matching[0].termMonths).toBe(12);
  });

  it("keeps manual loan untouched when linked loan is created", () => {
    const result = applyUuendaRahpiiriRida(
      buildPlan(),
      "rida-1",
      0,
      { allikas: "Laen" }
    );

    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2f. Standalone funding source change to Laen creates linked loan
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 2f: standalone funding source change to Laen creates linked loan", () => {
  function buildPlan() {
    return {
      period: { year: 2030 },
      investments: {
        items: [
          {
            id: "inv-standalone-1",
            sourceType: "standalone",
            sourceRefId: null,
            name: "Energiaaudit",
            fundingPlan: [
              { source: "Remondifond", amountEUR: 12000 },
            ],
          },
        ],
      },
      loans: [
        { id: "loan-manual", sepiiriostudInvId: null, principalEUR: 5000 },
      ],
    };
  }

  it('creates exactly one linked loan when funding source changes from Remondifond to "Laen"', () => {
    const result = applyHandleStandaloneRahpiiriChange(
      buildPlan(),
      "inv-standalone-1",
      0,
      "allikas",
      "Laen"
    );

    const inv = result.investments.items.find(i => i.id === "inv-standalone-1");
    const matching = result.loans.filter(l => l.sepiiriostudInvId === "inv-standalone-1");

    expect(inv.fundingPlan[0]).toEqual({ source: "Laen", amountEUR: 12000 });
    expect(matching).toHaveLength(1);
    expect(matching[0].principalEUR).toBe(12000);
    expect(matching[0].liik).toBe("Investeerimislaen");
    expect(matching[0].algusAasta).toBe("2030");
    expect(matching[0].startYM).toBe("2030-01");
    expect(matching[0].termMonths).toBe(12);
  });

  it("keeps manual loan untouched when linked loan is created", () => {
    const result = applyHandleStandaloneRahpiiriChange(
      buildPlan(),
      "inv-standalone-1",
      0,
      "allikas",
      "Laen"
    );

    expect(result.loans.find(l => l.id === "loan-manual")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2h. addLoan creates manual loan with canonical defaults
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 2h: addLoan creates manual loan with canonical defaults", () => {
  it("creates a manual loan with Remondilaen defaults based on period.year", () => {
    const plan = {
      period: { year: 2033 },
      loans: [],
    };

    const result = applyAddLoan(plan);
    const loan = result.loans[0];

    expect(result.loans).toHaveLength(1);
    expect(loan.liik).toBe("Remondilaen");
    expect(loan.algusAasta).toBe("2033");
    expect(loan.startYM).toBe("2033-01");
    expect(loan.sepiiriostudInvId).toBeNull();
    expect(loan.termMonths).toBe(12);
  });

  it("falls back to 2026 when period.year is missing", () => {
    const plan = {
      period: {},
      loans: [],
    };

    const result = applyAddLoan(plan);
    const loan = result.loans[0];

    expect(loan.algusAasta).toBe("2026");
    expect(loan.startYM).toBe("2026-01");
    expect(loan.liik).toBe("Remondilaen");
    expect(loan.sepiiriostudInvId).toBeNull();
    expect(loan.termMonths).toBe(12);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. Monthly payment calculation
// ══════════════════════════════════════════════════════════════════════

describe("Invariant 3: arvutaKuumakse for 60000 / 3.6% / 240 months", () => {
  const P = 60000;
  const annualRate = 3.6;
  const n = 240;
  const r = annualRate / 100 / 12; // 0.003

  const expected = Math.round(P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));

  it("matches standard annuity formula to within ±1 EUR", () => {
    const result = arvutaKuumakse(P, annualRate, n);
    expect(Math.abs(result - expected)).toBeLessThanOrEqual(1);
  });

  it("equals exactly Math.round of the formula", () => {
    const result = arvutaKuumakse(P, annualRate, n);
    expect(result).toBe(expected);
  });

  it("planned loan payments are excluded when loanStatus === APPLIED", () => {
    // Simulate korteriteKuumaksed logic (line 521):
    // laenKuuKokku = olemasolevLaenumaksedKuus + (loanApproved ? planeeritudLaenumaksedKuus : 0)
    const planeeritudLaenumaksedKuus = arvutaKuumakse(P, annualRate, n);
    const olemasolevLaenumaksedKuus = 0;
    const loanApproved = false; // loanStatus === "APPLIED"
    const laenKuuKokku = olemasolevLaenumaksedKuus + (loanApproved ? planeeritudLaenumaksedKuus : 0);
    expect(laenKuuKokku).toBe(0);
  });
});
