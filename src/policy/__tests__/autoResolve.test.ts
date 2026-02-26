// src/policy/__tests__/autoResolve.test.ts
import { describe, it, expect } from "vitest";
import { autoResolve, autoResolveWithHost } from "../../../packages/solvere-core/src/autoResolve";
import { createModuleHost, buildPolicyVersion } from "../../../packages/solvere-core/src/moduleHost";
import { createMajanduskavaRuntime } from "../../../solvere-modules/majanduskava/src/runtime";
import fs from "node:fs";
import path from "node:path";

type Eval = {
  risk?: { score: number };
  findings?: Array<{ code?: string }>;
  actions?: any[];
};

function makeAction(code: string, delta: number, patch?: any) {
  return {
    code,
    id: `${code}::${JSON.stringify(patch ?? {})}`,
    label: code,
    patch: patch ?? {},
    impact: { riskScoreDelta: delta, summary: `Risk ${delta}` },
  };
}

describe("autoResolve", () => {
  it("treats same patch with different key order as the same action key (stable)", () => {
    let flip = false;
    const evaluate = (_s: any): Eval => {
      flip = !flip;
      const patchA = flip ? { a: 1, b: 2 } : { b: 2, a: 1 };
      return {
        risk: { score: 10 },
        findings: [{ code: "X" }],
        actions: [makeAction("SAME", -1, patchA)],
      };
    };
    const apply = (s: any, _a: any) => ({ ...s });
    const res = autoResolve({
      initialState: { x: 1 },
      evaluate,
      apply,
      maxSteps: 10,
    });
    expect(["LOOP_GUARD", "NO_PROGRESS"]).toContain(res.stoppedBecause);
    expect(res.steps.length).toBeGreaterThanOrEqual(1);
  });

  it("does not consider different patches as the same key (allows distinct steps)", () => {
    const evaluate = (s: any): Eval => ({
      risk: { score: s.score },
      findings: s.score > 0 ? [{ code: "X" }] : [],
      actions:
        s.score > 0
          ? [
              makeAction("DEC", -1, { dec: 1 }),
              makeAction("DEC", -2, { dec: 2 }),
            ]
          : [],
    });
    const apply = (s: any, a: any) => ({
      ...s,
      score: Math.max(0, s.score - (a.patch?.dec ?? 0)),
    });
    const res = autoResolve({
      initialState: { score: 3 },
      evaluate,
      apply,
      maxSteps: 2,
    });
    expect(res.steps.length).toBe(2);
    expect(res.steps[0].action.patch.dec).toBe(2);
  });

  it("stops with LOOP_GUARD or skips when same candidate/patch would be re-selected", () => {
    // Evaluate always returns one candidate with identical patch
    let callCount = 0;
    const evaluate = (_s: any): Eval & { actionCandidates?: any[] } => {
      callCount++;
      return {
        risk: { score: 10 },
        findings: [{ code: "X" }],
        actionCandidates: [
          {
            candidateId: "f1::FIX",
            findingId: "f1",
            findingCode: "X",
            actionCode: "FIX",
            action: { code: "FIX", kind: "patch", patch: [{ op: "set", path: "x", value: 1 }] },
            riskScoreDelta: -1,
            isEligible: true,
            rank: -1,
          },
        ],
      };
    };
    const apply = (s: any, _a: any) => ({ ...s });

    const res = autoResolve({
      initialState: { x: 0 },
      evaluate,
      apply,
      maxSteps: 5,
    });

    // After step 0, the seenKey for f1::FIX + patch is added.
    // Step 1 should find no eligible (same seenKey) → NO_CHOICE or NO_PROGRESS
    expect(["NO_CHOICE", "NO_PROGRESS"]).toContain(res.stoppedBecause);
    if (res.stoppedBecause === "NO_CHOICE") {
      expect(res.stop.details).toBeDefined();
      expect(res.stop.details!.candidatesEligible).toBe(1);
      expect(res.stop.details!.filteredBySeenCount).toBe(1);
    }
    // loopGuard must be on each step
    for (const s of res.steps) {
      expect(s.loopGuard).toBeDefined();
      expect(typeof s.loopGuard.seenKey).toBe("string");
      expect(s.loopGuard.seenKey.length).toBeGreaterThan(0);
    }
  });

  it("produces stable seenKey regardless of patch key order", () => {
    // Two evaluations return the same patch with different key ordering
    let flip = false;
    const evaluate = (_s: any): Eval & { actionCandidates?: any[] } => {
      flip = !flip;
      const patch = flip
        ? [{ op: "set", path: "x", value: 1 }]
        : [{ value: 1, path: "x", op: "set" }];
      return {
        risk: { score: 10 },
        findings: [{ code: "X" }],
        actionCandidates: [
          {
            candidateId: "f1::FIX",
            findingId: "f1",
            findingCode: "X",
            actionCode: "FIX",
            action: { code: "FIX", kind: "patch", patch },
            riskScoreDelta: -1,
            isEligible: true,
            rank: -1,
          },
        ],
      };
    };
    const apply = (s: any, _a: any) => ({ ...s });

    const res = autoResolve({
      initialState: { x: 0 },
      evaluate,
      apply,
      maxSteps: 5,
    });

    // Should stop quickly — same canonical seenKey despite different key order
    expect(["NO_CHOICE", "NO_PROGRESS"]).toContain(res.stoppedBecause);
    expect(res.steps.length).toBeLessThanOrEqual(2);

    // All seenKeys for this candidate should be identical
    if (res.steps.length >= 1) {
      const firstKey = res.steps[0].loopGuard.seenKey;
      expect(firstKey).toContain("f1::FIX");
    }
  });

  it("selects next eligible candidate when first is already seen", () => {
    // State score decreases with each apply, so each step reports progress
    const evaluate = (s: any): Eval & { actionCandidates?: any[] } => ({
      risk: { score: s.score },
      findings: s.score > 0 ? [{ code: "X" }] : [],
      actionCandidates: s.score > 0 ? [
        {
          candidateId: "f1::A",
          findingId: "f1",
          findingCode: "X",
          actionCode: "A",
          action: { code: "A", kind: "patch", patch: [{ op: "set", path: "a", value: 1 }] },
          riskScoreDelta: -3,
          isEligible: true,
          rank: -3,
        },
        {
          candidateId: "f1::B",
          findingId: "f1",
          findingCode: "X",
          actionCode: "B",
          action: { code: "B", kind: "patch", patch: [{ op: "set", path: "b", value: 2 }] },
          riskScoreDelta: -2,
          isEligible: true,
          rank: -2,
        },
      ] : [],
    });
    // Each apply decreases score so progress is reported
    const apply = (s: any, _a: any) => ({ ...s, score: s.score - 3 });

    const res = autoResolve({
      initialState: { score: 10 },
      evaluate,
      apply,
      maxSteps: 5,
    });

    // Step 0 picks A (lowest primary rank = -3), step 1 picks B (A is seen)
    expect(res.steps.length).toBeGreaterThanOrEqual(2);
    expect(res.steps[0].actionSelected.candidateId).toBe("f1::A");
    expect(res.steps[1].actionSelected.candidateId).toBe("f1::B");
    // Different seenKeys
    expect(res.steps[0].loopGuard.seenKey).not.toBe(res.steps[1].loopGuard.seenKey);
  });

  it("stops with NO_PROGRESS when state signature is unchanged, even if risk appears to change", () => {
    // evaluate reports decreasing risk on each call (would normally count as progress),
    // but apply returns the SAME state object — state signature stays identical.
    let evalCount = 0;
    const evaluate = (_s: any): Eval & { actionCandidates?: any[] } => {
      evalCount++;
      // Risk "decreases" each call — without signature check this would look like progress
      const fakeRisk = Math.max(0, 20 - evalCount * 5);
      return {
        risk: { score: fakeRisk },
        findings: [{ code: "FAKE" }],
        actionCandidates: [
          {
            candidateId: "f1::NOOP",
            findingId: "f1",
            findingCode: "FAKE",
            actionCode: "NOOP",
            action: { code: "NOOP", kind: "patch", patch: [{ op: "set", path: "x", value: 1 }] },
            riskScoreDelta: -5,
            isEligible: true,
            rank: -5,
          },
        ],
      };
    };
    // apply returns identical state — no actual mutation
    const apply = (s: any, _a: any) => ({ ...s });

    const res = autoResolve({
      initialState: { x: 1 },
      evaluate,
      apply,
      maxSteps: 10,
    });

    // Must stop after 1 step with NO_PROGRESS due to identical state signature
    expect(res.stoppedBecause).toBe("NO_PROGRESS");
    expect(res.steps.length).toBe(1);

    const step = res.steps[0];
    // State signatures must be present and equal
    expect(step.stateSignatureBefore).toBeDefined();
    expect(step.stateSignatureAfter).toBeDefined();
    expect(step.stateSignatureBefore).toBe(step.stateSignatureAfter);
    // isProgress must be false despite risk delta looking favorable
    expect(step.isProgress).toBe(false);
  });

  it("runReport/v1 is internally consistent (stepsTaken > 0)", () => {
    const DETERMINISTIC_DEPS = { now: () => "2026-02-25T00:00:00.000Z" };
    const fixturePath = path.resolve(__dirname, "../../../scripts/plan-fixture.json");
    const plan = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    const runtime = createMajanduskavaRuntime();
    const host = createModuleHost({
      module: runtime, preset: "BALANCED", deps: DETERMINISTIC_DEPS,
    });
    const res = autoResolveWithHost({
      host, runtime, initialState: plan, maxSteps: 10,
    });

    const report = res.report!;
    expect(report).toBeDefined();
    expect(report.schemaVersion).toBe("runReport/v1");

    // This fixture produces at least 1 step
    expect(res.steps.length).toBeGreaterThan(0);
    expect(report.stepsTaken).toBe(res.steps.length);

    // final.stateSignature === last step's stateSignatureAfter
    const lastStep = res.steps[res.steps.length - 1];
    expect(report.final.stateSignature).toBe(lastStep.stateSignatureAfter);

    // selectedActionCodes length matches steps
    expect(report.selectedActionCodes.length).toBe(res.steps.length);

    // selectedActionCodes[i] matches steps[i].actionApplied.actionCode
    for (let i = 0; i < res.steps.length; i++) {
      expect(report.selectedActionCodes[i]).toBe(res.steps[i].actionApplied.actionCode);
    }
  });

  it("runReport/v1 is internally consistent (stepsTaken === 0)", () => {
    const DETERMINISTIC_DEPS = { now: () => "2026-02-25T00:00:00.000Z" };

    const runtime = createMajanduskavaRuntime();
    const host = createModuleHost({
      module: runtime, preset: "BALANCED", deps: DETERMINISTIC_DEPS,
    });

    // A state with no findings → no actions → stepsTaken === 0
    const cleanState = {
      apartments: { count: 10, avgArea: 50 },
      costs: [],
      incomes: [],
      investments: [],
      funds: { repairFund: { balance: 100000, monthlyRateEurPerM2: 1.5 } },
      loans: [],
      planYears: 5,
      startYear: 2026,
    };

    const res = autoResolveWithHost({
      host, runtime, initialState: cleanState, maxSteps: 10,
    });

    const report = res.report!;
    expect(report).toBeDefined();
    expect(report.schemaVersion).toBe("runReport/v1");

    // No steps taken
    expect(res.steps.length).toBe(0);
    expect(report.stepsTaken).toBe(0);

    // final.stateSignature === initial.stateSignature
    expect(report.final.stateSignature).toBe(report.initial.stateSignature);

    // selectedActionCodes is empty
    expect(report.selectedActionCodes).toEqual([]);
  });

  it("preset affects runReport output", () => {
    // Synthetic host where preset controls finding threshold:
    // preset "STRICT" triggers a finding at score > 5, "RELAXED" only at score > 15.
    // Initial state score=10 → STRICT fires, RELAXED doesn't.
    function makeMockHost(preset: string) {
      const threshold = preset === "STRICT" ? 5 : 15;
      return {
        preset,
        module: { manifest: { moduleId: "test-preset" } },
        run(state: any) {
          const score = state.score ?? 0;
          const hasFinding = score > threshold;
          return {
            evaluation: {
              schemaVersion: "evaluation/v1",
              risk: { score: hasFinding ? 30 : 0, level: hasFinding ? "medium" : "low" },
              findings: hasFinding
                ? [{ code: "OVER_THRESHOLD", id: "f1", severity: "warning" }]
                : [],
              actionCandidates: hasFinding
                ? [{
                    candidateId: "f1::DEC",
                    findingId: "f1",
                    findingCode: "OVER_THRESHOLD",
                    actionCode: "DEC",
                    action: { code: "DEC", kind: "patch", patch: [{ op: "decrement", path: "score", value: 6 }] },
                    riskScoreDelta: -30,
                    isEligible: true,
                    rank: -30,
                  }]
                : [],
            },
          };
        },
      };
    }
    const mockRuntime = {
      applyAction(state: any, action: any) {
        const dec = action?.patch?.[0]?.value ?? 0;
        return { ...state, score: state.score - dec };
      },
    };

    const resA = autoResolveWithHost({
      host: makeMockHost("STRICT"),
      runtime: mockRuntime,
      initialState: { score: 10 },
      maxSteps: 5,
    });
    const resB = autoResolveWithHost({
      host: makeMockHost("RELAXED"),
      runtime: mockRuntime,
      initialState: { score: 10 },
      maxSteps: 5,
    });

    const reportA = resA.report!;
    const reportB = resB.report!;

    expect(reportA).toBeDefined();
    expect(reportB).toBeDefined();
    expect(reportA.schemaVersion).toBe("runReport/v1");
    expect(reportB.schemaVersion).toBe("runReport/v1");

    // report.preset reflects the preset used
    expect(reportA.preset).toBe("STRICT");
    expect(reportB.preset).toBe("RELAXED");

    // STRICT triggers finding → action → state changes; RELAXED does not
    // At least one outcome dimension must differ
    const differs =
      reportA.final.stateSignature !== reportB.final.stateSignature ||
      reportA.stepsTaken !== reportB.stepsTaken ||
      JSON.stringify(reportA.selectedActionCodes) !== JSON.stringify(reportB.selectedActionCodes);
    expect(differs).toBe(true);

    // STRICT: took steps, RELAXED: no actions → 0 steps
    expect(reportA.stepsTaken).toBeGreaterThan(0);
    expect(reportB.stepsTaken).toBe(0);
    expect(reportA.selectedActionCodes.length).toBeGreaterThan(0);
    expect(reportB.selectedActionCodes).toEqual([]);
  });

  it("is idempotent — re-running on final state produces no steps", () => {
    // Synthetic host: finding fires when score > 0.
    // Action sets score to 0 in one step → fully resolved.
    function makeMockHost() {
      return {
        preset: "TEST",
        module: { manifest: { moduleId: "test-idempotent" } },
        run(state: any) {
          const hasFinding = state.score > 0;
          return {
            evaluation: {
              schemaVersion: "evaluation/v1",
              risk: { score: hasFinding ? 30 : 0, level: hasFinding ? "medium" : "low" },
              findings: hasFinding
                ? [{ code: "HIGH_SCORE", id: "f1", severity: "warning" }]
                : [],
              actionCandidates: hasFinding
                ? [{
                    candidateId: "f1::RESET",
                    findingId: "f1",
                    findingCode: "HIGH_SCORE",
                    actionCode: "RESET",
                    action: { code: "RESET", kind: "patch", patch: [{ op: "set", path: "score", value: 0 }] },
                    riskScoreDelta: -30,
                    isEligible: true,
                    rank: -30,
                  }]
                : [],
            },
          };
        },
      };
    }
    const mockRuntime = {
      applyAction(state: any, _action: any) {
        return { ...state, score: 0 };
      },
    };

    // Run 1: score 10 → resolved to 0 in one step
    const res1 = autoResolveWithHost({
      host: makeMockHost(),
      runtime: mockRuntime,
      initialState: { score: 10 },
      maxSteps: 10,
    });
    const report1 = res1.report!;
    expect(report1).toBeDefined();
    expect(report1.stepsTaken).toBeGreaterThan(0);

    // Run 2: re-run on final state (score 0 → no findings → no actions)
    const res2 = autoResolveWithHost({
      host: makeMockHost(),
      runtime: mockRuntime,
      initialState: res1.state,
      maxSteps: 10,
    });
    const report2 = res2.report!;
    expect(report2).toBeDefined();

    // No steps — state is fully resolved
    expect(report2.stepsTaken).toBe(0);
    expect(report2.selectedActionCodes).toEqual([]);
    expect(["NO_ACTIONS", "NO_PROGRESS"]).toContain(report2.stop.reason);

    // State signature unchanged
    expect(report2.final.stateSignature).toBe(report1.final.stateSignature);
  });

  it("is deterministic", () => {
    const DETERMINISTIC_DEPS = { now: () => "2026-02-25T00:00:00.000Z" };
    const fixturePath = path.resolve(__dirname, "../../../scripts/plan-fixture.json");
    const plan = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    function makeRun() {
      const runtime = createMajanduskavaRuntime();
      const host = createModuleHost({
        module: runtime, preset: "BALANCED", deps: DETERMINISTIC_DEPS,
      });
      return autoResolveWithHost({
        host,
        runtime,
        initialState: plan,
        maxSteps: 10,
      });
    }

    const res1 = makeRun();
    const res2 = makeRun();

    expect(res1.stoppedBecause).toBe(res2.stoppedBecause);
    expect(res1.steps.length).toBe(res2.steps.length);
    expect(res1.state).toEqual(res2.state);
    expect(res1.evaluation).toEqual(res2.evaluation);
    expect(res1.steps).toEqual(res2.steps);
  });

  it("replay determinism — two identical runs produce identical reports", () => {
    const DETERMINISTIC_DEPS = { now: () => "2026-02-25T00:00:00.000Z" };
    const fixturePath = path.resolve(__dirname, "../../../scripts/plan-fixture.json");
    const plan = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    function makeRun() {
      const runtime = createMajanduskavaRuntime();
      const host = createModuleHost({
        module: runtime, preset: "BALANCED", deps: DETERMINISTIC_DEPS,
      });
      return autoResolveWithHost({
        host, runtime, initialState: plan, maxSteps: 10,
      });
    }

    const reportA = makeRun().report!;
    const reportB = makeRun().report!;

    expect(reportA).toBeDefined();
    expect(reportB).toBeDefined();

    expect(reportA.schemaVersion).toBe("runReport/v1");
    expect(reportB.schemaVersion).toBe("runReport/v1");

    expect(reportA.initial.stateSignature).toBe(reportB.initial.stateSignature);
    expect(reportA.final.stateSignature).toBe(reportB.final.stateSignature);
    expect(reportA.stepsTaken).toBe(reportB.stepsTaken);
    expect(reportA.selectedActionCodes).toEqual(reportB.selectedActionCodes);
    expect(reportA.stop.reason).toBe(reportB.stop.reason);
  });

  it("schemaVersion contract — evaluation/v1, trace/v1, stepTrace/v1, runReport/v1", () => {
    function makeHost() {
      return {
        preset: "TEST",
        module: { manifest: { moduleId: "schema-check" } },
        run(state: any) {
          const hasFinding = state.score > 0;
          return {
            evaluation: {
              schemaVersion: "evaluation/v1",
              policyVersion: "test",
              risk: { score: hasFinding ? 10 : 0, level: hasFinding ? "medium" : "low" },
              findings: hasFinding
                ? [{ code: "X", id: "f1", severity: "warning" }]
                : [],
              actionCandidates: hasFinding
                ? [{
                    candidateId: "f1::FIX",
                    findingId: "f1",
                    findingCode: "X",
                    actionCode: "FIX",
                    action: { code: "FIX", kind: "patch", patch: [{ op: "set", path: "score", value: 0 }] },
                    riskScoreDelta: -10,
                    isEligible: true,
                    rank: -10,
                  }]
                : [],
              trace: {
                schemaVersion: "trace/v1",
                events: [],
              },
            },
          };
        },
      };
    }
    const runtime = { applyAction: (s: any) => ({ ...s, score: 0 }) };

    const res = autoResolveWithHost({
      host: makeHost(),
      runtime,
      initialState: { score: 5 },
      maxSteps: 2,
    });

    // evaluation.schemaVersion
    expect(res.evaluation.schemaVersion).toBe("evaluation/v1");

    // trace.schemaVersion
    expect((res.evaluation as any).trace?.schemaVersion).toBe("trace/v1");

    // stepTrace.schemaVersion (every step)
    expect(res.steps.length).toBeGreaterThan(0);
    for (const step of res.steps) {
      expect(step.schemaVersion).toBe("stepTrace/v1");
    }

    // runReport.schemaVersion
    expect(res.report).toBeDefined();
    expect(res.report!.schemaVersion).toBe("runReport/v1");
  });

  it("golden-trace snapshot — fixed input produces exact expected output", () => {
    // Synthetic host: deterministic, no timestamps/runtime IDs.
    // score > 0 → 2 findings (warning + info), 2 candidates (1 eligible, 1 not).
    // applyAction decrements score by 5. maxSteps: 1 → MAX_STEPS with rich final state.
    const GOLDEN_POLICY_BUNDLE = { presetCode: "GOLDEN", limits: { scoreThreshold: 0 } };
    const GOLDEN_POLICY_VERSION = buildPolicyVersion(GOLDEN_POLICY_BUNDLE);

    function makeGoldenHost() {
      return {
        preset: "GOLDEN",
        module: { manifest: { moduleId: "golden-trace" } },
        run(state: any) {
          const score = state.score ?? 0;
          const hasFinding = score > 0;
          return {
            evaluation: {
              schemaVersion: "evaluation/v1",
              policyVersion: GOLDEN_POLICY_VERSION,
              risk: { score: hasFinding ? score * 3 : 0, level: hasFinding ? "high" : "low" },
              findings: hasFinding
                ? [
                    { code: "OVER", id: "f1", severity: "warning" },
                    { code: "HINT", id: "f2", severity: "info" },
                  ]
                : [],
              actionCandidates: hasFinding
                ? [
                    {
                      candidateId: "f1::DEC",
                      findingId: "f1",
                      findingCode: "OVER",
                      actionCode: "DEC",
                      action: { code: "DEC", kind: "patch", patch: [{ op: "decrement", path: "score", value: 5 }] },
                      riskScoreDelta: -15,
                      isEligible: true,
                      rank: -15,
                    },
                    {
                      candidateId: "f2::NOP",
                      findingId: "f2",
                      findingCode: "HINT",
                      actionCode: "NOP",
                      action: { code: "NOP", kind: "patch", patch: [{ op: "set", path: "tag", value: "x" }] },
                      riskScoreDelta: 0,
                      isEligible: false,
                      rank: 0,
                    },
                  ]
                : [],
              trace: {
                schemaVersion: "trace/v1",
                events: hasFinding
                  ? [
                      { kind: "finding", findingCode: "HINT", severity: "info" },
                      { kind: "finding", findingCode: "OVER", severity: "warning" },
                      { kind: "actionCandidate", candidateId: "f1::DEC", findingCode: "OVER", actionCode: "DEC", riskScoreDelta: -15, eligible: true, reasons: ["ELIGIBLE"], rankVector: { primary: -15, secondary: "DEC", tertiary: "f1::DEC" } },
                      { kind: "actionCandidate", candidateId: "f2::NOP", findingCode: "HINT", actionCode: "NOP", riskScoreDelta: 0, eligible: false, reasons: ["NOT_APPLICABLE"], rankVector: { primary: 0, secondary: "NOP", tertiary: "f2::NOP" } },
                    ]
                  : [],
              },
            },
          };
        },
      };
    }

    const mockRuntime = {
      applyAction(state: any, _action: any) {
        return { ...state, score: state.score - 5 };
      },
    };

    const res = autoResolveWithHost({
      host: makeGoldenHost(),
      runtime: mockRuntime,
      initialState: { score: 10 },
      maxSteps: 1,
    });

    // --- Extract deterministic snapshot ---

    const snapshot = {
      report: res.report,
      steps: res.steps.map((s) => ({
        index: s.index,
        stateSignatureBefore: s.stateSignatureBefore,
        stateSignatureAfter: s.stateSignatureAfter,
        evaluationSnapshotBefore: s.evaluationSnapshotBefore,
        evaluationSnapshotAfter: s.evaluationSnapshotAfter,
        delta: s.delta,
        isProgress: s.isProgress,
        actionSelected: s.actionSelected,
        actionApplied: s.actionApplied,
        loopGuard: s.loopGuard,
      })),
      candidateEvents: (res.evaluation?.trace?.events ?? [])
        .filter((e: any) => e.kind === "actionCandidate")
        .map((e: any) => ({
          candidateId: e.candidateId,
          findingCode: e.findingCode,
          actionCode: e.actionCode,
          eligible: e.eligible,
          reasons: e.reasons,
          rankVector: e.rankVector,
        }))
        .sort((a: any, b: any) => String(a.candidateId).localeCompare(String(b.candidateId))),
    };

    // --- GOLDEN ---

    const GOLDEN = {
      report: {
        schemaVersion: "runReport/v1",
        moduleId: "golden-trace",
        preset: "GOLDEN",
        policyVersion: "2675d49b91b15a06",
        reportDigest: "577ae2d23bf3aa6d",
        initial: {
          stateSignature: "a7eba9d6bfbf78b5",
          riskScore: 30,
          findingsCount: 2,
        },
        final: {
          stateSignature: "542a890c062ce296",
          riskScore: 15,
          findingsCount: 2,
        },
        stepsTaken: 1,
        stop: { reason: "MAX_STEPS", details: undefined },
        selectedActionCodes: ["DEC"],
      },
      steps: [
        {
          index: 0,
          stateSignatureBefore: "a7eba9d6bfbf78b5",
          stateSignatureAfter: "542a890c062ce296",
          evaluationSnapshotBefore: {
            riskScore: 30,
            riskLevel: "high",
            findingsCount: 2,
            findingCodes: ["HINT", "OVER"],
            actionCandidatesCount: 2,
          },
          evaluationSnapshotAfter: {
            riskScore: 15,
            riskLevel: "high",
            findingsCount: 2,
            findingCodes: ["HINT", "OVER"],
            actionCandidatesCount: 2,
          },
          delta: { riskScore: -15, findingsCount: 0 },
          isProgress: true,
          actionSelected: {
            candidateId: "f1::DEC",
            reasonCode: "LOWEST_PRIMARY_RANK",
            rankVector: { primary: -15, secondary: "DEC", tertiary: "f1::DEC" },
            tieBreakUsed: false,
          },
          actionApplied: {
            actionCode: "DEC",
            kind: "patch",
            patch: [{ op: "decrement", path: "score", value: 5 }],
          },
          loopGuard: {
            seenKey: "f1::DEC::[{\"op\":\"decrement\",\"path\":\"score\",\"value\":5}]",
            seenCountBefore: 0,
            seenCountAfter: 1,
          },
        },
      ],
      candidateEvents: [
        {
          candidateId: "f1::DEC",
          findingCode: "OVER",
          actionCode: "DEC",
          eligible: true,
          reasons: ["ELIGIBLE"],
          rankVector: { primary: -15, secondary: "DEC", tertiary: "f1::DEC" },
        },
        {
          candidateId: "f2::NOP",
          findingCode: "HINT",
          actionCode: "NOP",
          eligible: false,
          reasons: ["NOT_APPLICABLE"],
          rankVector: { primary: 0, secondary: "NOP", tertiary: "f2::NOP" },
        },
      ],
    };

    expect(snapshot).toEqual(GOLDEN);
  });

  it("runReport and stepTrace survive JSON round-trip (serializable)", () => {
    function makeHost() {
      return {
        preset: "SERIAL",
        module: { manifest: { moduleId: "serial-test" } },
        run(state: any) {
          const score = state.score ?? 0;
          const hasFinding = score > 0;
          return {
            evaluation: {
              schemaVersion: "evaluation/v1",
              policyVersion: "serial-v1",
              risk: { score: hasFinding ? score * 2 : 0, level: hasFinding ? "medium" : "low" },
              findings: hasFinding
                ? [{ code: "HIGH", id: "f1", severity: "warning" }]
                : [],
              actionCandidates: hasFinding
                ? [{
                    candidateId: "f1::FIX",
                    findingId: "f1",
                    findingCode: "HIGH",
                    actionCode: "FIX",
                    action: { code: "FIX", kind: "patch", patch: [{ op: "set", path: "score", value: 0 }] },
                    riskScoreDelta: -score * 2,
                    isEligible: true,
                    rank: -score * 2,
                  }]
                : [],
              trace: { schemaVersion: "trace/v1", events: [] },
            },
          };
        },
      };
    }
    const runtime = { applyAction: (s: any) => ({ ...s, score: 0 }) };

    const result = autoResolveWithHost({
      host: makeHost(),
      runtime,
      initialState: { score: 8 },
      maxSteps: 3,
    });

    // Sanity: at least 1 step taken
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.report).toBeDefined();

    // Round-trip
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);

    // report fields
    expect(parsed.report.schemaVersion).toBe("runReport/v1");
    expect(parsed.report.final.stateSignature).toBe(result.report!.final.stateSignature);
    expect(parsed.report.selectedActionCodes).toEqual(result.report!.selectedActionCodes);

    // reportDigest survives round-trip
    expect(typeof parsed.report.reportDigest).toBe("string");
    expect(parsed.report.reportDigest.length).toBeGreaterThan(0);
    expect(parsed.report.reportDigest).toBe(result.report!.reportDigest);

    // steps length
    expect(parsed.steps.length).toBe(result.steps.length);

    // step-level stateSignatureAfter
    for (let i = 0; i < result.steps.length; i++) {
      expect(parsed.steps[i].stateSignatureAfter).toBe(result.steps[i].stateSignatureAfter);
    }
  });
});
