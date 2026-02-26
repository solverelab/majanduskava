import { useState } from "react";

/**
 * Trace panel (trace/v1)
 * Supports both:
 *  - autoResolve core steps (riskBefore/After, findingsBefore/After)
 *  - evaluation.trace (rule-level trace events)
 */

function formatValue(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function isStepTraceShape(s) {
  return s && typeof s === "object" && "actionSelected" in s && "actionApplied" in s && "evaluationSnapshotBefore" in s;
}

function EvidenceRow({ ev }) {
  const hasOp = !!ev?.op;
  const left = ev?.path ?? "";
  const op = hasOp ? ev.op : "";
  const expected = ev?.expected !== undefined ? ` ${formatValue(ev.expected)}` : "";
  const actual = ev?.actual !== undefined ? formatValue(ev.actual) : undefined;

  return (
    <div style={{ marginTop: 4, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", padding: "4px 8px", fontSize: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <code style={{ color: "#334155" }}>{left}</code>
        {hasOp && <span style={{ color: "#64748b" }}>{op}</span>}
        {ev?.expected !== undefined && (
          <span style={{ color: "#64748b" }}>
            expected:<code style={{ marginLeft: 4 }}>{expected.trim()}</code>
          </span>
        )}
      </div>
      {actual !== undefined && (
        <div style={{ marginTop: 4, color: "#475569" }}>
          actual:&nbsp;<code style={{ whiteSpace: "pre-wrap" }}>{actual}</code>
        </div>
      )}
      {ev?.note && <div style={{ marginTop: 4, color: "#64748b" }}>{ev.note}</div>}
    </div>
  );
}

const kindStyles = {
  finding:          { bg: "#fff1f2", color: "#be123c", border: "#fecdd3" },
  actionCandidate:  { bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
  actionSelected:   { bg: "#eef2ff", color: "#4338ca", border: "#c7d2fe" },
  actionApplied:    { bg: "#ecfdf5", color: "#065f46", border: "#a7f3d0" },
  autoResolveStop:  { bg: "#fef2f2", color: "#991b1b", border: "#fca5a5" },
};

function TraceEventCard({ e }) {
  const s = kindStyles[e.kind] || { bg: "#f8fafc", color: "#334155", border: "#e2e8f0" };

  const title =
    e.kind === "finding"
      ? `Finding: ${e.findingCode}`
      : e.kind === "actionCandidate"
        ? `Candidate: ${e.actionCode || e.candidateId || ""}`.trim()
        : e.kind === "actionSelected"
          ? `Selected: ${e.actionCode || e.candidateId || ""} (${e.reason || ""})`
          : e.kind === "actionApplied"
            ? `Applied: ${e.actionCode || ""}`
            : e.kind === "autoResolveStop"
              ? `AutoResolve stop: ${e.reason || ""}`
              : "Note";

  return (
    <div style={{ borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{title}</div>
          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 12, color: "#475569" }}>
            <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 4, border: `1px solid ${s.border}`, background: s.bg, color: s.color, padding: "1px 8px" }}>
              {e.kind}
            </span>

            {e.kind === "finding" && e.severity && (
              <span style={{ color: "#64748b" }}>severity: {e.severity}</span>
            )}

            {"rule" in e && e.rule?.id && (
              <span style={{ color: "#64748b" }}>
                rule: <code>{e.rule.id}</code>
              </span>
            )}

            {e.kind === "actionSelected" && e.reason && (
              <span style={{ color: "#64748b" }}>
                reason: <code>{e.reason}</code>
              </span>
            )}

            {e.kind === "actionCandidate" && e.candidateId && (
              <span style={{ color: "#64748b" }}>
                candidate: <code>{e.candidateId}</code>
              </span>
            )}

            {e.kind === "actionCandidate" && e.findingCode && (
              <span style={{ color: "#64748b" }}>
                finding: <code>{e.findingCode}</code>
              </span>
            )}
          </div>
        </div>
      </div>

      {e.kind === "finding" && (e.message || e.metrics) && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#334155" }}>
          {e.message ? <div style={{ marginBottom: 4 }}>{e.message}</div> : null}
          {e.metrics ? (
            <div style={{ color: "#64748b" }}>
              metrics: <code>{formatValue(e.metrics)}</code>
            </div>
          ) : null}
        </div>
      )}

      {e.kind === "actionCandidate" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#334155" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {typeof e.riskScoreDelta === "number" && (
              <span style={{ color: "#475569" }}>
                riskScoreDelta: <code style={{ color: e.riskScoreDelta < 0 ? "#16a34a" : e.riskScoreDelta > 0 ? "#dc2626" : "#64748b" }}>{e.riskScoreDelta}</code>
              </span>
            )}
            {typeof e.eligible === "boolean" && (
              <span style={{ color: "#475569" }}>
                eligible: <code>{String(e.eligible)}</code>
              </span>
            )}
          </div>
        </div>
      )}

      {e.kind === "actionSelected" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#334155" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {e.candidateId && (
              <span style={{ color: "#475569" }}>
                candidate: <code>{e.candidateId}</code>
              </span>
            )}
            {typeof e.riskBefore === "number" && (
              <span style={{ color: "#475569" }}>
                risk before: <code>{e.riskBefore}</code>
              </span>
            )}
          </div>
        </div>
      )}

      {e.kind === "actionApplied" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#334155" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {typeof e.riskBefore === "number" && typeof e.riskAfter === "number" && (
              <span style={{ color: "#475569" }}>
                risk: <code>{e.riskBefore}</code> → <code style={{ color: e.riskAfter < e.riskBefore ? "#16a34a" : "#64748b" }}>{e.riskAfter}</code>
              </span>
            )}
            {e.patchSummary && (
              <span style={{ color: "#475569" }}>
                patch: <code>{e.patchSummary}</code>
              </span>
            )}
          </div>
          {Array.isArray(e.statePathAffected) && e.statePathAffected.length > 0 && (
            <div style={{ marginTop: 4, color: "#64748b" }}>
              paths: {e.statePathAffected.map((p, i) => <code key={i} style={{ marginRight: 6 }}>{p}</code>)}
            </div>
          )}
        </div>
      )}

      {e.kind === "autoResolveStop" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#334155" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {typeof e.finalRisk === "number" && (
              <span style={{ color: "#475569" }}>
                final risk: <code>{e.finalRisk}</code>
              </span>
            )}
            {typeof e.stepsTaken === "number" && (
              <span style={{ color: "#475569" }}>
                steps taken: <code>{e.stepsTaken}</code>
              </span>
            )}
          </div>
        </div>
      )}

      {"evidence" in e && Array.isArray(e.evidence) && e.evidence.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>Evidence</div>
          {e.evidence.map((ev, idx) => (
            <EvidenceRow key={idx} ev={ev} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TracePanel({ evaluation, steps, stop }) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const currentTrace = evaluation?.trace;
  const hasCurrent = !!currentTrace?.events?.length;

  const hasSteps = Array.isArray(steps) && steps.length > 0;
  const stepsAreStructured = hasSteps && isStepTraceShape(steps[0]);

  const headerHint = hasSteps
    ? `${steps.length} step(s)`
    : hasCurrent
      ? `${currentTrace.events.length} event(s)`
      : "no trace";

  const btnLocal = { padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 13, color: "#334155" };
  const sectionBox = { borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc", padding: 12 };

  const stopReasonLabels = {
    NO_ACTIONS: "Tegevusi pole",
    NO_CHOICE: "Sobivat valikut pole",
    LOOP_GUARD: "Tsüklikaitse",
    NO_PROGRESS: "Edasiminek puudub",
    MAX_STEPS: "Max sammud täis",
  };

  return (
    <div style={{ borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff", padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a" }}>Trace / Explain</div>
          <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
            schema: <code>{stepsAreStructured ? "stepTrace/v1" : "trace/v1"}</code>
            <span style={{ marginLeft: 8, color: "#64748b" }}>{headerHint}</span>
            {hasSteps && stepsAreStructured && (
              <span style={{ marginLeft: 8, color: "#64748b" }}>
                (sammude trace näitab deltasid; reeglitrace on praegune hindamine)
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            style={{ ...btnLocal, opacity: !(hasCurrent || hasSteps) ? 0.4 : 1 }}
            onClick={() => setOpen((v) => !v)}
            disabled={!(hasCurrent || hasSteps)}
            title={!(hasCurrent || hasSteps) ? "No trace available" : ""}
          >
            {open ? "Peida" : "Näita"}
          </button>

          {open && (
            <button
              style={btnLocal}
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? "Kena vaade" : "Raw JSON"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          {showRaw ? (
            <pre style={{ maxHeight: 420, overflow: "auto", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", padding: 12, fontSize: 12, color: "#334155" }}>
              {formatValue({ steps, stop, trace: currentTrace })}
            </pre>
          ) : (
            <>
              {/* SOLVER STEPS — data-driven from structured step objects */}
              {hasSteps && stepsAreStructured && (
                <div style={sectionBox}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>Solver steps</div>
                    {stop && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, borderRadius: 4, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b", padding: "1px 8px" }}>
                        Peatatud: {stopReasonLabels[stop.reason] ?? stop.reason}
                        <span style={{ color: "#64748b", marginLeft: 4 }}>({stop.stepsTaken} sammu)</span>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                    {steps.map((s, idx) => {
                      const sel = s.actionSelected;
                      const app = s.actionApplied;
                      const snapB = s.evaluationSnapshotBefore;
                      const snapA = s.evaluationSnapshotAfter;
                      const delta = s.delta;

                      return (
                        <div key={idx} style={{ borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", padding: 12 }}>
                          {/* Header: step index + progress indicator */}
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                              Step {s.index ?? idx}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                              {s.isProgress
                                ? <span style={{ color: "#16a34a", fontWeight: 600 }}>Progress</span>
                                : <span style={{ color: "#dc2626", fontWeight: 600 }}>No progress</span>
                              }
                            </div>
                          </div>

                          {/* Selection info */}
                          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#475569" }}>
                            <span>
                              candidate: <code style={{ color: "#4338ca" }}>{sel.candidateId}</code>
                            </span>
                            <span>
                              reason: <code>{sel.reasonCode}</code>
                            </span>
                            {sel.rankVector && (
                              <span>
                                rank: <code style={{ color: sel.rankVector.primary < 0 ? "#16a34a" : "#64748b" }}>{sel.rankVector.primary}</code>
                                <span style={{ color: "#94a3b8", margin: "0 2px" }}>/</span>
                                <code>{sel.rankVector.secondary}</code>
                                <span style={{ color: "#94a3b8", margin: "0 2px" }}>/</span>
                                <code>{sel.rankVector.tertiary}</code>
                              </span>
                            )}
                            {sel.tieBreakUsed && (
                              <span style={{ color: "#92400e" }}>tie-break</span>
                            )}
                          </div>

                          {/* Applied action */}
                          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#475569" }}>
                            <span>
                              action: <code style={{ color: "#065f46" }}>{app.actionCode}</code>
                            </span>
                            <span>
                              kind: <code>{app.kind}</code>
                            </span>
                          </div>

                          {/* State signature */}
                          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, fontSize: 12, color: "#475569" }}>
                            <span>
                              state: <code style={{ color: "#64748b" }}>{s.stateSignatureBefore}</code> → <code style={{ color: s.stateSignatureAfter !== s.stateSignatureBefore ? "#334155" : "#64748b" }}>{s.stateSignatureAfter}</code>
                            </span>
                            {s.stateSignatureBefore === s.stateSignatureAfter && (
                              <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 4, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b", padding: "1px 8px", fontWeight: 600, fontSize: 11 }}>
                                STATE_UNCHANGED
                              </span>
                            )}
                          </div>

                          {/* Snapshot deltas */}
                          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#475569" }}>
                            <span>
                              risk: <code>{snapB.riskScore}</code> → <code style={{ color: delta.riskScore < 0 ? "#16a34a" : "#64748b" }}>{snapA.riskScore}</code>
                              <code style={{ marginLeft: 4, color: delta.riskScore < 0 ? "#16a34a" : delta.riskScore > 0 ? "#dc2626" : "#64748b" }}>({delta.riskScore > 0 ? "+" : ""}{delta.riskScore})</code>
                            </span>
                            <span style={{ color: "#94a3b8" }}>|</span>
                            <span>
                              findings: <code>{snapB.findingsCount}</code> → <code style={{ color: delta.findingsCount < 0 ? "#16a34a" : "#64748b" }}>{snapA.findingsCount}</code>
                              <code style={{ marginLeft: 4, color: delta.findingsCount < 0 ? "#16a34a" : delta.findingsCount > 0 ? "#dc2626" : "#64748b" }}>({delta.findingsCount > 0 ? "+" : ""}{delta.findingsCount})</code>
                            </span>
                          </div>

                          {/* Snapshot details (finding codes, risk level) */}
                          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11, color: "#94a3b8" }}>
                            <span>level: {snapB.riskLevel} → {snapA.riskLevel}</span>
                            <span>candidates: {snapB.actionCandidatesCount} → {snapA.actionCandidatesCount}</span>
                          </div>

                          {/* Patch details */}
                          {app.patch && (
                            <details style={{ marginTop: 8 }}>
                              <summary style={{ cursor: "pointer", fontSize: 12, color: "#334155" }}>Näita patch</summary>
                              <pre style={{ marginTop: 8, maxHeight: 256, overflow: "auto", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc", padding: 8, fontSize: 11, color: "#334155" }}>
                                {formatValue(app.patch)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* RULE TRACE — findings with grouped actionCandidate events */}
              <div style={sectionBox}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>Rule trace (current evaluation)</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>
                    events: <code>{currentTrace?.events?.length ?? 0}</code>
                  </div>
                </div>

                {hasCurrent ? (
                  <div style={{ marginTop: 12 }}>
                    {(() => {
                      const events = currentTrace.events;
                      const findings = events
                        .filter((e) => e.kind === "finding")
                        .slice()
                        .sort((a, b) => String(a.findingCode ?? "").localeCompare(String(b.findingCode ?? "")));
                      const candidates = events
                        .filter((e) => e.kind === "actionCandidate")
                        .slice()
                        .sort((a, b) => String(a.candidateId ?? "").localeCompare(String(b.candidateId ?? "")));
                      const candidatesByFinding = {};
                      for (const c of candidates) {
                        const key = String(c.findingCode ?? "");
                        if (!candidatesByFinding[key]) candidatesByFinding[key] = [];
                        candidatesByFinding[key].push(c);
                      }
                      const otherEvents = events.filter((e) => e.kind !== "finding" && e.kind !== "actionCandidate");

                      return (
                        <>
                          {findings.map((f, fi) => (
                            <div key={fi} style={{ marginBottom: 12 }}>
                              <TraceEventCard e={f} />
                              {(candidatesByFinding[f.findingCode] ?? []).map((c, ci) => (
                                <div key={ci} style={{ marginLeft: 20, borderRadius: 6, border: "1px solid #fde68a", background: "#fffbeb", padding: "6px 10px", marginBottom: 4, fontSize: 12 }}>
                                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, color: "#475569" }}>
                                    <code style={{ color: "#92400e", fontWeight: 600 }}>{c.actionCode}</code>
                                    <span>
                                      eligible: <code style={{ color: c.eligible ? "#16a34a" : "#dc2626" }}>{String(c.eligible)}</code>
                                    </span>
                                    {Array.isArray(c.reasons) && (
                                      <span>
                                        reasons: {c.reasons.map((r, ri) => (
                                          <code key={ri} style={{ marginLeft: ri > 0 ? 4 : 0, borderRadius: 3, background: "#f1f5f9", padding: "0 4px", fontSize: 11 }}>{r}</code>
                                        ))}
                                      </span>
                                    )}
                                    {c.rankVector && typeof c.rankVector.primary === "number" && (
                                      <span>
                                        rank: <code style={{ color: c.rankVector.primary < 0 ? "#16a34a" : "#64748b" }}>{c.rankVector.primary}</code>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                          {otherEvents.map((e, i) => (
                            <TraceEventCard key={`other-${i}`} e={e} />
                          ))}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#475569" }}>No trace events on current evaluation.</div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
