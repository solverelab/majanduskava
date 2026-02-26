// src/solvereBridge/majanduskavaHost.js
//
// ============================================================================
// Solvere Core Contract v1 (frozen)
// ============================================================================
//
// This module enforces the following invariants at runtime (dev-only):
//
//   1. Deterministic runtime — same state + policyVersion always produces
//      the same evaluation fingerprint, loopGuard status, and policyVersion.
//   2. TRACE/v1 invariant — evaluation.trace must have schemaVersion "trace/v1",
//      events array, and a non-empty policyVersion.
//   3. Action chain ordering — finding -> actionCandidate -> actionSelected ->
//      actionApplied. No downstream step without all upstream steps present.
//   4. autoResolve contract — result.steps is an array; each step contains
//      evaluationSnapshotBefore and evaluationSnapshotAfter.
//   5. No nondeterministic fields — evaluation.trace must not contain keys
//      like timestamp, time, date, now, generatedAt, createdAt, updatedAt.
//   6. stateSignature + reportDigest stability — content hashes are
//      deterministic and key-order independent.
//
// Breaking changes require explicit v2 version bump.
// ============================================================================
//
import { createModuleHost, buildStateSignature } from "../../packages/solvere-core/src/moduleHost.ts";
import { autoResolve } from "../../packages/solvere-core/src/autoResolve";
import { createMajanduskavaRuntime } from "../../solvere-modules/majanduskava/src/runtime.ts";

const runtime = createMajanduskavaRuntime();
const host = createModuleHost({ module: runtime, preset: "BALANCED" });

const IS_DEV = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

// Master switch for all dev-only guards (deepFreeze + assertions).
// Set to false to disable all guards without touching individual functions.
const SOLVERE_DEV_GUARDS_ENABLED = IS_DEV && true;

// Static diagnostics for tests/debugging — not for UI or evaluation/trace.
export const __DEV_GUARDS_STATUS__ = { enabled: SOLVERE_DEV_GUARDS_ENABLED };

// Static version identifier for UI display.
export const SOLVERE_CORE_CONTRACT_VERSION = "Solvere Core Contract v1 (frozen)";

// Dev-only: determinism caches (module-scope, not localStorage)
const _seenDigests = SOLVERE_DEV_GUARDS_ENABLED ? new Map() : null;
const _seenLoopGuard = SOLVERE_DEV_GUARDS_ENABLED ? new Map() : null;
const _seenPolicyVersion = SOLVERE_DEV_GUARDS_ENABLED ? new Map() : null;

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object" || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  const keys = Object.getOwnPropertyNames(obj);
  for (let i = 0; i < keys.length; i++) {
    deepFreeze(obj[keys[i]]);
  }
  return obj;
}

function assertTraceV1Invariant(evaluation) {
  const missing = [];
  if (!evaluation.trace) {
    missing.push("evaluation.trace");
  } else {
    if (evaluation.trace.schemaVersion !== "trace/v1") {
      missing.push("trace.schemaVersion (expected \"trace/v1\", got \"" + evaluation.trace.schemaVersion + "\")");
    }
    if (!Array.isArray(evaluation.trace.events)) {
      missing.push("trace.events (expected array)");
    }
  }
  if (typeof evaluation.policyVersion !== "string" || !evaluation.policyVersion) {
    missing.push("evaluation.policyVersion");
  }
  if (missing.length) {
    throw new Error("TRACE_V1_INVARIANT_FAILED: " + missing.join(", "));
  }
}

const _NONDETERMINISTIC_KEYS = new Set([
  "timestamp", "time", "date", "now", "generatedat", "createdat", "updatedat"
]);

function assertNoNondeterministicFields(trace) {
  if (!trace || typeof trace !== "object") return;
  const found = [];

  function walk(obj) {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) walk(obj[i]);
      return;
    }
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      if (_NONDETERMINISTIC_KEYS.has(keys[i].toLowerCase())) {
        found.push(keys[i]);
      }
      walk(obj[keys[i]]);
    }
  }

  walk(trace);

  if (found.length) {
    throw new Error("NONDETERMINISM_FIELD_FOUND: " + found.join(", "));
  }
}

function assertDeterminismStability(state, evaluation) {
  const sig = buildStateSignature(state);
  const pv = evaluation.policyVersion ?? "";
  const key = sig + "::" + pv;
  const prev = _seenDigests.get(key);
  if (prev !== undefined) {
    // Compare canonical evaluation fingerprint (risk + findings codes + candidates count)
    const current = buildEvalFingerprint(evaluation);
    if (current !== prev) {
      throw new Error(
        "DETERMINISM_FAILED: evaluation fingerprint mismatch for same stateSignature + policyVersion" +
        " (sig=" + sig + ", prev=" + prev + ", current=" + current + ")"
      );
    }
  } else {
    _seenDigests.set(key, buildEvalFingerprint(evaluation));
    // Cap cache to prevent unbounded growth
    if (_seenDigests.size > 200) {
      const first = _seenDigests.keys().next().value;
      _seenDigests.delete(first);
    }
  }
}

function buildEvalFingerprint(evaluation) {
  const risk = evaluation.risk?.score ?? 0;
  const level = evaluation.risk?.level ?? "";
  const findingCodes = (evaluation.findings ?? [])
    .map(f => f.code ?? "")
    .filter(Boolean)
    .sort()
    .join(",");
  const candidateCount = evaluation.actionCandidates?.length ?? 0;
  return risk + "|" + level + "|" + findingCodes + "|" + candidateCount;
}

