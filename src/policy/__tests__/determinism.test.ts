import { describe, it, expect } from "vitest";
import { autoResolve } from "../solvereCoreV1";

describe("autoResolve determinism", () => {
  it("produces identical result for identical inputs", () => {
    const evaluate = (s: any) => ({
      risk: { score: s.score },
      findings: s.score > 0 ? [{ code: "X" }] : [],
      actions: s.score > 0
        ? [{ code: "DEC", impact: { riskScoreDelta: -1 }, patch: { dec: 1 } }]
        : []
    });

    const apply = (s: any, a: any) => ({
      ...s,
      score: s.score - (a.patch?.dec ?? 0)
    });

    const input = { score: 3 };

    const res1 = autoResolve({
      initialState: input,
      evaluate,
      apply,
      maxSteps: 10
    });

    const res2 = autoResolve({
      initialState: input,
      evaluate,
      apply,
      maxSteps: 10
    });

    expect(res1).toEqual(res2);
  });
});
