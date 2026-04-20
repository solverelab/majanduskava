import { describe, it, expect } from "vitest";
import { checkPlanConsistency } from "./planConsistency";

// ── Simulate uuendaSeisukord (same logic as App.jsx) ─────────────────────────

function applyUuendaSeisukord(plan, id, field, value) {
  const updatedCondition = (plan.assetCondition?.items || []).map(r =>
    r.id !== id ? r : { ...r, [field]: value }
  );

  const invPatch = {};
  if (field === "eeldatavKulu") invPatch.totalCostEUR = Number(value) || 0;
  if (field === "tegevusAasta") invPatch.plannedYear = Number(value) || 0;
  if (field === "ese" || field === "tegevus") {
    const rida = updatedCondition.find(r => r.id === id);
    if (rida) invPatch.name = rida.ese + (rida.tegevus ? " — " + rida.tegevus : "");
  }

  const hasInvPatch = Object.keys(invPatch).length > 0;
  const updatedInvestments = hasInvPatch
    ? {
        ...plan.investments,
        items: plan.investments.items.map(inv =>
          inv.sourceRefId !== id ? inv : { ...inv, ...invPatch }
        ),
      }
    : plan.investments;

  return {
    ...plan,
    assetCondition: { ...plan.assetCondition, items: updatedCondition },
    investments: updatedInvestments,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function mkPlan() {
  return {
    assetCondition: {
      items: [
        { id: "r1", ese: "Katus", tegevus: "Remont", tegevusAasta: "2028", eeldatavKulu: 50000 },
        { id: "r2", ese: "Fassaad", tegevus: "", tegevusAasta: "2029", eeldatavKulu: 30000 },
      ],
    },
    investments: {
      items: [
        {
          id: "inv-1", sourceType: "condition_item", sourceRefId: "r1",
          name: "Katus — Remont", plannedYear: 2028, totalCostEUR: 50000,
          fundingPlan: [{ source: "Laen", amountEUR: 30000 }, { source: "Remondifond", amountEUR: 20000 }],
        },
        {
          id: "inv-2", sourceType: "standalone", sourceRefId: null,
          name: "Lift", plannedYear: 2030, totalCostEUR: 80000,
          fundingPlan: [{ source: "Remondifond", amountEUR: 80000 }],
        },
      ],
    },
    loans: [
      { id: "loan-1", sepiiriostudInvId: "r1", principalEUR: 30000 },
    ],
  };
}

// ── Tests: uuendaSeisukord sync ──────────────────────────────────────────────

describe("uuendaSeisukord → investment sync", () => {
  it("eeldatavKulu muutus uuendab inv.totalCostEUR", () => {
    const plan = mkPlan();
    const result = applyUuendaSeisukord(plan, "r1", "eeldatavKulu", 75000);

    expect(result.assetCondition.items[0].eeldatavKulu).toBe(75000);
    const inv = result.investments.items.find(i => i.sourceRefId === "r1");
    expect(inv.totalCostEUR).toBe(75000);
  });

  it("tegevusAasta muutus uuendab inv.plannedYear", () => {
    const plan = mkPlan();
    const result = applyUuendaSeisukord(plan, "r1", "tegevusAasta", "2030");

    expect(result.assetCondition.items[0].tegevusAasta).toBe("2030");
    const inv = result.investments.items.find(i => i.sourceRefId === "r1");
    expect(inv.plannedYear).toBe(2030);
  });

  it("tegevus muutus uuendab inv.name", () => {
    const plan = mkPlan();
    const result = applyUuendaSeisukord(plan, "r1", "tegevus", "Täisremont");

    const inv = result.investments.items.find(i => i.sourceRefId === "r1");
    expect(inv.name).toBe("Katus — Täisremont");
  });

  it("ese muutus uuendab inv.name", () => {
    const plan = mkPlan();
    const result = applyUuendaSeisukord(plan, "r1", "ese", "Vihmaveesüsteem");

    const inv = result.investments.items.find(i => i.sourceRefId === "r1");
    expect(inv.name).toBe("Vihmaveesüsteem — Remont");
  });

  it("ei mõjuta standalone investeeringuid", () => {
    const plan = mkPlan();
    const result = applyUuendaSeisukord(plan, "r1", "eeldatavKulu", 99000);

    const standalone = result.investments.items.find(i => i.id === "inv-2");
    expect(standalone.totalCostEUR).toBe(80000); // unchanged
    expect(standalone.name).toBe("Lift"); // unchanged
  });

  it("ei mõjuta teist condition_item investeeringut", () => {
    // Add second condition_item
    const plan = mkPlan();
    plan.investments.items.push({
      id: "inv-r2", sourceType: "condition_item", sourceRefId: "r2",
      name: "Fassaad", plannedYear: 2029, totalCostEUR: 30000, fundingPlan: [],
    });

    const result = applyUuendaSeisukord(plan, "r1", "eeldatavKulu", 99000);
    const inv2 = result.investments.items.find(i => i.sourceRefId === "r2");
    expect(inv2.totalCostEUR).toBe(30000); // unchanged
  });

  it("mitte-inv välja muutus (nt puudused) ei muuda investeeringut", () => {
    const plan = mkPlan();
    const result = applyUuendaSeisukord(plan, "r1", "puudused", "Lekib");

    // investments should be same reference — no patch applied
    expect(result.investments).toBe(plan.investments);
  });
});

// ── Tests: checkPlanConsistency ──────────────────────────────────────────────

describe("checkPlanConsistency", () => {
  it("consistent plan returns no warnings", () => {
    const plan = mkPlan();
    expect(checkPlanConsistency(plan)).toEqual([]);
  });

  it("detects INV_AMOUNT_MISMATCH", () => {
    const plan = mkPlan();
    plan.assetCondition.items[0].eeldatavKulu = 99000; // mismatch with inv.totalCostEUR=50000
    const w = checkPlanConsistency(plan);
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe("INV_AMOUNT_MISMATCH");
    expect(w[0].conditionAmount).toBe(99000);
    expect(w[0].invAmount).toBe(50000);
  });

  it("detects INV_NAME_MISMATCH", () => {
    const plan = mkPlan();
    plan.investments.items[0].name = "Wrong name";
    const w = checkPlanConsistency(plan);
    expect(w.some(x => x.code === "INV_NAME_MISMATCH")).toBe(true);
  });

  it("detects INV_YEAR_MISMATCH", () => {
    const plan = mkPlan();
    plan.investments.items[0].plannedYear = 2099;
    const w = checkPlanConsistency(plan);
    expect(w.some(x => x.code === "INV_YEAR_MISMATCH")).toBe(true);
  });

  it("detects INV_ORPHAN_CONDITION", () => {
    const plan = mkPlan();
    plan.assetCondition.items = []; // remove condition items, leave investment
    const w = checkPlanConsistency(plan);
    expect(w.some(x => x.code === "INV_ORPHAN_CONDITION")).toBe(true);
  });

  it("detects LOAN_ORPHAN", () => {
    const plan = mkPlan();
    plan.investments.items = plan.investments.items.filter(i => i.sourceType !== "condition_item");
    const w = checkPlanConsistency(plan);
    expect(w.some(x => x.code === "LOAN_ORPHAN")).toBe(true);
  });

  it("detects FUNDING_PLAN_MISSING_LOAN", () => {
    const plan = mkPlan();
    plan.investments.items[0].fundingPlan = [{ source: "Remondifond", amountEUR: 50000 }]; // no Laen
    const w = checkPlanConsistency(plan);
    expect(w.some(x => x.code === "FUNDING_PLAN_MISSING_LOAN")).toBe(true);
  });

  it("ignores standalone investments", () => {
    const plan = mkPlan();
    plan.investments.items[1].name = "Totally different"; // standalone
    const w = checkPlanConsistency(plan);
    expect(w.filter(x => x.invId === "inv-2")).toHaveLength(0);
  });

  it("after uuendaSeisukord sync, plan stays consistent", () => {
    let plan = mkPlan();
    plan = applyUuendaSeisukord(plan, "r1", "eeldatavKulu", 75000);
    plan = applyUuendaSeisukord(plan, "r1", "tegevusAasta", "2030");
    plan = applyUuendaSeisukord(plan, "r1", "tegevus", "Täisremont");
    expect(checkPlanConsistency(plan)).toEqual([]);
  });
});