function assertLoopGuardStability(state, evaluation) {
  const sig = buildStateSignature(state);
  const pv = evaluation.policyVersion ?? "";
  const key = sig + "::" + pv;
  // Derive loopGuard status from evaluation: eligible candidate count determines
  // whether autoResolve can take a step (OK) or would stop (BLOCKED).
  const candidates = evaluation.actionCandidates ?? [];
  const eligibleCount = candidates.filter(c => c.isEligible).length;
  const status = eligibleCount > 0 ? "OK:" + eligibleCount : "BLOCKED:0";

  const prev = _seenLoopGuard.get(key);
  if (prev !== undefined) {
    if (status !== prev) {
      throw new Error(
        "DETERMINISM_FAILED: loopGuard mismatch for same stateSignature" +
        " (sig=" + sig + ", prev=" + prev + ", current=" + status + ")"
      );
    }
  } else {
    _seenLoopGuard.set(key, status);
    if (_seenLoopGuard.size > 200) {
      const first = _seenLoopGuard.keys().next().value;
      _seenLoopGuard.delete(first);
    }
  }
}

function assertPolicyVersionStability(state, evaluation) {
  const sig = buildStateSignature(state);
  const pv = evaluation.policyVersion ?? "";
  const prev = _seenPolicyVersion.get(sig);
  if (prev !== undefined) {
    if (pv !== prev) {
      throw new Error(
        "DETERMINISM_FAILED: policyVersion changed for same stateSignature" +
        " (sig=" + sig + ", prev=" + prev + ", current=" + pv + ")"
      );
    }
  } else {
    _seenPolicyVersion.set(sig, pv);
    if (_seenPolicyVersion.size > 200) {
      const first = _seenPolicyVersion.keys().next().value;
      _seenPolicyVersion.delete(first);
    }
  }
}

function assertActionChainCompleteness(evaluation) {
  // Validates the action chain ordering invariant per finding:
  //   finding → actionCandidate → actionSelected → actionApplied
  // No downstream step may exist without all upstream steps present.
  const findings = evaluation.findings ?? [];
  const candidates = evaluation.actionCandidates ?? [];
  const violations = [];

  for (const finding of findings) {
    const actions = finding.actions ?? [];
    if (actions.length === 0) continue;

    const findingCandidates = candidates.filter(c => c.findingId === finding.id);
    const hasCandidate = findingCandidates.length > 0;
    const hasSelected = finding.actionSelected != null
      || findingCandidates.some(c => c.selected != null);
    const hasApplied = finding.actionApplied != null
      || findingCandidates.some(c => c.applied != null);

    // A) actionApplied requires actionSelected and actionCandidate
    if (hasApplied) {
      if (!hasSelected) {
        violations.push(finding.id + " (actionApplied without actionSelected)");
      }
      if (!hasCandidate) {
        violations.push(finding.id + " (actionApplied without actionCandidate)");
      }
    }

    // B) actionSelected requires actionCandidate
    if (hasSelected && !hasCandidate) {
      violations.push(finding.id + " (actionSelected without actionCandidate)");
    }

    // Finding with actions must have candidates
    if (!hasCandidate) {
      violations.push(finding.id + " (no candidates)");
      continue;
    }

    // C) actionCandidate without actionSelected → explicit resolution required
    if (!hasSelected) {
      for (const c of findingCandidates) {
        if (typeof c.isEligible !== "boolean") {
          violations.push(c.candidateId + " (isEligible not boolean)");
        }
      }
    }
  }

  if (violations.length) {
    throw new Error(
      "TRACE_ACTION_CHAIN_INVARIANT_FAILED: " + violations.join(", ")
    );
  }
}

export function setPreset(preset) {
  // Clear policyVersion cache on preset change — new preset = new policy bundle = new policyVersion
  if (SOLVERE_DEV_GUARDS_ENABLED) _seenPolicyVersion.clear();
  host.setPreset(preset);
}

// evaluate-only
export function runPlan(state) {
  const result = host.run(state);
  if (SOLVERE_DEV_GUARDS_ENABLED && result.evaluation) {
    assertTraceV1Invariant(result.evaluation);
    assertNoNondeterministicFields(result.evaluation.trace);
    assertPolicyVersionStability(state, result.evaluation);
    assertDeterminismStability(state, result.evaluation);
    assertLoopGuardStability(state, result.evaluation);
    assertActionChainCompleteness(result.evaluation);
    deepFreeze(result.evaluation);
  }
  return result;
}

export function applyActionAndRun(plan, action) {
  const result = host.applyActionAndRun(plan, action);
  if (SOLVERE_DEV_GUARDS_ENABLED && result.evaluation) {
    assertTraceV1Invariant(result.evaluation);
    assertNoNondeterministicFields(result.evaluation.trace);
    assertPolicyVersionStability(result.state, result.evaluation);
    assertDeterminismStability(result.state, result.evaluation);
    assertLoopGuardStability(result.state, result.evaluation);
    assertActionChainCompleteness(result.evaluation);
    deepFreeze(result.evaluation);
  }
  return result;
}

function assertAutoResolveContract(result) {
  const violations = [];

  if (!Array.isArray(result.steps)) {
    violations.push("steps is not an array");
  } else {
    for (let i = 0; i < result.steps.length; i++) {
      const step = result.steps[i];
      if (!step.evaluationSnapshotBefore) {
        violations.push("step[" + i + "] missing evaluationSnapshotBefore");
      }
      if (!step.evaluationSnapshotAfter) {
        violations.push("step[" + i + "] missing evaluationSnapshotAfter");
      }
    }
  }

  if (violations.length) {
    throw new Error("AUTORESOLVE_CONTRACT_FAILED: " + violations.join(", "));
  }
}

export function runAutoResolve(args) {
  const result = autoResolve(args);
  if (SOLVERE_DEV_GUARDS_ENABLED) {
    assertAutoResolveContract(result);
  }
  return result;
}

// apply-only (module level)
export function applyOnly(state, action) {
  return runtime.applyAction(state, action);
}
