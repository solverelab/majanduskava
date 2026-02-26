// src/App.jsx
import { useEffect, useMemo, useState } from "react";
import { defaultPlan, mkApartment, mkCashflowRow, mkInvestmentItem, mkLoan } from "./domain/planSchema";
import { computePlan, euro } from "./engine/computePlan";
import { runPlan, applyActionAndRun, applyOnly, setPreset as setHostPreset, runAutoResolve, SOLVERE_CORE_CONTRACT_VERSION } from "./solvereBridge/majanduskavaHost";
import { buildStateSignature } from "../packages/solvere-core/src/moduleHost.ts";
import { TracePanel } from "./components/TracePanel";

// ── Euro formatting (Estonian: 1 234,56 €) ──
function euroEE(n) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const fixed = abs.toFixed(2);
  const [whole, dec] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "−" : "") + grouped + "," + dec + " \u20ac";
}

// ── Date formatting (DD.MM.YYYY, deterministic, no locale) ──
function formatDateEE(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return "—";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return parts[2] + "." + parts[1] + "." + parts[0];
}
function formatYMEE(ym) {
  if (!ym || typeof ym !== "string") return "—";
  const parts = ym.split("-");
  if (parts.length !== 2) return ym;
  return parts[1] + "." + parts[0];
}

// ── Unified neutral palette ──
const N = {
  bg:      "#f1f5f9",  // page background (slate-100)
  surface: "#ffffff",  // card / form surface
  muted:   "#f8fafc",  // secondary surface (slate-50)
  border:  "#e2e8f0",  // card borders, dividers (slate-200)
  rule:    "#e2e8f0",  // table/row separators
  text:    "#1e293b",  // primary text (slate-800)
  sub:     "#475569",  // secondary text / labels (slate-600)
  dim:     "#94a3b8",  // tertiary / muted text (slate-400)
};

