import { describe, it, expect } from "vitest";

// Mirrors the "Täisaasta" button logic in MajanduskavaApp.jsx
function applyTaisaasta(plan) {
  const y = plan.period.year;
  if (!y) return plan; // button not rendered
  if (plan.period.start && plan.period.end) return plan; // button not rendered
  return { ...plan, period: { ...plan.period, start: `${y}-01-01`, end: `${y}-12-31` } };
}

// Mirrors tabStatus[0] gate
function tabStatus0(plan) {
  const hasPeriod = plan.period.start && plan.period.end;
  const hasRealApt = plan.building.apartments.some(a => (parseFloat(a.areaM2) || 0) > 0);
  const hasAnyApt = plan.building.apartments.length > 0;
  return (hasPeriod && hasRealApt) ? "done" : (plan.period.start || plan.period.end || hasAnyApt) ? "partial" : "empty";
}

function basePlan(overrides = {}) {
  return {
    period: { year: 2027, start: "", end: "" },
    building: { apartments: [{ id: "a1", label: "1", areaM2: 52.3 }] },
    ...overrides,
  };
}

describe("Täisaasta shortcut", () => {
  it("fills start and end from period.year", () => {
    const result = applyTaisaasta(basePlan());
    expect(result.period.start).toBe("2027-01-01");
    expect(result.period.end).toBe("2027-12-31");
    expect(result.period.year).toBe(2027);
  });

  it("does not fire when year is missing", () => {
    const plan = basePlan({ period: { year: 0, start: "", end: "" } });
    const result = applyTaisaasta(plan);
    expect(result.period.start).toBe("");
    expect(result.period.end).toBe("");
  });

  it("does not fire when dates already filled", () => {
    const plan = basePlan({ period: { year: 2027, start: "2027-03-01", end: "2028-02-28" } });
    const result = applyTaisaasta(plan);
    expect(result.period.start).toBe("2027-03-01");
    expect(result.period.end).toBe("2028-02-28");
  });

  it("manual date change still works after shortcut", () => {
    let plan = applyTaisaasta(basePlan());
    // Simulate manual override of end date
    plan = { ...plan, period: { ...plan.period, end: "2027-06-30" } };
    expect(plan.period.start).toBe("2027-01-01");
    expect(plan.period.end).toBe("2027-06-30");
  });

  it("tab status becomes done after shortcut + real apartment", () => {
    const plan = applyTaisaasta(basePlan());
    expect(tabStatus0(plan)).toBe("done");
  });

  it("tab status stays partial without shortcut (no dates)", () => {
    expect(tabStatus0(basePlan())).toBe("partial");
  });
});
