import { describe, it, expect } from "vitest";

// ── Simulate uuendaSeisukord (same logic as App.jsx lines 1049-1079) ─────────

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
          id: "inv-s", sourceType: "standalone", sourceRefId: null,
          name: "Lift", plannedYear: 2030, totalCostEUR: 80000,
          fundingPlan: [{ source: "Remondifond", amountEUR: 80000 }],
        },
      ],
    },
    loans: [
      { id: "loan-1", principalEUR: 30000, sepiiriostudInvId: "r1" },
      { id: "loan-s", principalEUR: 20000, sepiiriostudInvId: "inv-s" },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("assetCondition ↔ condition_item investment sync", () => {

  // 1. tegevuse muutus → inv.name
  it("tegevuse muutus uuendab condition_item investeeringu nime", () => {
    const result = applyUuendaSeisukord(mkPlan(), "r1", "tegevus", "Täisremont");
    const inv = result.investments.items.find(i => i.sourceRefId === "r1");
    expect(inv.name).toBe("Katus — Täisremont");
  });

  // 2. eeldatavKulu → inv.totalCostEUR
  it("eeldatava kulu muutus uuendab condition_item investeeringu totalCostEUR", () => {
    const result = applyUuendaSeisukord(mkPlan(), "r1", "eeldatavKulu", 75000);
    const inv = result.investments.items.find(i => i.sourceRefId === "r1");
    expect(inv.totalCostEUR).toBe(75000);
  });

  // 3. tegevusAasta → inv.plannedYear
  it("tegevusAasta muutus uuendab condition_item investeeringu plannedYear", () => {
    const result = applyUuendaSeisukord(mkPlan(), "r1", "tegevusAasta", "2031");
    const inv = result.investments.items.find(i => i.sourceRefId === "r1");
    expect(inv.plannedYear).toBe(2031);
  });

  // 4. standalone ei muutu
  it("standalone investeering ei muutu ühegi seisukorra rea muutuse peale", () => {
    const plan = mkPlan();
    const standalone = plan.investments.items.find(i => i.sourceType === "standalone");
    const fpBefore = JSON.parse(JSON.stringify(standalone.fundingPlan));

    let result = applyUuendaSeisukord(plan, "r1", "eeldatavKulu", 99000);
    result = applyUuendaSeisukord(result, "r1", "tegevus", "XXX");
    result = applyUuendaSeisukord(result, "r1", "tegevusAasta", "2035");

    const after = result.investments.items.find(i => i.sourceType === "standalone");
    expect(after.name).toBe("Lift");
    expect(after.totalCostEUR).toBe(80000);
    expect(after.plannedYear).toBe(2030);
    expect(after.fundingPlan).toEqual(fpBefore);
  });

  // 5. fundingPlan jääb samaks
  it("fundingPlan jääb seisukorra muudatusel täpselt samaks", () => {
    const plan = mkPlan();
    const fpBefore = JSON.parse(JSON.stringify(
      plan.investments.items.find(i => i.sourceRefId === "r1").fundingPlan
    ));

    let result = applyUuendaSeisukord(plan, "r1", "eeldatavKulu", 99000);
    result = applyUuendaSeisukord(result, "r1", "tegevus", "Uus tegevus");
    result = applyUuendaSeisukord(result, "r1", "tegevusAasta", "2032");

    const fpAfter = result.investments.items.find(i => i.sourceRefId === "r1").fundingPlan;
    expect(fpAfter).toEqual(fpBefore);
  });

  // 6. seotud laen jääb alles
  it("seotud laen jääb alles ja seos ei katke seisukorra muudatusel", () => {
    const plan = mkPlan();

    let result = applyUuendaSeisukord(plan, "r1", "eeldatavKulu", 99000);
    result = applyUuendaSeisukord(result, "r1", "tegevus", "Uus");

    expect(result.loans).toHaveLength(2);
    const loan = result.loans.find(l => l.id === "loan-1");
    expect(loan).toBeDefined();
    expect(loan.sepiiriostudInvId).toBe("r1");
    expect(loan.principalEUR).toBe(30000); // unchanged
  });

  // 7. muutmine ilma investeeringuta ei loo uut
  it("seisukorra rea muutmine ilma investeeringuta ei lisa investments.items rida", () => {
    const plan = mkPlan();
    // r2 has no linked investment
    expect(plan.investments.items.some(i => i.sourceRefId === "r2")).toBe(false);

    const result = applyUuendaSeisukord(plan, "r2", "eeldatavKulu", 99000);

    expect(result.investments.items.length).toBe(plan.investments.items.length);
    expect(result.investments.items.some(i => i.sourceRefId === "r2")).toBe(false);
  });

  // 8. idempotentne korduv kutse
  it("sama väärtusega korduv kutse ei tekita duplikaate ega muuda fundingPlan-i", () => {
    const plan = mkPlan();

    const r1 = applyUuendaSeisukord(plan, "r1", "tegevus", "Remont");
    const r2 = applyUuendaSeisukord(r1, "r1", "tegevus", "Remont");

    // Same number of investments
    expect(r2.investments.items.length).toBe(plan.investments.items.length);

    // Name unchanged (was already "Katus — Remont")
    const inv = r2.investments.items.find(i => i.sourceRefId === "r1");
    expect(inv.name).toBe("Katus — Remont");

    // fundingPlan identical
    const fpBefore = plan.investments.items.find(i => i.sourceRefId === "r1").fundingPlan;
    expect(inv.fundingPlan).toEqual(fpBefore);
  });
});