const inputStyle = { padding: "8px 10px", border: `1px solid ${N.border}`, borderRadius: 6, width: "100%" };
const numStyle = { ...inputStyle, fontFamily: "monospace", textAlign: "right" };
const numFocus = (e) => e.target.select();
const btn = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${N.border}`, background: N.surface, cursor: "pointer" };
const card = { border: `1px solid ${N.border}`, borderRadius: 12, padding: 16, background: N.surface };
const tabStack = { display: "flex", flexDirection: "column", gap: 16 };
const fieldLabel = { fontSize: 12, color: N.sub, marginBottom: 4 };

// ── Unified UI state palette ──
const STATE = {
  OK:    { bg: "#f0fdf4", border: "#bbf7d0", color: "#166534" },
  WARN:  { bg: "#fefce8", border: "#fde68a", color: "#854d0e" },
  ERROR: { bg: "#fef2f2", border: "#fecaca", color: "#991b1b" },
};
const stateBadge = (s) => ({
  fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 4,
  background: s.bg, color: s.color,
});

function Issue({ it }) {
  const s = it.severity === "ERROR" ? STATE.ERROR : it.severity === "WARN" ? STATE.WARN : STATE.OK;
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, padding: "10px 12px", borderRadius: 10, marginBottom: 8 }}>
      <b>{it.severity}</b> · {it.message}
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{it.code} · {it.section}</div>
    </div>
  );
}

function Section({ title, items, onApplyAction }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.sub }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map(finding => (
          <div
            key={finding.id}
            style={{ borderRadius: 12, border: `1px solid ${N.border}`, background: N.surface, padding: 16 }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: N.text }}>
              {finding.title}
            </div>
            {finding.message && (
              <div style={{ marginTop: 4, fontSize: 12, color: N.sub }}>
                {finding.message}
              </div>
            )}
            {finding.actions?.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {finding.actions.map(action => (
                  <button
                    key={action.id}
                    onClick={() => onApplyAction(action)}
                    style={{
                      width: "100%",
                      borderRadius: 6,
                      border: `1px solid ${N.border}`,
                      background: N.muted,
                      padding: "8px 12px",
                      textAlign: "left",
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>{action.label}</span>
                      {typeof action.impact?.riskScoreDelta === "number" && (
                        <span style={{ fontSize: 12, color: N.sub }}>
                          {action.impact.riskScoreDelta < 0
                            ? `Risk ${action.impact.riskScoreDelta}`
                            : `Risk +${action.impact.riskScoreDelta}`}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [sec, setSec] = useState(0);
  const [plan, setPlan] = useState(() => defaultPlan({ year: 2026 }));
  const [preset, setPreset] = useState("BALANCED");

  const derived = useMemo(() => computePlan(plan), [plan]);

  // ── Solvere policy evaluation ──
  const [evaluation, setEvaluation] = useState(null);
  const [solvereMetrics, setSolvereMetrics] = useState(null);
  const [uiError, setUiError] = useState(null);
  const [solveStatus, setSolveStatus] = useState("");
  const [isSolving, setIsSolving] = useState(false);
  const [solveAllResult, setSolveAllResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [pilotFeedbackOpen, setPilotFeedbackOpen] = useState(false);
  const [showTechnicalInfo, setShowTechnicalInfo] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  const onPrint = () => {
    setIsPrinting(true);
    // Wait one frame for React to render all sections
    requestAnimationFrame(() => {
      document.body.classList.add("print-mode");
      try {
        window.print();
      } finally {
        document.body.classList.remove("print-mode");
        setIsPrinting(false);
      }
    });
  };
  useEffect(() => {
    try {
      setHostPreset(preset);
      const res = runPlan(plan);
      setSolvereMetrics(res.metrics);
      setEvaluation(res.evaluation);
    } catch (err) {
      console.error("Solvere runPlan error:", err);
    }
  }, [plan, preset]);

  const onApplyAction = (action) => {
    try {
      setUiError(null);
      const res = applyActionAndRun(plan, action);
      setPlan(res.state);
      setSolvereMetrics(res.metrics);
      setEvaluation(res.evaluation);
    } catch (err) {
      const message =
        (err && typeof err === "object" && "message" in err && err.message) ?
          String(err.message) :
          "Tegevuse rakendamine ebaõnnestus.";
      setUiError(message);
      console.error("Apply action failed:", err);
    }
  };

  // Collect all actions from all findings
  const allActions = (evaluation?.findings ?? []).flatMap(f => f.actions ?? []);

  const onSolveAll = () => {
    if (isSolving) return;
    try {
      setUiError(null);
      setSolveStatus("");
      setIsSolving(true);

      const result = runAutoResolve({
        initialState: plan,
        evaluate: (s) => runPlan(s).evaluation,
        apply: (s, a) => applyOnly(s, a),
        maxSteps: 10,
      });

      // üks final run, et metrics + evaluation oleks sünkroonis
      const finalRun = runPlan(result.state);
      setSolveAllResult(result);
      setPlan(result.state);
      setSolvereMetrics(finalRun.metrics);
      setEvaluation(finalRun.evaluation);

      const msg =
        result.stoppedBecause === "NO_ACTIONS"
          ? "Enam soovitusi pole."
          : result.stoppedBecause === "NO_PROGRESS"
          ? "Lõpetan: risk ega hoiatuste/vead ei paranenud."
          : result.stoppedBecause === "LOOP_GUARD"
          ? "Lõpetan: korduv soovitus."
          : result.stoppedBecause === "MAX_STEPS"
          ? "Lõpetan: max sammud täis."
          : "Valmis.";
      setSolveStatus(msg);
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err && err.message
          ? String(err.message)
          : "Soovituste rakendamine ebaõnnestus.";
      setUiError(message);
      console.error("SolveAll failed:", err);
    } finally {
      setIsSolving(false);
    }
  };

  const onExportJSON = () => {
    const bundle = {
      schemaVersion: "majanduskavaExport/v1",
      moduleId: "majanduskava",
      preset,
      policyVersion: evaluation?.policyVersion ?? "",
      stateSignature: buildStateSignature(plan),
      state: plan,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "majanduskava.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportJSON = (e) => {
    setImportError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const hasCompositeSchema = data.schemaVersion === "majanduskavaExport/v1";
        const hasSplitSchema = data.type === "majanduskavaExport" && data.version === "v1";
        if (!hasCompositeSchema && !hasSplitSchema) {
          setImportError("Toetamata ekspordi versioon. Oodatud: majanduskavaExport/v1");
          return;
        }
        if (data.moduleId !== "majanduskava") {
          setImportError("Vale moodul: moduleId peab olema \"majanduskava\".");
          return;
        }
        if (!data.state || typeof data.state !== "object") {
          setImportError("Fail ei sisalda plaani andmeid (state puudub).");
          return;
        }

        // Dry-run: validate that imported state produces a valid evaluation
        const candidateState = data.state;
        let dryRunResult;
        try {
          dryRunResult = runPlan(candidateState);
        } catch (err) {
          setImportError("Import ebaõnnestus: dry-run kontroll ebaõnnestus — " + (err.message || "tundmatu viga"));
          return;
        }
        const ev = dryRunResult.evaluation;
        if (!ev || !ev.trace || ev.trace.schemaVersion !== "trace/v1") {
          setImportError("Import ebaõnnestus: evaluation trace/v1 kontroll ebaõnnestus.");
          return;
        }

        // Dry-run passed — commit state
        if (data.preset) {
          setPreset(data.preset);
          setHostPreset(data.preset);
        }
        setPlan(candidateState);
        setSolvereMetrics(dryRunResult.metrics);
        setEvaluation(ev);
        setImportError(null);
      } catch {
        setImportError("Faili lugemine ebaõnnestus: vigane JSON.");
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const apts = plan.building.apartments;

  const updateApartment = (id, patch) => {
    setPlan(p => ({
      ...p,
      building: {
        ...p.building,
        apartments: p.building.apartments.map(a => a.id === id ? { ...a, ...patch } : a),
      },
    }));
  };

  const addApartment = () => {
    setPlan(p => ({
      ...p,
      building: { ...p.building, apartments: [...p.building.apartments, mkApartment({ label: String(p.building.apartments.length + 1), areaM2: 0 })] },
    }));
  };

  const removeApartment = (id) => {
    setPlan(p => ({
      ...p,
      building: { ...p.building, apartments: p.building.apartments.filter(a => a.id !== id) },
    }));
  };

  const addRow = (side) => {
    const row = mkCashflowRow({
      side,
      legal: {
        bucket: "OPERATIONAL",
        category: side === "COST" ? "MAINTENANCE" : "OTHER",
        targetedFund: null,
      },
      calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } },
    });
    setPlan(p => ({
      ...p,
      budget: {
        ...p.budget,
        costRows: side === "COST" ? [...p.budget.costRows, row] : p.budget.costRows,
        incomeRows: side === "INCOME" ? [...p.budget.incomeRows, row] : p.budget.incomeRows,
      },
    }));
  };

  const updateRow = (side, id, patch) => {
    setPlan(p => ({
      ...p,
      budget: {
        ...p.budget,
        costRows: side === "COST" ? p.budget.costRows.map(r => r.id === id ? { ...r, ...patch } : r) : p.budget.costRows,
        incomeRows: side === "INCOME" ? p.budget.incomeRows.map(r => r.id === id ? { ...r, ...patch } : r) : p.budget.incomeRows,
      },
    }));
  };

  const removeRow = (side, id) => {
    setPlan(p => ({
      ...p,
      budget: {
        ...p.budget,
        costRows: side === "COST" ? p.budget.costRows.filter(r => r.id !== id) : p.budget.costRows,
        incomeRows: side === "INCOME" ? p.budget.incomeRows.filter(r => r.id !== id) : p.budget.incomeRows,
      },
    }));
  };

  const addInvestment = () => {
    setPlan(p => ({
      ...p,
      investmentsPipeline: {
        ...p.investmentsPipeline,
        items: [...p.investmentsPipeline.items, mkInvestmentItem({ plannedYear: p.period.year, quarter: "Q1", totalCostEUR: 0 })],
      },
    }));
  };

  const updateInvestment = (id, patch) => {
    setPlan(p => ({
      ...p,
      investmentsPipeline: {
        ...p.investmentsPipeline,
        items: p.investmentsPipeline.items.map(it => it.id === id ? { ...it, ...patch } : it),
      },
    }));
  };
// --- INVESTEERINGU RAHASTUSREAD ---

const addInvFundingRow = (invId) => {
  setPlan(p => ({
    ...p,
    investmentsPipeline: {
      ...p.investmentsPipeline,
      items: p.investmentsPipeline.items.map(it =>
        it.id === invId
          ? {
              ...it,
              fundingPlan: [
                ...(it.fundingPlan || []),
                { source: "REPAIR_FUND", amountEUR: 0, loanId: "" },
              ],
            }
          : it
      ),
    },
  }));
};

const updateInvFundingRow = (invId, rowIndex, patch) => {
  setPlan(p => ({
    ...p,
    investmentsPipeline: {
      ...p.investmentsPipeline,
      items: p.investmentsPipeline.items.map(it =>
        it.id === invId
          ? {
              ...it,
              fundingPlan: (it.fundingPlan || []).map((row, i) =>
                i === rowIndex ? { ...row, ...patch } : row
              ),
            }
          : it
      ),
    },
  }));
};

const removeInvFundingRow = (invId, rowIndex) => {
  setPlan(p => ({
    ...p,
    investmentsPipeline: {
      ...p.investmentsPipeline,
      items: p.investmentsPipeline.items.map(it =>
        it.id === invId
          ? {
              ...it,
              fundingPlan: (it.fundingPlan || []).filter((_, i) => i !== rowIndex),
            }
          : it
      ),
    },
  }));
};

  const addLoan = () => {
    setPlan(p => ({ ...p, loans: [...p.loans, mkLoan({ principalEUR: 50000, startYM: `${p.period.year}-01` })] }));
  };

  const updateLoan = (id, patch) => {
    setPlan(p => ({ ...p, loans: p.loans.map(ln => ln.id === id ? { ...ln, ...patch } : ln) }));
  };

  const removeLoan = (id) => {
    setPlan(p => ({ ...p, loans: p.loans.filter(ln => ln.id !== id) }));
  };

  const SECS = ["Periood & korterid", "Investeeringud", "Kulud", "Tulud", "Fondid & laen", "Korterite maksed", "Kontroll & kokkuvõte"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", minHeight: "100vh", background: N.bg }}>
      <aside style={{ background: "#111827", color: "#e5e7eb", padding: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 12 }}>Majanduskava</div>
        {SECS.map((name, i) => (
          <div
            key={name}
            onClick={() => setSec(i)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              cursor: "pointer",
              marginBottom: 6,
              background: sec === i ? "#f59e0b" : "transparent",
              color: sec === i ? "#111827" : "#e5e7eb",
              fontWeight: sec === i ? 800 : 500,
            }}
          >
            {name}
          </div>
        ))}
      </aside>

      <main style={{ padding: 18, maxWidth: 1100, position: "relative" }}>
        {import.meta.env.DEV && (
          <div style={{
            position: "absolute", top: 8, right: 12,
            fontSize: 10, fontWeight: 700, fontFamily: "monospace",
            padding: "2px 8px", borderRadius: 4,
            background: STATE.WARN.bg,
            color: STATE.WARN.color,
            letterSpacing: "0.04em",
            userSelect: "none",
          }}>
            DEV MODE
          </div>
        )}
        {sec === 0 && (
          <div style={tabStack}>
            <div style={card}>
              <h2 style={{ margin: "0 0 12px" }}>Periood</h2>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={fieldLabel}>Algus</div>
                  <input
                    type="date"
                    value={plan.period.start}
                    onChange={(e) => setPlan(p => ({ ...p, period: { ...p.period, start: e.target.value } }))}
                    style={inputStyle}
                  />
                  <div style={{ marginTop: 4, fontSize: 12, fontFamily: "monospace", color: N.dim }}>{formatDateEE(plan.period.start)}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={fieldLabel}>Lõpp</div>
                  <input
                    type="date"
                    value={plan.period.end}
                    onChange={(e) => setPlan(p => ({ ...p, period: { ...p.period, end: e.target.value } }))}
                    style={inputStyle}
                  />
                  <div style={{ marginTop: 4, fontSize: 12, fontFamily: "monospace", color: N.dim }}>{formatDateEE(plan.period.end)}</div>
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Korterid</h2>
                <button style={btn} onClick={addApartment}>+ Lisa korter</button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: 12, color: N.sub }}>
                    <th style={{ padding: "6px 8px" }}>Tähis</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Pind m²</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Osa</th>
                    <th style={{ padding: "6px 8px" }}>Märkused</th>
                    <th style={{ padding: "6px 8px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {apts.map((a, idx) => {
                    const share = derived.building.totAreaM2 > 0 ? (a.areaM2 / derived.building.totAreaM2) : 0;
                    return (
                      <tr key={a.id} style={{ borderTop: `1px solid ${N.rule}` }}>
                        <td style={{ padding: "6px 8px" }}><input value={a.label} onChange={(e) => updateApartment(a.id, { label: e.target.value })} style={inputStyle} /></td>
                        <td style={{ padding: "6px 8px" }}><input value={a.areaM2} onChange={(e) => updateApartment(a.id, { areaM2: Number(e.target.value) || 0 })} onFocus={numFocus} style={numStyle} /></td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace" }}>{(share * 100).toFixed(2)}%</td>
                        <td style={{ padding: "6px 8px" }}><input value={a.notes} onChange={(e) => updateApartment(a.id, { notes: e.target.value })} style={inputStyle} /></td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <button style={btn} onClick={() => removeApartment(a.id)}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontFamily: "monospace" }}>
                Kokku: {derived.building.apartmentsCount} korterit · {derived.building.totAreaM2.toFixed(2)} m²
              </div>
            </div>
          </div>
        )}

        {sec === 1 && (
          <div style={tabStack}>
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Investeeringud (pipeline)</h2>
                <button style={btn} onClick={addInvestment}>+ Lisa investeering</button>
              </div>

              {plan.investmentsPipeline.items.length === 0 && <div style={{ opacity: 0.7 }}>Investeeringuid pole lisatud.</div>}

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {plan.investmentsPipeline.items.map(it => (
                  <div key={it.id} style={{ border: `1px solid ${N.rule}`, borderRadius: 12, padding: 12 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: 2 }}>
                        <div style={fieldLabel}>Nimetus</div>
                        <input value={it.name} onChange={(e) => updateInvestment(it.id, { name: e.target.value })} style={inputStyle} />
                      </div>
                      <div style={{ width: 120 }}>
                        <div style={fieldLabel}>Aasta</div>
                        <input value={it.plannedYear} onChange={(e) => updateInvestment(it.id, { plannedYear: Number(e.target.value) || plan.period.year })} onFocus={numFocus} style={numStyle} />
                      </div>
                      <div style={{ width: 120 }}>
                        <div style={fieldLabel}>Kvartal</div>
                        <select value={it.quarter} onChange={(e) => updateInvestment(it.id, { quarter: e.target.value })} style={inputStyle}>
                          <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option>
                        </select>
                      </div>
                      <div style={{ width: 160 }}>
                        <div style={fieldLabel}>Maksumus €</div>
                        <input value={it.totalCostEUR} onChange={(e) => updateInvestment(it.id, { totalCostEUR: Number(e.target.value) || 0 })} onFocus={numFocus} style={numStyle} />
                      </div>
                    </div>

                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${N.rule}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>Rahastusplaan</div>
                        <button style={btn} onClick={() => addInvFundingRow(it.id)}>
                          + Lisa rahastusrida
                        </button>
                      </div>

                      {(it.fundingPlan || []).length === 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: N.sub }}>
                          Rahastusridu pole lisatud.
                        </div>
                      )}

                      {(it.fundingPlan || []).map((row, index) => (
                        <div key={index} style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                          <select
                            value={row.source}
                            onChange={(e) =>
                              updateInvFundingRow(it.id, index, { source: e.target.value })
                            }
                            style={inputStyle}
                          >
                            <option value="REPAIR_FUND">Remondifond</option>
                            <option value="RESERVE">Reservkapital</option>
                            <option value="LOAN">Laen</option>
                            <option value="GRANT">Toetus</option>
                            <option value="ONE_OFF">Erakorraline makse</option>
                          </select>

                          <input
                            type="number"
                            value={row.amountEUR}
                            onChange={(e) =>
                              updateInvFundingRow(it.id, index, {
                                amountEUR: Number(e.target.value) || 0,
                              })
                            }
                            onFocus={numFocus} style={numStyle}
                          />

                          <button onClick={() => removeInvFundingRow(it.id, index)} style={btn}>
                            Eemalda
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 12, fontFamily: "monospace" }}>
                Selle aasta investeeringud: {derived.investments.thisYearCount} · maksumus {euro(derived.investments.costThisYearEUR)}
              </div>
            </div>
          </div>
        )}

        {(sec === 2 || sec === 3) && (() => {
          const side = sec === 2 ? "COST" : "INCOME";
          const rows = side === "COST" ? plan.budget.costRows : plan.budget.incomeRows;
          return (
            <div style={tabStack}>
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ margin: 0 }}>{side === "COST" ? "Kulud" : "Tulud"}</h2>
                  <button style={btn} onClick={() => addRow(side)}>+ Lisa rida</button>
                </div>

                {rows.length === 0 && <div style={{ opacity: 0.7 }}>Ridu pole lisatud.</div>}

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {rows.map(r => (
                    <div key={r.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ flex: 2 }}>
                          <div style={fieldLabel}>Nimetus</div>
                          <input value={r.name} onChange={(e) => updateRow(side, r.id, { name: e.target.value })} style={inputStyle} />
                        </div>

                        <div style={{ width: 190 }}>
                          <div style={fieldLabel}>Arvutus</div>
                          <select
                            value={r.calc.type}
                            onChange={(e) => {
                              const t = e.target.value;
                              const params =
                                t === "FIXED_PERIOD" ? { amountEUR: 0 } :
                                t === "MONTHLY_FIXED" ? { monthlyEUR: 0 } :
                                t === "ANNUAL_FIXED" ? { annualEUR: 0 } :
                                { qty: 0, unitEUR: 0 };
                              updateRow(side, r.id, { calc: { type: t, params } });
                            }}
                            style={inputStyle}
                          >
                            <option value="FIXED_PERIOD">Perioodisumma</option>
                            <option value="MONTHLY_FIXED">Kuutasu</option>
                            <option value="ANNUAL_FIXED">Aastane</option>
                            <option value="QTY_PRICE_ANNUAL">Kogus × hind/a</option>
                          </select>
                        </div>

                        <div style={{ width: 180 }}>
                          <div style={fieldLabel}>Summa / parameeter</div>
                          {r.calc.type === "FIXED_PERIOD" && (
                            <input value={r.calc.params.amountEUR} onChange={(e) => updateRow(side, r.id, { calc: { ...r.calc, params: { amountEUR: Number(e.target.value) || 0 } } })} onFocus={numFocus} style={numStyle} />
                          )}
                          {r.calc.type === "MONTHLY_FIXED" && (
                            <input value={r.calc.params.monthlyEUR} onChange={(e) => updateRow(side, r.id, { calc: { ...r.calc, params: { monthlyEUR: Number(e.target.value) || 0 } } })} onFocus={numFocus} style={numStyle} />
                          )}
                          {r.calc.type === "ANNUAL_FIXED" && (
                            <input value={r.calc.params.annualEUR} onChange={(e) => updateRow(side, r.id, { calc: { ...r.calc, params: { annualEUR: Number(e.target.value) || 0 } } })} onFocus={numFocus} style={numStyle} />
                          )}
                          {r.calc.type === "QTY_PRICE_ANNUAL" && (
                            <div style={{ display: "flex", gap: 8 }}>
                              <input value={r.calc.params.qty} onChange={(e) => updateRow(side, r.id, { calc: { ...r.calc, params: { ...r.calc.params, qty: Number(e.target.value) || 0 } } })} onFocus={numFocus} style={numStyle} />
                              <input value={r.calc.params.unitEUR} onChange={(e) => updateRow(side, r.id, { calc: { ...r.calc, params: { ...r.calc.params, unitEUR: Number(e.target.value) || 0 } } })} onFocus={numFocus} style={numStyle} />
                            </div>
                          )}
                        </div>

                        <div style={{ width: 120, alignSelf: "end" }}>
                          <button style={btn} onClick={() => removeRow(side, r.id)}>Eemalda</button>
                        </div>
                      </div>

                      <div style={{ marginTop: 6, fontSize: 12, color: N.sub }}>
                        Legal: {r.legal.bucket}/{r.legal.category}{r.legal.targetedFund ? ` (${r.legal.targetedFund})` : ""}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 12, fontFamily: "monospace" }}>
                  {side === "COST"
                    ? <>Kulud perioodis: {euro(derived.totals.costPeriodEUR)} · kuus {euro(derived.totals.costMonthlyEUR)}/kuu</>
                    : <>Tulud perioodis: {euro(derived.totals.incomePeriodEUR)} · kuus {euro(derived.totals.incomeMonthlyEUR)}/kuu</>
                  }
                </div>
              </div>
            </div>
          );
        })()}

        {sec === 4 && (
          <div style={tabStack}>
            <div style={card}>
              <h2 style={{ margin: "0 0 12px" }}>Remondifond & reserv</h2>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ width: 220 }}>
                  <div style={fieldLabel}>Remondifondi määr (€/m²/kuu)</div>
                  <input
                    value={plan.funds.repairFund.monthlyRateEurPerM2}
                    onChange={(e) => setPlan(p => ({ ...p, funds: { ...p.funds, repairFund: { monthlyRateEurPerM2: Number(e.target.value) || 0 } } }))}
                    onFocus={numFocus} style={numStyle}
                  />
                </div>

                <div style={{ width: 260 }}>
                  <div style={fieldLabel}>Remondifondi laekumine perioodis</div>
                  <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 800 }}>
                    {euro(derived.funds.repairFundIncomePeriodEUR)}
                  </div>
                </div>

                <div style={{ width: 220 }}>
                  <div style={fieldLabel}>Planeeritud reserv €</div>
                  <input
                    value={plan.funds.reserve.plannedEUR}
                    onChange={(e) => setPlan(p => ({ ...p, funds: { ...p.funds, reserve: { ...p.funds.reserve, plannedEUR: Number(e.target.value) || 0 } } }))}
                    onFocus={numFocus} style={numStyle}
                  />
                </div>

                <div style={{ width: 260 }}>
                  <div style={fieldLabel}>Nõutav reserv</div>
                  <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 800 }}>
                    {euro(derived.funds.reserveRequiredEUR)}
                  </div>
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Laenud</h2>
                <button style={btn} onClick={addLoan}>+ Lisa laen</button>
              </div>

              {plan.loans.length === 0 && <div style={{ opacity: 0.7 }}>Laene pole lisatud.</div>}

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {plan.loans.map(ln => {
                  const d = derived.loans.items.find(x => x.id === ln.id);
                  return (
                    <div key={ln.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ flex: 2 }}>
                          <div style={fieldLabel}>Nimi</div>
                          <input value={ln.name} onChange={(e) => updateLoan(ln.id, { name: e.target.value })} style={inputStyle} />
                        </div>
                        <div style={{ width: 160 }}>
                          <div style={fieldLabel}>Summa €</div>
                          <input value={ln.principalEUR} onChange={(e) => updateLoan(ln.id, { principalEUR: Number(e.target.value) || 0 })} onFocus={numFocus} style={numStyle} />
                        </div>
                        <div style={{ width: 140 }}>
                          <div style={fieldLabel}>Intress %/a</div>
                          <input value={ln.annualRatePct} onChange={(e) => updateLoan(ln.id, { annualRatePct: Number(e.target.value) || 0 })} onFocus={numFocus} style={numStyle} />
                        </div>
                        <div style={{ width: 140 }}>
                          <div style={fieldLabel}>Tähtaeg kuud</div>
                          <input value={ln.termMonths} onChange={(e) => updateLoan(ln.id, { termMonths: Number(e.target.value) || 0 })} onFocus={numFocus} style={numStyle} />
                        </div>
                        <div style={{ width: 140 }}>
                          <div style={fieldLabel}>Algus (KK.AAAA)</div>
                          <input value={ln.startYM} onChange={(e) => updateLoan(ln.id, { startYM: e.target.value })} style={inputStyle} />
                          <div style={{ marginTop: 4, fontSize: 12, fontFamily: "monospace", color: N.dim }}>{formatYMEE(ln.startYM)}</div>
                        </div>
                        <div style={{ width: 140 }}>
                          <div style={fieldLabel}>Reserv %</div>
                          <input value={ln.reservePct} onChange={(e) => updateLoan(ln.id, { reservePct: Number(e.target.value) || 0 })} onFocus={numFocus} style={numStyle} />
                        </div>
                        <div style={{ width: 120, alignSelf: "end" }}>
                          <button style={btn} onClick={() => removeLoan(ln.id)}>Eemalda</button>
                        </div>
                      </div>

                      {d && (
                        <div style={{ marginTop: 12, fontFamily: "monospace" }}>
                          Teenindus perioodis: {euro(d.servicingPeriodEUR)} · kuus {euro(d.servicingMonthlyEUR)}/kuu · laenureserv perioodis: {euro(d.reservePeriodEUR)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 12, fontFamily: "monospace" }}>
                Laenuteenindus kokku perioodis: {euro(derived.loans.servicePeriodEUR)} · laenureserv perioodis: {euro(derived.loans.reservePeriodEUR)}
              </div>
            </div>
          </div>
        )}

        {sec === 5 && (
          <div style={tabStack}>
            <div style={card}>
              <h2 style={{ margin: "0 0 12px" }}>Korterite kuumaksed (m² järgi)</h2>
              <div style={{ fontFamily: "monospace", marginBottom: 12 }}>
                Omanike kuuvajadus: {euro(derived.totals.ownersNeedMonthlyEUR)}/kuu
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: 12, color: N.sub }}>
                    <th>Korter</th>
                    <th style={{ textAlign: "right" }}>m²</th>
                    <th style={{ textAlign: "right" }}>Osa</th>
                    <th style={{ textAlign: "right" }}>Tegevus €/kuu</th>
                    <th style={{ textAlign: "right" }}>Remondifond €/kuu</th>
                    <th style={{ textAlign: "right" }}>Kokku €/kuu</th>
                  </tr>
                </thead>
                <tbody>
                  {derived.apartmentPayments.map(pmt => (
                    <tr key={pmt.aptId} style={{ borderTop: `1px solid ${N.rule}` }}>
                      <td><b>{pmt.label}</b></td>
                      <td style={{ textAlign: "right", fontFamily: "monospace" }}>{pmt.areaM2.toFixed(2)}</td>
                      <td style={{ textAlign: "right", fontFamily: "monospace" }}>{(pmt.share * 100).toFixed(2)}%</td>
                      <td style={{ textAlign: "right", fontFamily: "monospace" }}>{euro(pmt.operationalMonthlyEUR)}</td>
                      <td style={{ textAlign: "right", fontFamily: "monospace" }}>{euro(pmt.repairFundMonthlyEUR)}</td>
                      <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 900 }}>{euro(pmt.totalMonthlyEUR)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sec === 6 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── Pilot checklist ── */}
            {showTechnicalInfo && (
            <div style={{ border: `1px solid ${N.border}`, borderRadius: 12, padding: 20, background: N.surface }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.sub }}>
                  Pilot launch checklist
                </div>
              </div>
              {[
                "Print vaade kontrollitud (Prindi kokkuvõte)",
                "JSON export tehtud ja import round-trip kontrollitud",
                "policyVersion / reportDigest / stateSignature kuvatud printis",
                "loopGuard ei blokeeri (status OK)",
                "Deploy URL avatud ja assets laadivad",
                "Piloot: 1 ühistu sisestus testitud algusest lõpuni",
              ].map((label) => (
                <label key={label} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8, fontSize: 14, cursor: "pointer" }}>
                  <input type="checkbox" style={{ marginTop: 3 }} />
                  <span>{label}</span>
                </label>
              ))}
              <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12, marginTop: 8 }}>
                <span
                  onClick={() => setPilotFeedbackOpen(v => !v)}
                  style={{ fontSize: 13, color: "#2563eb", cursor: "pointer", textDecoration: "underline" }}
                >
                  {pilotFeedbackOpen ? "Peida juhis" : "Piloodi tagasiside — mida täpselt kirja panna"}
                </span>
                {pilotFeedbackOpen && (
                  <div style={{ marginTop: 8, fontSize: 13, color: N.sub, lineHeight: 1.6 }}>
                    <b>Kirjuta üles:</b>
                    <ul style={{ marginTop: 4, paddingLeft: 20 }}>
                      <li>Mis andmed sisestasid (korterite arv, pind, kulud, tulud, laenud)</li>
                      <li>Kas "Rakenda soovitused" töötas ootuspäraselt — mitu sammu tehti, mis muutus</li>
                      <li>Kas JSON export/import säilitas kõik andmed</li>
                      <li>Kas prinditud kokkuvõte oli arusaadav</li>
                      <li>Mis oli segane, puudu või valesti</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* ── Kokkuvõte ── */}
            {(() => {
              const netState = derived.totals.netOperationalPeriodEUR >= 0 ? STATE.OK : STATE.ERROR;
              const summaryCard = { border: `1px solid ${N.border}`, borderRadius: 12, padding: 16, background: N.surface };
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  <div style={summaryCard}>
                    <div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 900 }}>{euro(derived.totals.costPeriodEUR)}</div>
                    <div style={{ fontSize: 12, color: N.sub, marginTop: 4 }}>Kulud perioodis</div>
                    <div style={{ fontSize: 12, color: N.dim, marginTop: 2 }}>{euro(derived.totals.costMonthlyEUR)}/kuu</div>
                  </div>
                  <div style={summaryCard}>
                    <div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 900 }}>{euro(derived.totals.incomePeriodEUR)}</div>
                    <div style={{ fontSize: 12, color: N.sub, marginTop: 4 }}>Tulud perioodis</div>
                    <div style={{ fontSize: 12, color: N.dim, marginTop: 2 }}>{euro(derived.totals.incomeMonthlyEUR)}/kuu</div>
                  </div>
                  <div style={{ ...summaryCard, borderColor: netState.border, background: netState.bg }}>
                    <div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 900, color: netState.color }}>
                      {euro(derived.totals.netOperationalPeriodEUR)}
                    </div>
                    <div style={{ fontSize: 12, color: netState.color, marginTop: 4 }}>Neto tegevus</div>
                    <div style={{ fontSize: 12, color: N.dim, marginTop: 2 }}>{euro(derived.totals.netOperationalMonthlyEUR)}/kuu</div>
                  </div>
                  <div style={summaryCard}>
                    <div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 900 }}>{euro(derived.totals.ownersNeedMonthlyEUR)}/kuu</div>
                    <div style={{ fontSize: 12, color: N.sub, marginTop: 4 }}>Omanike kuumakse</div>
                    <div style={{ fontSize: 12, color: N.dim, marginTop: 2 }}>= tegevus + laen + laenureserv</div>
                  </div>
                </div>
              );
            })()}

            {/* ── Poliitika & soovitused ── */}
            <div style={{ border: `1px solid ${N.border}`, borderRadius: 12, padding: 20, background: N.surface }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.sub }}>
                  Poliitika & soovitused
                </div>
                <span style={{ fontSize: 12, fontFamily: "monospace", color: N.sub }}>{preset}</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Preset</div>
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                  style={{ borderRadius: 6, border: `1px solid ${N.border}`, background: N.surface, padding: "4px 8px", fontSize: 14 }}
                >
                  <option value="BALANCED">BALANCED</option>
                  <option value="CONSERVATIVE">CONSERVATIVE</option>
                  <option value="LOAN_FRIENDLY">LOAN_FRIENDLY</option>
                </select>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={onSolveAll}
                  disabled={isSolving || !allActions.length}
                  style={{
                    ...btn,
                    background: "#111827",
                    color: "#fff",
                    padding: "8px 12px",
                    fontSize: 14,
                    opacity: (isSolving || !allActions.length) ? 0.5 : 1,
                  }}
                >
                  {isSolving ? "Rakendan…" : "Rakenda soovitused"}
                </button>
                {solveStatus ? (
                  <span style={{ fontSize: 12, opacity: 0.75 }}>{solveStatus}</span>
                ) : null}
              </div>
            </div>

            {/* ── Riskitase ── */}
            {evaluation?.risk && (
              <div style={{ border: `1px solid ${N.border}`, borderRadius: 12, padding: 20, background: N.surface }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.sub }}>
                    Riskitase
                  </div>
                  <span style={stateBadge(evaluation.risk.level === "low" ? STATE.OK : evaluation.risk.level === "medium" ? STATE.WARN : STATE.ERROR)}>
                    {evaluation.risk.level.toUpperCase()}
                  </span>
                </div>
                {showTechnicalInfo && (
                  <div style={{ fontSize: 30, fontWeight: 700 }}>
                    {evaluation.risk.score}
                  </div>
                )}
                {evaluation.risk.reason && (
                  <div style={{ marginTop: 8, fontSize: 12, color: N.sub }}>
                    {evaluation.risk.reason}
                  </div>
                )}
              </div>
            )}

            {/* ── UI error ── */}
            {uiError && (
              <div style={{ border: `1px solid ${STATE.ERROR.border}`, borderRadius: 12, padding: 20, background: STATE.ERROR.bg }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: STATE.ERROR.color }}>
                    Viga
                  </div>
                  <span style={stateBadge(STATE.ERROR)}>ERROR</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: STATE.ERROR.color }}>Ei saanud muudatust rakendada</div>
                <div style={{ marginTop: 4, fontSize: 12, color: STATE.ERROR.color }}>{uiError}</div>
                <button
                  style={{ marginTop: 8, fontSize: 12, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: STATE.ERROR.color }}
                  onClick={() => setUiError(null)}
                >
                  Sulge
                </button>
              </div>
            )}

            {/* ── Findings ── */}
            {(() => {
              const errors = evaluation?.findings.filter(f => f.severity === "error") ?? [];
              const warnings = evaluation?.findings.filter(f => f.severity === "warning") ?? [];
              const infos = evaluation?.findings.filter(f => f.severity === "info") ?? [];
              return (
                <>
                  {errors.length > 0 && (
                    <Section title="Vead" items={errors} onApplyAction={onApplyAction} />
                  )}
                  {warnings.length > 0 && (
                    <Section title="Hoiatused" items={warnings} onApplyAction={onApplyAction} />
                  )}
                  {infos.length > 0 && (
                    <Section title="Info" items={infos} onApplyAction={onApplyAction} />
                  )}
                </>
              );
            })()}

            {/* ── TracePanel ── */}
            {showTechnicalInfo && (
              <TracePanel evaluation={evaluation} steps={solveAllResult?.steps} stop={solveAllResult?.stop} />
            )}

            {/* ── A) Vastavuse kokkuvõte (technical only) ── */}
            {showTechnicalInfo && (
              <div style={{ border: `1px solid ${N.border}`, borderRadius: 12, padding: 20, background: N.surface }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.sub }}>
                    Vastavuse kokkuvõte
                  </div>
                  {(() => {
                    const candidates = evaluation?.actionCandidates ?? [];
                    const eligible = candidates.filter(c => c.isEligible).length;
                    const guardOk = eligible > 0 || candidates.length === 0;
                    const reportOk = !solveAllResult?.report || solveAllResult.report.stop.reason === "NO_ACTIONS" || solveAllResult.report.final.riskScore === 0;
                    const allOk = guardOk && reportOk;
                    return (
                      <span style={stateBadge(allOk ? STATE.OK : STATE.WARN)}>
                        {allOk ? "OK" : "Kontrollida"}
                      </span>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, color: N.sub, minWidth: 90 }}>loopGuard</span>
                  {(() => {
                    const candidates = evaluation?.actionCandidates ?? [];
                    const eligible = candidates.filter(c => c.isEligible).length;
                    const ok = eligible > 0 || candidates.length === 0;
                    return (
                      <span style={stateBadge(ok ? STATE.OK : STATE.ERROR)}>
                        {ok ? "OK" : "BLOCKED"}
                      </span>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: N.sub, minWidth: 90 }}>RunReport</span>
                  {(() => {
                    if (!solveAllResult?.report) {
                      return <span style={{ fontSize: 12, color: N.dim }}>Andmed puuduvad (Solve tegemata)</span>;
                    }
                    const r = solveAllResult.report;
                    const ok = r.stop.reason === "NO_ACTIONS" || r.final.riskScore === 0;
                    return (
                      <span style={stateBadge(ok ? STATE.OK : STATE.WARN)}>
                        {ok ? "OK" : "Tähelepanu vajab"}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ── Prindi + Ekspordi nupud (always visible) ── */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                style={{ ...btn, padding: "10px 16px", fontWeight: 800, opacity: derived.controls.hasErrors ? 0.5 : 1 }}
                disabled={derived.controls.hasErrors}
                onClick={onPrint}
                title={derived.controls.hasErrors ? "Paranda vead enne printimist" : "Prindi"}
              >
                Prindi kokkuvõte
              </button>
            </div>

            {/* ── B) Ekspordi / impordi ── */}
            <div style={{ border: `1px solid ${N.border}`, borderRadius: 12, padding: 20, background: N.surface }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.sub }}>
                  Ekspordi / impordi
                </div>
                {showTechnicalInfo && <span style={{ fontSize: 11, fontFamily: "monospace", color: N.dim }}>majanduskavaExport/v1</span>}
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={onExportJSON} style={{ ...btn, background: "#111827", color: "#fff" }}>
                  Salvesta (JSON)
                </button>
                <label style={{ ...btn, display: "inline-block", cursor: "pointer" }}>
                  Laadi (JSON)
                  <input
                    type="file"
                    accept=".json"
                    onChange={onImportJSON}
                    style={{ display: "none" }}
                  />
                </label>
              </div>
              {importError && (
                <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: STATE.ERROR.bg, border: `1px solid ${STATE.ERROR.border}`, fontSize: 13, color: STATE.ERROR.color }}>
                  {importError}
                </div>
              )}
            </div>

            {/* ── C) Süsteemi info ── */}
            {showTechnicalInfo && (
            <div style={{ border: `1px solid ${N.border}`, borderRadius: 12, padding: 20, background: N.muted }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.dim }}>
                  Süsteemi info
                </div>
              </div>
              {[
                { label: "Core Contract", value: SOLVERE_CORE_CONTRACT_VERSION },
                { label: "policyVersion", value: evaluation?.policyVersion },
                { label: "reportDigest", value: solveAllResult?.report?.reportDigest },
                { label: "stateSignature", value: buildStateSignature(plan) },
                { label: "Build", value: typeof __BUILD_COMMIT__ !== "undefined" ? __BUILD_COMMIT__ : "unknown" },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${N.border}` }}>
                  <span style={{ fontSize: 12, color: N.sub }}>{label}</span>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: value ? N.sub : N.dim }}>
                    {value || "—"}
                  </span>
                </div>
              ))}
            </div>
            )}

            {/* ── Dev: tagasiside mall ── */}
            {showTechnicalInfo && (() => {
              const template = [
                "Testjuhtumi nimi:",
                "Eesmärk (mida proovisin teha):",
                "",
                "Mis läks hästi (3 punkti):",
                "  1.",
                "  2.",
                "  3.",
                "",
                "Mis läks segaseks (3 punkti):",
                "  1.",
                "  2.",
                "  3.",
                "",
                "Kus ma jäin toppama (täpne samm/tab):",
                "Ootasin et juhtuks:",
                "Tegelik tulemus:",
                "",
                "Soovitus (mis muudaks paremaks):",
                "",
                "Attach: JSON bundle (jah/ei):",
              ].join("\n");

              return (
                <div style={{ border: `1px solid ${N.border}`, borderRadius: 12, padding: 20, background: N.muted }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.dim }}>
                      Kasutustest — tagasiside mall
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: N.bg, color: N.dim }}>DEV</span>
                  </div>
                  <pre style={{
                    background: N.surface,
                    border: `1px solid ${N.border}`,
                    borderRadius: 8,
                    padding: 14,
                    fontSize: 13,
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.7,
                    color: N.text,
                    margin: 0,
                  }}>
                    {template}
                  </pre>
                  <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
                    <button
                      style={btn}
                      onClick={() => {
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(template);
                        }
                      }}
                    >
                      Kopeeri tagasiside mall
                    </button>
                    <span style={{ fontSize: 12, color: N.dim }}>
                      Kui kopeerimine ei tööta, märgista tekst ja kopeeri käsitsi.
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* ── Toggle: Näita tehnilist infot (bottom) ── */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowTechnicalInfo(v => !v)}
                style={{ ...btn, fontSize: 13, color: N.sub }}
              >
                {showTechnicalInfo ? "Peida tehniline info" : "Näita tehnilist infot"}
              </button>
            </div>

          </div>
        )}

        {/* ── Print-only: all sections rendered for print ── */}
      {isPrinting && (
        <div className="print-content">
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 24 }}>Majanduskava</h1>

          {/* Periood */}
          <div className="print-section">
            <h2 className="print-section-title">Periood & korterid</h2>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 700 }}>Periood:</span> {formatDateEE(plan.period.start)} – {formatDateEE(plan.period.end)}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, borderBottom: "2px solid #000" }}>
                  <th style={{ padding: "4px 8px" }}>Korter</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Pind m²</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Osa</th>
                  <th style={{ padding: "4px 8px" }}>Märkused</th>
                </tr>
              </thead>
              <tbody>
                {apts.map(a => {
                  const share = derived.building.totAreaM2 > 0 ? (a.areaM2 / derived.building.totAreaM2) : 0;
                  return (
                    <tr key={a.id} style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px" }}>{a.label}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{a.areaM2.toFixed(2)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{(share * 100).toFixed(2)}%</td>
                      <td style={{ padding: "4px 8px" }}>{a.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontFamily: "monospace" }}>
              Kokku: {derived.building.apartmentsCount} korterit · {derived.building.totAreaM2.toFixed(2)} m²
            </div>
          </div>

          {/* Investeeringud */}
          <div className="print-section">
            <h2 className="print-section-title">Investeeringud</h2>
            {plan.investmentsPipeline.items.length === 0
              ? <div>Investeeringuid pole lisatud.</div>
              : plan.investmentsPipeline.items.map(it => (
                <div key={it.id} style={{ marginBottom: 8 }}>
                  <div><span style={{ fontWeight: 700 }}>{it.name || "—"}</span> · {it.quarter} {it.plannedYear} · {euroEE(it.totalCostEUR)}</div>
                  {(it.fundingPlan || []).length > 0 && (
                    <div style={{ marginLeft: 16, fontSize: 12 }}>
                      {it.fundingPlan.map((row, i) => (
                        <div key={i}>{row.source}: {euroEE(row.amountEUR)}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            }
          </div>

          {/* Kulud */}
          <div className="print-section">
            <h2 className="print-section-title">Kulud</h2>
            {plan.budget.costRows.length === 0
              ? <div>Kulusid pole lisatud.</div>
              : plan.budget.costRows.map(r => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                  <span>{r.name || "—"}</span>
                  <span style={{ fontFamily: "monospace" }}>
                    {r.calc.type === "FIXED_PERIOD" && euroEE(r.calc.params.amountEUR)}
                    {r.calc.type === "MONTHLY_FIXED" && euroEE(r.calc.params.monthlyEUR) + "/kuu"}
                    {r.calc.type === "ANNUAL_FIXED" && euroEE(r.calc.params.annualEUR) + "/a"}
                    {r.calc.type === "QTY_PRICE_ANNUAL" && (r.calc.params.qty + " × " + euroEE(r.calc.params.unitEUR) + "/a")}
                  </span>
                </div>
              ))
            }
            <div style={{ marginTop: 8, fontWeight: 700, fontFamily: "monospace" }}>
              Kokku: {euroEE(derived.totals.costPeriodEUR)} · {euroEE(derived.totals.costMonthlyEUR)}/kuu
            </div>
          </div>

          {/* Tulud */}
          <div className="print-section">
            <h2 className="print-section-title">Tulud</h2>
            {plan.budget.incomeRows.length === 0
              ? <div>Tulusid pole lisatud.</div>
              : plan.budget.incomeRows.map(r => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                  <span>{r.name || "—"}</span>
                  <span style={{ fontFamily: "monospace" }}>
                    {r.calc.type === "FIXED_PERIOD" && euroEE(r.calc.params.amountEUR)}
                    {r.calc.type === "MONTHLY_FIXED" && euroEE(r.calc.params.monthlyEUR) + "/kuu"}
                    {r.calc.type === "ANNUAL_FIXED" && euroEE(r.calc.params.annualEUR) + "/a"}
                    {r.calc.type === "QTY_PRICE_ANNUAL" && (r.calc.params.qty + " × " + euroEE(r.calc.params.unitEUR) + "/a")}
                  </span>
                </div>
              ))
            }
            <div style={{ marginTop: 8, fontWeight: 700, fontFamily: "monospace" }}>
              Kokku: {euroEE(derived.totals.incomePeriodEUR)} · {euroEE(derived.totals.incomeMonthlyEUR)}/kuu
            </div>
          </div>

          {/* Fondid & laen */}
          <div className="print-section">
            <h2 className="print-section-title">Fondid & laen</h2>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
              <div><span style={{ fontWeight: 700 }}>Remondifondi määr:</span> {plan.funds.repairFund.monthlyRateEurPerM2} €/m²/kuu</div>
              <div><span style={{ fontWeight: 700 }}>Laekumine perioodis:</span> {euroEE(derived.funds.repairFundIncomePeriodEUR)}</div>
              <div><span style={{ fontWeight: 700 }}>Planeeritud reserv:</span> {euroEE(plan.funds.reserve.plannedEUR)}</div>
              <div><span style={{ fontWeight: 700 }}>Nõutav reserv:</span> {euroEE(derived.funds.reserveRequiredEUR)}</div>
            </div>
            {plan.loans.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: 12, borderBottom: "2px solid #000" }}>
                    <th style={{ padding: "4px 8px" }}>Laen</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Summa</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Intress</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Tähtaeg</th>
                    <th style={{ padding: "4px 8px" }}>Algus</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Teenindus/kuu</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.loans.map(ln => {
                    const d = derived.loans.items.find(x => x.id === ln.id);
                    return (
                      <tr key={ln.id} style={{ borderBottom: "1px solid #ccc" }}>
                        <td style={{ padding: "4px 8px" }}>{ln.name}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(ln.principalEUR)}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{ln.annualRatePct}%</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{ln.termMonths} kuud</td>
                        <td style={{ padding: "4px 8px" }}>{formatYMEE(ln.startYM)}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{d ? euroEE(d.servicingMonthlyEUR) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Korterite maksed */}
          <div className="print-section">
            <h2 className="print-section-title">Korterite maksed</h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, borderBottom: "2px solid #000" }}>
                  <th style={{ padding: "4px 8px" }}>Korter</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>m²</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Osa</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Tegevus €/kuu</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Remondifond €/kuu</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Kokku €/kuu</th>
                </tr>
              </thead>
              <tbody>
                {derived.apartmentPayments.map(pmt => (
                  <tr key={pmt.aptId} style={{ borderBottom: "1px solid #ccc" }}>
                    <td style={{ padding: "4px 8px", fontWeight: 700 }}>{pmt.label}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{pmt.areaM2.toFixed(2)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{(pmt.share * 100).toFixed(2)}%</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(pmt.operationalMonthlyEUR)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(pmt.repairFundMonthlyEUR)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 900 }}>{euroEE(pmt.totalMonthlyEUR)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Kokkuvõte */}
          <div className="print-section">
            <h2 className="print-section-title">Kokkuvõte</h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {[
                  ["Kulud perioodis", euroEE(derived.totals.costPeriodEUR)],
                  ["Tulud perioodis", euroEE(derived.totals.incomePeriodEUR)],
                  ["Neto tegevus", euroEE(derived.totals.netOperationalPeriodEUR)],
                  ["Omanike kuumakse", euroEE(derived.totals.ownersNeedMonthlyEUR) + "/kuu"],
                ].map(([label, value]) => (
                  <tr key={label} style={{ borderBottom: "1px solid #ccc" }}>
                    <td style={{ padding: "6px 8px" }}>{label}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {evaluation?.risk && (
              <div style={{ marginTop: 12 }}>
                <span style={{ fontWeight: 700 }}>Riskitase: </span>
                {evaluation.risk.level === "low" ? "OK" : evaluation.risk.level === "medium" ? "HOIATUS" : "RISK"}
                {evaluation.risk.reason && <span> — {evaluation.risk.reason}</span>}
              </div>
            )}
          </div>
        </div>
      )}
      </main>
    </div>
  );
}