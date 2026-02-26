// src/policy/__tests__/majanduskava.e2e.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createModuleHost } from "../../../packages/solvere-core/src/moduleHost";
import { createMajanduskavaRuntime } from "../../../solvere-modules/majanduskava/src/runtime";
import { FINDING_CODES, ACTION_CODES } from "../../../packages/solvere-core/src/registry";

function readFixture() {
  const fixturePath = path.resolve(__dirname, "../../../scripts/plan-fixture.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
}

const DETERMINISTIC_DEPS = { now: () => "2026-02-25T00:00:00.000Z" };

describe("Majanduskava — Solvere E2E smoke (v1)", () => {
  it("RF_NEG + INCREASE_REPAIR_FUND_RATE_SMALL patches monthlyRateEurPerM2 by +0.05", () => {
    const runtime = createMajanduskavaRuntime();
    const host = createModuleHost({
      module: runtime, preset: "BALANCED", deps: DETERMINISTIC_DEPS,
    });

    const plan = readFixture();
    const beforeRate = plan.funds.repairFund.monthlyRateEurPerM2;
    expect(typeof beforeRate).toBe("number");

    const res0 = host.run(plan);
    const rfFinding = res0.evaluation.findings.find((f) => f.code === FINDING_CODES.RF_NEG);
    expect(rfFinding, "RF_NEG finding must exist").toBeTruthy();

    const action = rfFinding!.actions?.find((a) => a.code === ACTION_CODES.INCREASE_REPAIR_FUND_RATE_SMALL);
    expect(action, "RF_NEG must offer INCREASE_REPAIR_FUND_RATE_SMALL").toBeTruthy();

    const res1 = host.applyActionAndRun(res0.state, action!);
    expect(res1.state.funds.repairFund.monthlyRateEurPerM2).toBeCloseTo(beforeRate + 0.05, 10);
  });

  it("RESERVE_LOW + SET_RESERVE_TO_REQUIRED sets plannedEUR to requiredEUR (from metrics)", () => {
    const runtime = createMajanduskavaRuntime();
    const host = createModuleHost({
      module: runtime, preset: "BALANCED", deps: DETERMINISTIC_DEPS,
    });

    const plan = readFixture();
    const res0 = host.run(plan);
    const requiredEUR = res0.metrics.funds.reserveRequiredEUR;
    expect(typeof requiredEUR).toBe("number");

    const finding = res0.evaluation.findings.find((f) => f.code === FINDING_CODES.RESERVE_LOW);
    expect(finding, "RESERVE_LOW finding must exist").toBeTruthy();

    const action = finding!.actions?.find((a) => a.code === ACTION_CODES.SET_RESERVE_TO_REQUIRED);
    expect(action, "RESERVE_LOW must offer SET_RESERVE_TO_REQUIRED").toBeTruthy();

    const res1 = host.applyActionAndRun(res0.state, action!);
    expect(res1.state.funds.reserve.plannedEUR).toBe(requiredEUR);
  });

  it("risk is present and has valid shape", () => {
    const runtime = createMajanduskavaRuntime();
    const host = createModuleHost({
      module: runtime, preset: "BALANCED", deps: DETERMINISTIC_DEPS,
    });

    const res = host.run(readFixture());

    expect(res.evaluation.risk).toBeTruthy();
    expect(res.evaluation.risk!.schemaVersion).toBe("risk/v1");
    expect(res.evaluation.risk!.score).toBeGreaterThanOrEqual(0);
    expect(res.evaluation.risk!.score).toBeLessThanOrEqual(100);
    expect(["low", "medium", "high"]).toContain(res.evaluation.risk!.level);
    expect(["A", "B", "C"]).toContain(res.evaluation.risk!.band);
    expect(typeof res.evaluation.risk!.reason).toBe("string");
  });

  it("CONSERVATIVE score >= BALANCED score for same plan", () => {
    const plan = readFixture();

    const balancedRuntime = createMajanduskavaRuntime();
    const balancedHost = createModuleHost({
      module: balancedRuntime, preset: "BALANCED", deps: DETERMINISTIC_DEPS,
    });
    const balancedRes = balancedHost.run(plan);

    const conservativeRuntime = createMajanduskavaRuntime();
    const conservativeHost = createModuleHost({
      module: conservativeRuntime, preset: "CONSERVATIVE", deps: DETERMINISTIC_DEPS,
    });
    const conservativeRes = conservativeHost.run(plan);

    expect(balancedRes.evaluation.risk).toBeTruthy();
    expect(conservativeRes.evaluation.risk).toBeTruthy();
    expect(conservativeRes.evaluation.risk!.score).toBeGreaterThanOrEqual(
      balancedRes.evaluation.risk!.score
    );
  });

  it("actions have riskScoreDelta impact computed", () => {
    const runtime = createMajanduskavaRuntime();
    const host = createModuleHost({
      module: runtime, preset: "BALANCED", deps: DETERMINISTIC_DEPS,
    });

    const res = host.run(readFixture());

    // Collect all actions across all findings
    const allActions = res.evaluation.findings.flatMap((f) => f.actions ?? []);
    expect(allActions.length).toBeGreaterThan(0);

    for (const action of allActions) {
      expect(action.impact, `${action.code} must have impact`).toBeTruthy();
      expect(typeof action.impact!.riskScoreDelta, `${action.code} riskScoreDelta must be number`).toBe("number");
      expect(typeof action.impact!.summary, `${action.code} summary must be string`).toBe("string");
    }
  });
});
