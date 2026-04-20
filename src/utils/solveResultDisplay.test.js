import { describe, it, expect } from "vitest";

// Mirrors the residual-problems display logic in MajanduskavaApp.jsx.
// Returns null (hidden) or { visible, errors, warnings, stepsTaken, fallbackMsg }
function computeResidualDisplay(solveAllResult, evaluation) {
  if (!solveAllResult) return null;
  if (solveAllResult.stoppedBecause === "NO_ACTIONS") return null;

  const remainingErrors = (evaluation?.findings ?? []).filter(f => f.severity === "error");
  const remainingWarnings = (evaluation?.findings ?? []).filter(f => f.severity === "warning");
  const hasProblems = remainingErrors.length > 0 || remainingWarnings.length > 0;

  return {
    visible: true,
    hasProblems,
    errors: remainingErrors.map(f => f.title || f.message),
    warnings: remainingWarnings.map(f => f.title || f.message),
    stepsTaken: solveAllResult.stop.stepsTaken,
    // fallback message shown when no specific findings remain
    fallbackMsg: hasProblems ? null : `Automaatne lahendamine lõppes (${solveAllResult.stop.stepsTaken} sammu tehtud). Konkreetseid jääkprobleeme ei tuvastatud — kontrolli kava käsitsi.`,
  };
}

// Mirrors solveStatus msg mapping in onSolveAll
function solveStatusMsg(stoppedBecause) {
  if (stoppedBecause === "NO_ACTIONS") return "Enam soovitusi pole.";
  if (stoppedBecause === "NO_PROGRESS") return "Lõpetan: risk ega hoiatused/vead ei paranenud.";
  if (stoppedBecause === "LOOP_GUARD") return "Lõpetan: korduv soovitus.";
  if (stoppedBecause === "MAX_STEPS") return "Lõpetan: max sammud täis.";
  if (stoppedBecause === "NO_CHOICE") return "Lõpetan: sobivat soovitust ei leitud.";
  return "Lõpetan: " + stoppedBecause;
}

describe("residual problems display after autoResolve", () => {
  it("NO_ACTIONS → blokk peidetud", () => {
    const result = computeResidualDisplay(
      { stoppedBecause: "NO_ACTIONS", stop: { reason: "NO_ACTIONS", stepsTaken: 3 } },
      { findings: [] }
    );
    expect(result).toBeNull();
  });

  it("LOOP_GUARD + remaining findings → blokk nähtav, findings kuvatud", () => {
    const result = computeResidualDisplay(
      { stoppedBecause: "LOOP_GUARD", stop: { reason: "LOOP_GUARD", stepsTaken: 5 } },
      { findings: [
        { severity: "error", message: "Remondifond on negatiivne" },
        { severity: "warning", message: "Omanike koormus kõrge" },
        { severity: "info", message: "Info" },
      ]}
    );
    expect(result.visible).toBe(true);
    expect(result.hasProblems).toBe(true);
    expect(result.errors).toEqual(["Remondifond on negatiivne"]);
    expect(result.warnings).toEqual(["Omanike koormus kõrge"]);
    expect(result.stepsTaken).toBe(5);
    expect(result.fallbackMsg).toBeNull();
  });

  it("MAX_STEPS + findings puudub → blokk nähtav ausa staatuse teatega", () => {
    const result = computeResidualDisplay(
      { stoppedBecause: "MAX_STEPS", stop: { reason: "MAX_STEPS", stepsTaken: 10 } },
      { findings: [{ severity: "info", message: "Info" }] }
    );
    expect(result.visible).toBe(true);
    expect(result.hasProblems).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fallbackMsg).toContain("10 sammu tehtud");
    expect(result.fallbackMsg).toContain("kontrolli kava käsitsi");
  });

  it("LOOP_GUARD + empty findings → blokk nähtav ausa staatuse teatega", () => {
    const result = computeResidualDisplay(
      { stoppedBecause: "LOOP_GUARD", stop: { reason: "LOOP_GUARD", stepsTaken: 3 } },
      { findings: [] }
    );
    expect(result.visible).toBe(true);
    expect(result.hasProblems).toBe(false);
    expect(result.fallbackMsg).toContain("3 sammu tehtud");
  });

  it("no solveAllResult (never ran) → peidetud", () => {
    expect(computeResidualDisplay(null, { findings: [] })).toBeNull();
  });
});

describe("NO_CHOICE status message", () => {
  it("NO_CHOICE ei anna edukat/valmis muljet", () => {
    const msg = solveStatusMsg("NO_CHOICE");
    expect(msg).not.toContain("Valmis");
    expect(msg).toContain("sobivat soovitust ei leitud");
  });

  it("NO_CHOICE residual blokk on nähtav", () => {
    const result = computeResidualDisplay(
      { stoppedBecause: "NO_CHOICE", stop: { reason: "NO_CHOICE", stepsTaken: 1 } },
      { findings: [] }
    );
    expect(result).not.toBeNull();
    expect(result.visible).toBe(true);
  });

  it("unknown reason ei anna Valmis muljet", () => {
    const msg = solveStatusMsg("SOMETHING_NEW");
    expect(msg).not.toBe("Valmis.");
    expect(msg).toContain("SOMETHING_NEW");
  });
});
