// src/domain/writtenVotingDeadlineSoon.test.js
import { describe, it, expect } from "vitest";
import { isWrittenVotingDeadlineSoon } from "./meetingMaterials";
import { defaultPlan } from "./planSchema";
import { computePlan } from "../engine/computePlan";

const NOW = new Date("2026-04-19T12:00:00.000Z");

describe("isWrittenVotingDeadlineSoon — 7-päeva nähtavushoiatus", () => {
  it("6 päeva kaugusel → hoiatus nähtav", () => {
    expect(isWrittenVotingDeadlineSoon("2026-04-25", NOW)).toBe(true);
  });

  it("7 päeva kaugusel → hoiatus peidetud", () => {
    expect(isWrittenVotingDeadlineSoon("2026-04-26", NOW)).toBe(false);
  });

  it("14 päeva kaugusel → hoiatus peidetud", () => {
    expect(isWrittenVotingDeadlineSoon("2026-05-03", NOW)).toBe(false);
  });

  it("deadline puudub (tühi string) → see hoiatus ei ilmu", () => {
    expect(isWrittenVotingDeadlineSoon("", NOW)).toBe(false);
  });

  it("deadline puudub (null) → see hoiatus ei ilmu", () => {
    expect(isWrittenVotingDeadlineSoon(null, NOW)).toBe(false);
  });

  it("deadline on minevikus → hoiatus nähtav (alla 7 päeva)", () => {
    expect(isWrittenVotingDeadlineSoon("2026-04-10", NOW)).toBe(true);
  });

  it("regressioon: hoiatuse helper ei mõjuta computePlan tulemust", () => {
    const before = computePlan(defaultPlan());
    isWrittenVotingDeadlineSoon("2026-04-25", NOW);
    const after = computePlan(defaultPlan());
    expect(after).toEqual(before);
  });
});
