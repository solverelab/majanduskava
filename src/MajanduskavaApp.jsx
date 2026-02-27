// src/App.jsx
import { useEffect, useMemo, useState } from "react";
import { defaultPlan, mkApartment, mkCashflowRow, mkInvestmentItem, mkLoan } from "./domain/planSchema";
import { computePlan, euro } from "./engine/computePlan";
import { runPlan, applyActionAndRun, applyOnly, setPreset as setHostPreset, runAutoResolve, SOLVERE_CORE_CONTRACT_VERSION } from "./solvereBridge/majanduskavaHost";
import { buildStateSignature } from "../packages/solvere-core/src/moduleHost.ts";
import { TracePanel } from "./components/TracePanel";

// ── Euro formatting (Estonian: 1 235 €, täisarvuna) ──
function euroEE(n) {
  if (n == null || isNaN(n)) return "—";
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (rounded < 0 ? "−" : "") + grouped + " \u20ac";
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

// ════════════════════════════════════════════════════════════════════════
// Design tokens — single source of truth for the entire UI
// ════════════════════════════════════════════════════════════════════════

// ── NEUTRAL PALETTE ──
const N = {
  bg:      "#f0eeeb",  // page background (warm stone)
  surface: "#ffffff",  // card / form surface
  muted:   "#f7f6f4",  // secondary surface (warm off-white)
  border:  "#e0ddd8",  // card borders, dividers
  rule:    "#e5e2de",  // table/row separators
  text:    "#2c2825",  // primary text (warm near-black)
  sub:     "#5c554d",  // secondary text / labels (warm grey)
  dim:     "#9b9389",  // tertiary / muted text (warm light grey)
  accent:  "#3b3632",  // primary button fill (warm dark)
  sidebar: "#3d3835",  // sidebar background (warm dark, 1 step lighter)
};

// ── STATE BADGES (OK / HOIATUS / RISK) ──
const STATE = {
  OK:    { bg: "#f0fdf4", border: "#bbf7d0", color: "#166534" },
  WARN:  { bg: "#fefce8", border: "#fde68a", color: "#854d0e" },
  ERROR: { bg: "#fef2f2", border: "#fecaca", color: "#991b1b" },
};
const stateBadge = (s) => ({
  display: "inline-block", fontSize: 13, fontWeight: 700,
  padding: "2px 10px", borderRadius: 4,
  background: s.bg, color: s.color,
});

// ── TYPOGRAPHY ──
const sectionTitle = { fontSize: 18, fontWeight: 800, color: N.text, margin: 0 };
const fieldLabel   = { fontSize: 13, fontWeight: 500, color: N.sub, marginBottom: 4 };
const helperText   = { fontSize: 13, color: N.dim };
const summaryNum   = { fontFamily: "monospace", fontSize: 26, fontWeight: 900 };
const summaryLabel = { fontSize: 13, color: N.sub, marginTop: 4 };
const summarySub   = { fontSize: 13, color: N.dim, marginTop: 2 };

// ── INPUTS ──
const inputBase  = { padding: "8px 10px", border: `1px solid ${N.border}`, borderRadius: 6, fontSize: 15, background: N.surface, color: N.text, outline: "none" };
const inputStyle = { ...inputBase, width: "100%" };
const numStyle   = { ...inputStyle, fontFamily: "monospace", textAlign: "right" };
const selectStyle = { ...inputBase, padding: "6px 10px" };
const numFocus   = (e) => e.target.select();

// ── Universal number input with Estonian comma-decimal support ──
function NumberInput({ value, onChange, ...props }) {
  const [display, setDisplay] = useState(String(value ?? "").replace(".", ","));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDisplay(String(value ?? "").replace(".", ","));
  }, [value, editing]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value.replace(",", ".");
        if (raw === "" || raw === "-" || /^-?\d*\.?\d*$/.test(raw)) {
          setDisplay(e.target.value);
        }
      }}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onBlur={() => {
        setEditing(false);
        const parsed = parseFloat(display.replace(",", "."));
        onChange(!isNaN(parsed) ? parsed : 0);
      }}
      {...props}
    />
  );
}

// ── Euro input — rounds to integer on blur, formats with thousands separator ──
const fmtEur = (v) => v ? Math.round(v).toLocaleString("et-EE") : "";
function EuroInput({ value, onChange, ...props }) {
  const [display, setDisplay] = useState(fmtEur(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDisplay(fmtEur(value));
  }, [value, editing]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value.replace(/\s/g, "").replace(",", ".");
        if (raw === "" || raw === "-" || /^-?\d*\.?\d*$/.test(raw)) {
          setDisplay(e.target.value);
        }
      }}
      onFocus={(e) => {
        setEditing(true);
        const rounded = Math.round(value) || 0;
        setDisplay(rounded ? String(rounded) : "");
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => {
        setEditing(false);
        const parsed = parseFloat(display.replace(/\s/g, "").replace(",", "."));
        const rounded = !isNaN(parsed) ? Math.round(parsed) : 0;
        onChange(rounded);
        setDisplay(fmtEur(rounded));
      }}
      {...props}
    />
  );
}

// ── BUTTONS ──
const _btnBase    = { padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 15, border: "none", lineHeight: 1.4 };
const btnPrimary  = { ..._btnBase, background: N.accent, color: "#fff", fontWeight: 700 };
const btnSecondary = { ..._btnBase, background: N.surface, color: N.text, fontWeight: 600, border: `1px solid ${N.border}` };
const btnAdd      = { ..._btnBase, background: N.muted, color: N.sub, fontWeight: 600, border: `1px solid ${N.border}` };
const btnRemove   = { ..._btnBase, background: "transparent", color: N.dim, fontWeight: 500, padding: "6px 10px", fontSize: 14 };
const btn         = btnSecondary; // legacy alias

// ── CATEGORIES & ENUMS ──
const KOMMUNAALTEENUSED = ["Kütus", "Soojus", "Vesi ja kanalisatsioon", "Elekter", "Prügivedu"];

const HALDUSTEENUSED = ["Haldus", "Raamatupidamine", "Koristus", "Kindlustus", "Hooldus", "Muu"];

const KULU_KATEGOORIAD = [...KOMMUNAALTEENUSED, ...HALDUSTEENUSED];

const TULU_KATEGOORIAD = ["Haldus", "Raamatupidamine", "Koristus", "Kindlustus", "Hooldus", "Kommunaalmaksed", "Muu"];

const KOMMUNAAL_UHIKUD = {
  "Kütus": ["m³", "l", "t"],
  "Soojus": ["MWh", "kWh"],
  "Vesi ja kanalisatsioon": ["m³"],
  "Elekter": ["kWh", "MWh"],
  "Prügivedu": ["periood", "kuu"],
};

const KOMMUNAAL_VAIKE_UHIK = {
  "Kütus": "m³",
  "Soojus": "MWh",
  "Vesi ja kanalisatsioon": "m³",
  "Elekter": "kWh",
  "Prügivedu": "periood",
};

const HALDUS_ARVUTUS_VALIKUD = [
  { value: "kuus", label: "€/kuu" },
  { value: "aastas", label: "€/aasta" },
  { value: "perioodis", label: "Kokku perioodis" },
];

const ESEMED = [
  "Katus",
  "Fassaad",
  "Aknad",
  "Trepp/trepikoda",
  "Torustik (vesi)",
  "Kanalisatsioon",
  "Küttesüsteem",
  "Elektrisüsteem",
  "Ventilatsioon",
  "Kelder",
  "Lift",
  "Õueala",
  "Parkla",
  "Muu",
];

const SEISUKORD_VALIKUD = ["Hea", "Rahuldav", "Mitterahuldav", "Avariiohtlik"];

const PRIORITEEDID = ["Madal", "Keskmine", "Kõrge", "Kriitiline"];

const KULU_NIMETUS_PLACEHOLDERS = {
  "Kütus": "nt Gaasiküte, puuküte",
  "Soojus": "nt Kaugküte",
  "Vesi ja kanalisatsioon": "nt Veevarustus ja kanalisatsioon",
  "Elekter": "nt Üldelekter",
  "Prügivedu": "nt Jäätmevedu",
  "Haldus": "nt Majahalduri tasu",
  "Raamatupidamine": "nt Raamatupidamisteenus",
  "Koristus": "nt Trepikoja koristus",
  "Kindlustus": "nt Hoone koguriskikindlustus",
  "Hooldus": "nt Lukkude vahetus, kraanide remont",
  "Muu": "Kirjelda kulu",
};

const TULU_NIMETUS_PLACEHOLDERS = {
  "Haldus": "nt Haldustasu",
  "Raamatupidamine": "nt Raamatupidamise tasu",
  "Koristus": "nt Koristustasu",
  "Kindlustus": "nt Kindlustuse osa",
  "Hooldus": "nt Hooldustasu",
  "Kommunaalmaksed": "nt Kommunaalkulude ettemaks omanikelt",
  "Muu": "Kirjelda tulu",
};

const TEGEVUS_PLACEHOLDERS = {
  "Katus": "nt Katusekatte vahetus",
  "Fassaad": "nt Fassaadi soojustamine",
  "Aknad": "nt Akende vahetus",
  "Trepp/trepikoda": "nt Trepikoja remont",
  "Torustik (vesi)": "nt Torustiku renoveerimine",
  "Kanalisatsioon": "nt Kanalisatsiooni uuendamine",
  "Küttesüsteem": "nt Katla vahetus",
  "Elektrisüsteem": "nt Elektrisüsteemi uuendamine",
  "Ventilatsioon": "nt Ventilatsiooni paigaldus",
  "Kelder": "nt Hüdroisolatsiooni paigaldus",
  "Lift": "nt Lifti moderniseerimine",
  "Õueala": "nt Haljastuse ja valgustuse uuendamine",
  "Parkla": "nt Parkla asfalteerimine",
  "Muu": "Kirjelda planeeritud tegevus",
};

const PUUDUSED_PLACEHOLDERS = {
  "Katus": "nt Lekked, samblad, kahjustatud katusekate",
  "Fassaad": "nt Praod, niiskuskahjustused, vajab värvimist",
  "Aknad": "nt Klaaspaketid udused, tihendid kulunud",
  "Trepp/trepikoda": "nt Kulunud astmed, katkine käsipuu, lagunev krohv",
  "Torustik (vesi)": "nt Korrosioon, lekked, vananenud torud",
  "Kanalisatsioon": "nt Ummistused, lõhnaprobleem, vananenud torud",
  "Küttesüsteem": "nt Radiaatorid lekivad, katel vananenud, tasakaalustamata",
  "Elektrisüsteem": "nt Vananenud juhtmed, puuduv maandus, kilp amortiseerunud",
  "Ventilatsioon": "nt Lõõrid ummistunud, puuduv sundventilatsioon",
  "Kelder": "nt Niiskus, hallitus, puuduv hüdroisolatsioon",
  "Lift": "nt Vananenud, sagedased rikked, ei vasta nõuetele",
  "Õueala": "nt Lagunev kõnnitee, puuduv valgustus, haljastus hooldamata",
  "Parkla": "nt Pragud asfaldis, puuduv märgistus, veeloigud",
  "Muu": "Kirjelda puudused",
};

// ── LAYOUT ──
const card     = { border: `1px solid ${N.border}`, borderRadius: 12, padding: 16, background: N.surface };
const tabStack = { display: "flex", flexDirection: "column", gap: 16 };
const tableWrap = { overflowX: "auto" };

// ── SUMMARY CARD ──
const summaryCard = { border: `1px solid ${N.border}`, borderRadius: 12, padding: 16, background: N.surface };

// ── TABLE ──
const thRow = { textAlign: "left", fontSize: 13, fontWeight: 600, color: N.sub };
const tdSep = { borderTop: `1px solid ${N.rule}` };

function Issue({ it }) {
  const s = it.severity === "ERROR" ? STATE.ERROR : it.severity === "WARN" ? STATE.WARN : STATE.OK;
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, padding: "10px 12px", borderRadius: 10, marginBottom: 8 }}>
      <b>{it.severity}</b> · {it.message}
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{it.code} · {it.section}</div>
    </div>
  );
}

function Section({ title, items, onApplyAction, showTechnicalInfo }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ ...sectionTitle, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map(finding => (
          <div
            key={finding.id}
            style={card}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: N.text }}>
              {finding.title}
            </div>
            {finding.message && (
              <div style={{ ...helperText, marginTop: 4 }}>
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
                      {showTechnicalInfo && typeof action.impact?.riskScoreDelta === "number" && (
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
  const [kyData, setKyData] = useState({ nimi: "", registrikood: "", aadress: "" });
  const [seisukord, setSeisukord] = useState([]);

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
  const [periodParts, setPeriodParts] = useState({ sd: "", sm: "", sy: "", ed: "", em: "", ey: "" });

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
      kyData,
      seisukord,
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
        // Sync KÜ data
        if (data.kyData) setKyData(data.kyData);
        if (data.seisukord) {
          if (typeof data.seisukord === "string") setSeisukord([]);
          else setSeisukord(data.seisukord.map(r => {
            const kvMap = { "1": "I", "2": "II", "3": "III", "4": "IV" };
            const kv = r.tegevusKvartal ? (kvMap[r.tegevusKvartal] || r.tegevusKvartal) : "";
            return { tegevusAasta: "", tegevusKvartal: "", ...r, tegevusKvartal: kv };
          }));
        }
        // Sync period dropdowns
        const _ps = candidateState.period?.start?.split("-") || [];
        const _pe = candidateState.period?.end?.split("-") || [];
        setPeriodParts({
          sd: Number(_ps[2]) || "", sm: Number(_ps[1]) || "", sy: Number(_ps[0]) || "",
          ed: Number(_pe[2]) || "", em: Number(_pe[1]) || "", ey: Number(_pe[0]) || "",
        });
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
    setPlan(p => {
      const nextLabel = String(Math.max(0, ...p.building.apartments.map(a => parseInt(a.label) || 0)) + 1);
      return { ...p, building: { ...p.building, apartments: [...p.building.apartments, mkApartment({ label: nextLabel, areaM2: 0 })] } };
    });
  };

  const removeApartment = (id) => {
    setPlan(p => ({
      ...p,
      building: { ...p.building, apartments: p.building.apartments.filter(a => a.id !== id) },
    }));
  };

  const addRow = (side) => {
    const row = {
      ...mkCashflowRow({
        side,
        legal: {
          bucket: "OPERATIONAL",
          category: side === "COST" ? "MAINTENANCE" : "OTHER",
          targetedFund: null,
        },
        calc: { type: "FIXED_PERIOD", params: { amountEUR: 0 } },
      }),
      ...(side === "COST" ? { kogus: "", uhik: "", uhikuHind: "", arvutus: "kuus", summaInput: 0 } : {}),
    };
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

  const arvutaHaldusSumma = (r) => {
    const val = parseFloat(r.summaInput) || 0;
    const kuud = derived.period.monthEq || 12;
    switch (r.arvutus) {
      case "kuus": return val * kuud;
      case "aastas": return val / 12 * kuud;
      case "perioodis": return val;
      default: return val * kuud;
    }
  };

  const handleKuluKategooriaChange = (id, newKategooria) => {
    const patch = { category: newKategooria };
    if (KOMMUNAALTEENUSED.includes(newKategooria)) {
      patch.uhik = KOMMUNAAL_VAIKE_UHIK[newKategooria] || "";
      patch.kogus = "";
      patch.uhikuHind = "";
    }
    updateRow("COST", id, patch);
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

  // --- SEISUKORD ---
  const lisaSeisukordRida = () => {
    setSeisukord(prev => [...prev, {
      id: crypto.randomUUID(),
      ese: "",
      seisukordVal: "",
      puudused: "",
      prioriteet: "",
      eeldatavKulu: 0,
      tegevus: "",
      tegevusAasta: "",
      tegevusKvartal: "",
    }]);
  };

  const uuendaSeisukord = (id, field, value) => {
    setSeisukord(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const eemaldaSeisukordRida = (id) => {
    setSeisukord(prev => prev.filter(r => r.id !== id));
  };

  const addInvestment = () => {
    setPlan(p => ({
      ...p,
      investmentsPipeline: {
        ...p.investmentsPipeline,
        items: [...p.investmentsPipeline.items, mkInvestmentItem({ plannedYear: p.period.year || new Date().getFullYear(), quarter: 1, totalCostEUR: 0 })],
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

  const removeInvestment = (id) => {
    setPlan(p => ({
      ...p,
      investmentsPipeline: {
        ...p.investmentsPipeline,
        items: p.investmentsPipeline.items.filter(it => it.id !== id),
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
    setPlan(p => ({ ...p, loans: [...p.loans, mkLoan()] }));
  };

  const updateLoan = (id, patch) => {
    setPlan(p => ({ ...p, loans: p.loans.map(ln => ln.id === id ? { ...ln, ...patch } : ln) }));
  };

  const removeLoan = (id) => {
    setPlan(p => ({ ...p, loans: p.loans.filter(ln => ln.id !== id) }));
  };

  // Auto-add one empty row when section is empty (setPlan, not addX — idempotent even if effect fires twice)
  useEffect(() => { if (plan.building.apartments.length === 0) setPlan(p => ({ ...p, building: { ...p.building, apartments: [mkApartment({ label: "1" })] } })); }, [plan.building.apartments.length]);
  useEffect(() => { if (plan.investmentsPipeline.items.length === 0) setPlan(p => ({ ...p, investmentsPipeline: { ...p.investmentsPipeline, items: [mkInvestmentItem({ plannedYear: p.period.year || new Date().getFullYear() })] } })); }, [plan.investmentsPipeline.items.length]);
  useEffect(() => { if (plan.budget.costRows.length === 0) setPlan(p => ({ ...p, budget: { ...p.budget, costRows: [{ ...mkCashflowRow({ side: "COST" }), kogus: "", uhik: "", uhikuHind: "", arvutus: "kuus", summaInput: 0 }] } })); }, [plan.budget.costRows.length]);
  useEffect(() => { if (plan.budget.incomeRows.length === 0) setPlan(p => ({ ...p, budget: { ...p.budget, incomeRows: [mkCashflowRow({ side: "INCOME" })] } })); }, [plan.budget.incomeRows.length]);

  // Kulude summa sünkroonimine engine'ile (→ calc.params.amountEUR)
  useEffect(() => {
    let changed = false;
    const updated = plan.budget.costRows.map(r => {
      let summa;
      if (KOMMUNAALTEENUSED.includes(r.category)) {
        summa = (parseFloat(r.kogus) || 0) * (parseFloat(r.uhikuHind) || 0);
      } else if (r.arvutus !== undefined) {
        summa = arvutaHaldusSumma(r);
      } else {
        return r;
      }
      if (r.calc.params.amountEUR !== summa) {
        changed = true;
        return { ...r, calc: { type: "FIXED_PERIOD", params: { amountEUR: summa } } };
      }
      return r;
    });
    if (changed) setPlan(p => ({ ...p, budget: { ...p.budget, costRows: updated } }));
  }, [plan.budget.costRows, derived.period.monthEq]);
  useEffect(() => { if (plan.loans.length === 0) setPlan(p => ({ ...p, loans: [mkLoan()] })); }, [plan.loans.length]);
  useEffect(() => { if (seisukord.length === 0) setSeisukord([{ id: crypto.randomUUID(), ese: "", seisukordVal: "", puudused: "", prioriteet: "", eeldatavKulu: 0, tegevus: "", tegevusAasta: "", tegevusKvartal: "" }]); }, [seisukord.length]);

  const SECS = ["Periood & korterid", "Investeeringud", "Kulud", "Tulud", "Fondid & laen", "Korterite maksed", "Kontroll & kokkuvõte"];

  const clearSection = (tabIdx) => {
    if (!window.confirm("Kas soovid selle jaotise andmed kustutada? Seda ei saa tagasi võtta.")) return;
    if (tabIdx === 0) { setPeriodParts({ sd: "", sm: "", sy: "", ed: "", em: "", ey: "" }); setKyData({ nimi: "", registrikood: "", aadress: "" }); }
    setPlan(p => {
      if (tabIdx === 0) return { ...p, period: { ...p.period, start: "", end: "" }, building: { ...p.building, apartments: [] } };
      if (tabIdx === 1) { setSeisukord([]); return { ...p, investmentsPipeline: { ...p.investmentsPipeline, items: [] } }; }
      if (tabIdx === 2) return { ...p, budget: { ...p.budget, costRows: [] } };
      if (tabIdx === 3) return { ...p, budget: { ...p.budget, incomeRows: [] } };
      if (tabIdx === 4) return { ...p, funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } }, loans: [] };
      return p;
    });
  };
  const clearBtn = (tabIdx) => (
    <button onClick={() => clearSection(tabIdx)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: N.dim, textDecoration: "underline", padding: 0 }}>
      Tühjenda
    </button>
  );

  // ── Tab completion status: "empty" | "partial" | "done" ──
  const hasPeriod = plan.period.start && plan.period.end;
  const hasApts = plan.building.apartments.length > 0;
  const tabStatus = [
    // 0: Periood & korterid
    (hasPeriod && hasApts) ? "done" : (plan.period.start || plan.period.end || hasApts) ? "partial" : "empty",
    // 1: Investeeringud
    plan.investmentsPipeline.items.length > 0 ? "done" : "empty",
    // 2: Kulud
    plan.budget.costRows.length > 0 ? "done" : "empty",
    // 3: Tulud
    plan.budget.incomeRows.length > 0 ? "done" : "empty",
    // 4: Fondid & laen
    (plan.loans.length > 0 || plan.funds.repairFund.monthlyRateEurPerM2 > 0) ? "done" : "empty",
    // 5: Korterite maksed
    (hasApts && hasPeriod) ? "done" : hasApts ? "partial" : "empty",
    // 6: Kontroll & kokkuvõte
    (hasApts && hasPeriod) ? "done" : hasApts ? "partial" : "empty",
  ];

  const statusDot = (status) => {
    if (status === "done") return { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#7dab6e", flexShrink: 0 };
    if (status === "partial") return { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#c9a96e", flexShrink: 0 };
    return { display: "inline-block", width: 8, height: 8, borderRadius: "50%", border: "1.5px solid #6b6560", background: "transparent", flexShrink: 0, boxSizing: "border-box" };
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: N.bg, fontSize: 15, color: N.text }}>
      {/* ── Sidebar navigation ── */}
      <aside style={{
        width: 220, minWidth: 220, background: N.sidebar,
        display: "flex", flexDirection: "column",
        padding: "16px 0", overflowY: "auto",
        borderRight: `1px solid ${N.border}`,
      }}>
        {SECS.map((name, i) => (
          <button
            key={name}
            onClick={() => setSec(i)}
            style={{
              background: sec === i ? "rgba(255,255,255,0.05)" : "transparent",
              border: "none", borderLeft: sec === i ? "2px solid #c4b08a" : "2px solid transparent",
              padding: "12px 16px",
              fontSize: 14,
              textAlign: "left",
              cursor: "pointer",
              color: sec === i ? "#e8e4df" : "#a39e97",
              fontWeight: sec === i ? 600 : 400,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={statusDot(tabStatus[i])} />
            {name}
          </button>
        ))}

      </aside>

      <main style={{ flex: 1, padding: 24, overflowY: "auto", maxWidth: 1100, boxSizing: "border-box", position: "relative" }}>
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
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(0)}</div>

            {/* KÜ andmed */}
            <div style={card}>
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Korteriühistu andmed</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <div style={fieldLabel}>KÜ nimi</div>
                  <input
                    type="text"
                    placeholder="nt KÜ Tamme 5"
                    value={kyData.nimi}
                    onChange={(e) => setKyData(prev => ({ ...prev, nimi: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: "1 1 160px" }}>
                  <div style={fieldLabel}>Registrikood</div>
                  <input
                    type="text"
                    placeholder="nt 80123456"
                    value={kyData.registrikood}
                    onChange={(e) => setKyData(prev => ({ ...prev, registrikood: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: "1 1 240px" }}>
                  <div style={fieldLabel}>Aadress</div>
                  <input
                    type="text"
                    placeholder="nt Tamme 5, 51008 Tartu"
                    value={kyData.aadress}
                    onChange={(e) => setKyData(prev => ({ ...prev, aadress: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>

            {(() => {
              const YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030];
              const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
              const daysInMonth = (m, y) => (m && y) ? new Date(y, m, 0).getDate() : 31;
              const toISO = (d, m, y) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

              const pp = periodParts;

              const updateStart = (key, val) => {
                const next = { ...pp, [key]: Number(val) };
                // Algusaasta muutmisel → lõppaasta kaasa
                if (key === "sy" && Number(val)) {
                  next.ey = Number(val);
                  // Clamp end day if needed
                  if (next.em && next.ey && next.ed > daysInMonth(next.em, next.ey)) {
                    next.ed = daysInMonth(next.em, next.ey);
                  }
                }
                // Clamp start day to valid range
                if (next.sm && next.sy && next.sd > daysInMonth(next.sm, next.sy)) {
                  next.sd = daysInMonth(next.sm, next.sy);
                }
                setPeriodParts(next);
                if (next.sd && next.sm && next.sy) {
                  const iso = toISO(next.sd, next.sm, next.sy);
                  setPlan(p => {
                    const upd = { ...p, period: { ...p.period, start: iso, year: next.sy } };
                    if (!p.period.end && !next.ed) {
                      upd.period.end = `${next.sy}-12-31`;
                      next.ed = 31; next.em = 12; next.ey = next.sy;
                      setPeriodParts({ ...next });
                    }
                    // Sync end ISO if end parts are complete
                    if (next.ed && next.em && next.ey) {
                      upd.period.end = toISO(next.ed, next.em, next.ey);
                    }
                    return upd;
                  });
                }
              };

              const updateEnd = (key, val) => {
                const next = { ...pp, [key]: Number(val) };
                if (next.em && next.ey && next.ed > daysInMonth(next.em, next.ey)) {
                  next.ed = daysInMonth(next.em, next.ey);
                }
                setPeriodParts(next);
                if (next.ed && next.em && next.ey) {
                  setPlan(p => ({ ...p, period: { ...p.period, end: toISO(next.ed, next.em, next.ey) } }));
                }
              };

              const sDays = daysInMonth(pp.sm, pp.sy);
              const eDays = daysInMonth(pp.em, pp.ey);
              const ddStyle = { ...selectStyle, minWidth: 70, appearance: "auto" };

              return (
                <div style={card}>
                  <div style={{ ...sectionTitle, marginBottom: 12 }}>Periood</div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={fieldLabel}>Majandusaasta</div>
                    <select
                      value=""
                      onChange={(e) => {
                        const y = Number(e.target.value);
                        const next = { sd: 1, sm: 1, sy: y, ed: 31, em: 12, ey: y };
                        setPeriodParts(next);
                        setPlan(p => ({ ...p, period: { ...p.period, start: toISO(1, 1, y), end: toISO(31, 12, y), year: y } }));
                      }}
                      style={{ ...selectStyle, appearance: "auto" }}
                    >
                      <option value="" disabled>Vali aasta…</option>
                      {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ ...helperText, marginBottom: 8 }}>Vajadusel muuda kuupäevi käsitsi</div>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <div>
                      <div style={fieldLabel}>Algus</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <select value={pp.sd || ""} onChange={(ev) => updateStart("sd", ev.target.value)} style={ddStyle}>
                          <option value="">PP</option>
                          {Array.from({ length: sDays }, (_, i) => i + 1).map(d => (
                            <option key={d} value={d}>{String(d).padStart(2, "0")}</option>
                          ))}
                        </select>
                        <select value={pp.sm || ""} onChange={(ev) => updateStart("sm", ev.target.value)} style={ddStyle}>
                          <option value="">KK</option>
                          {MONTHS.map(m => (
                            <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                          ))}
                        </select>
                        <select value={pp.sy || ""} onChange={(ev) => updateStart("sy", ev.target.value)} style={{ ...ddStyle, minWidth: 85 }}>
                          <option value="">AAAA</option>
                          {YEARS.map(y => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <div style={fieldLabel}>Lõpp</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <select value={pp.ed || ""} onChange={(ev) => updateEnd("ed", ev.target.value)} style={ddStyle}>
                          <option value="">PP</option>
                          {Array.from({ length: eDays }, (_, i) => i + 1).map(d => (
                            <option key={d} value={d}>{String(d).padStart(2, "0")}</option>
                          ))}
                        </select>
                        <select value={pp.em || ""} onChange={(ev) => updateEnd("em", ev.target.value)} style={ddStyle}>
                          <option value="">KK</option>
                          {MONTHS.map(m => (
                            <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                          ))}
                        </select>
                        <select value={pp.ey || ""} onChange={(ev) => updateEnd("ey", ev.target.value)} style={{ ...ddStyle, minWidth: 85 }}>
                          <option value="">AAAA</option>
                          {YEARS.map(y => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  {pp.sd && pp.sm && pp.sy && pp.ed && pp.em && pp.ey && (
                    <div style={{ marginTop: 12, fontSize: 15, fontFamily: "monospace", color: N.text }}>
                      {String(pp.sd).padStart(2, "0")}.{String(pp.sm).padStart(2, "0")}.{pp.sy} – {String(pp.ed).padStart(2, "0")}.{String(pp.em).padStart(2, "0")}.{pp.ey}
                    </div>
                  )}
                  {pp.sd && pp.sm && pp.sy && pp.ed && pp.em && pp.ey &&
                    new Date(pp.sy, pp.sm - 1, pp.sd) > new Date(pp.ey, pp.em - 1, pp.ed) && (
                    <div style={{ marginTop: 6, fontSize: 13, color: "#dc2626" }}>
                      ⚠ Alguskuupäev on hilisem kui lõppkuupäev
                    </div>
                  )}
                </div>
              );
            })()}

            <div style={card}>
              <div style={{ marginBottom: 12 }}>
                <div style={sectionTitle}>Korterid</div>
              </div>
              <div style={tableWrap}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
                <thead>
                  <tr style={thRow}>
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
                      <tr key={a.id} style={tdSep}>
                        <td style={{ padding: "6px 8px" }}><input value={a.label} onChange={(e) => updateApartment(a.id, { label: e.target.value })} style={inputStyle} /></td>
                        <td style={{ padding: "6px 8px" }}><NumberInput value={a.areaM2} onChange={(v) => updateApartment(a.id, { areaM2: v })} style={numStyle} /></td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace" }}>{(share * 100).toFixed(2)}%</td>
                        <td style={{ padding: "6px 8px" }}><input value={a.notes} onChange={(e) => updateApartment(a.id, { notes: e.target.value })} style={inputStyle} /></td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <button style={btnRemove} onClick={() => removeApartment(a.id)}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <div style={{ marginTop: 12, fontFamily: "monospace" }}>
                Kokku: {derived.building.apartmentsCount} korterit · {derived.building.totAreaM2.toFixed(2)} m²
              </div>
              <div style={{ marginTop: 8 }}>
                <button style={btnAdd} onClick={addApartment}>+ Lisa korter</button>
              </div>
            </div>
          </div>
        )}

        {sec === 1 && (
          <div style={tabStack}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(1)}</div>
            <div style={card}>
              <div style={sectionTitle}>Kaasomandi eseme seisukord</div>

              {seisukord.map((rida) => (
                <div key={rida.id} style={{ border: `1px solid ${N.rule}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={fieldLabel}>Ese</div>
                      <select value={rida.ese} onChange={(e) => uuendaSeisukord(rida.id, "ese", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        <option value="">Vali…</option>
                        {ESEMED.map(e => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={fieldLabel}>Seisukord</div>
                      <select value={rida.seisukordVal} onChange={(e) => uuendaSeisukord(rida.id, "seisukordVal", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        <option value="">Vali…</option>
                        {SEISUKORD_VALIKUD.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={fieldLabel}>Prioriteet</div>
                      <select value={rida.prioriteet} onChange={(e) => uuendaSeisukord(rida.id, "prioriteet", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        <option value="">Vali…</option>
                        {PRIORITEEDID.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ flex: 2, minWidth: 180 }}>
                      <div style={fieldLabel}>Puudused</div>
                      <input type="text" placeholder={PUUDUSED_PLACEHOLDERS[rida.ese] || "Kirjelda puudused"} value={rida.puudused} onChange={(e) => uuendaSeisukord(rida.id, "puudused", e.target.value)} style={inputStyle} />
                    </div>
                    <div style={{ width: 160 }}>
                      <div style={fieldLabel}>Eeldatav kulu €</div>
                      <EuroInput value={rida.eeldatavKulu} onChange={(v) => uuendaSeisukord(rida.id, "eeldatavKulu", v)} style={numStyle} />
                    </div>
                    <div style={{ flex: 2, minWidth: 180 }}>
                      <div style={fieldLabel}>Planeeritud tegevus</div>
                      <input type="text" placeholder={TEGEVUS_PLACEHOLDERS[rida.ese] || "Kirjelda planeeritud tegevus"} value={rida.tegevus} onChange={(e) => uuendaSeisukord(rida.id, "tegevus", e.target.value)} style={inputStyle} />
                    </div>
                    <div style={{ width: 90 }}>
                      <div style={fieldLabel}>Aasta</div>
                      <select value={rida.tegevusAasta || ""} onChange={(e) => uuendaSeisukord(rida.id, "tegevusAasta", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        <option value="">–</option>
                        {(() => { const y = plan.period.year || new Date().getFullYear(); return [y, y + 1, y + 2, y + 3].map(v => <option key={v} value={v}>{v}</option>); })()}
                      </select>
                    </div>
                    <div style={{ width: 70 }}>
                      <div style={fieldLabel}>Kv</div>
                      <select value={rida.tegevusKvartal || ""} onChange={(e) => uuendaSeisukord(rida.id, "tegevusKvartal", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        <option value="">—</option>
                        <option value="I">I</option>
                        <option value="II">II</option>
                        <option value="III">III</option>
                        <option value="IV">IV</option>
                      </select>
                    </div>
                  </div>
                  <button style={btnRemove} onClick={() => eemaldaSeisukordRida(rida.id)}>Eemalda</button>
                </div>
              ))}

              <div style={{ marginTop: 8, fontFamily: "monospace" }}>
                Esemed: {seisukord.length} · eeldatav kogukulu {euro(seisukord.reduce((sum, r) => sum + (r.eeldatavKulu || 0), 0))}
                {seisukord.some(r => r.tegevusAasta) && <> · tegevused planeeritud {[...new Set(seisukord.filter(r => r.tegevusAasta).map(r => r.tegevusAasta))].sort().join(", ")}</>}
              </div>
              <div style={{ marginTop: 8 }}>
                <button style={btnAdd} onClick={lisaSeisukordRida}>+ Lisa ese</button>
              </div>
            </div>

            <div style={card}>
              <div style={{ marginBottom: 12 }}>
                <div style={sectionTitle}>Investeeringud</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {plan.investmentsPipeline.items.map(it => (
                  <div key={it.id} style={{ border: `1px solid ${N.rule}`, borderRadius: 12, padding: 12 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: 2 }}>
                        <div style={fieldLabel}>Nimetus</div>
                        <input value={it.name} onChange={(e) => updateInvestment(it.id, { name: e.target.value })} placeholder="nt Katuse remont" style={inputStyle} />
                      </div>
                      <div style={{ width: 120 }}>
                        <div style={fieldLabel}>Aasta</div>
                        <select value={it.plannedYear} onChange={(e) => updateInvestment(it.id, { plannedYear: Number(e.target.value) })} style={{ ...selectStyle, width: "100%" }}>
                          {(() => { const y = plan.period.year || new Date().getFullYear(); return [y, y + 1].map(v => <option key={v} value={v}>{v}</option>); })()}
                        </select>
                      </div>
                      <div style={{ width: 120 }}>
                        <div style={fieldLabel}>Kvartal</div>
                        <select value={it.quarter} onChange={(e) => updateInvestment(it.id, { quarter: Number(e.target.value) })} style={{ ...selectStyle, width: "100%" }}>
                          <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
                        </select>
                      </div>
                      <div style={{ width: 160 }}>
                        <div style={fieldLabel}>Maksumus €</div>
                        <EuroInput value={it.totalCostEUR} onChange={(v) => updateInvestment(it.id, { totalCostEUR: v })} style={numStyle} />
                      </div>
                    </div>

                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${N.rule}` }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>Rahastusplaan</div>

                      {(it.fundingPlan || []).length === 0 && (
                        <div style={{ ...helperText, marginTop: 8 }}>
                          Rahastusridu pole lisatud.
                        </div>
                      )}

                      {(it.fundingPlan || []).map((row, index) => (
                        <div key={index} style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <select
                            value={row.source}
                            onChange={(e) =>
                              updateInvFundingRow(it.id, index, { source: e.target.value })
                            }
                            style={selectStyle}
                          >
                            <option value="REPAIR_FUND">Remondifond</option>
                            <option value="RESERVE">Reservkapital</option>
                            <option value="LOAN">Laen</option>
                            <option value="GRANT">Toetus</option>
                            <option value="ONE_OFF">Erakorraline makse</option>
                          </select>

                          <EuroInput
                            value={row.amountEUR}
                            onChange={(v) => updateInvFundingRow(it.id, index, { amountEUR: v })}
                            style={numStyle}
                          />

                          <button onClick={() => removeInvFundingRow(it.id, index)} style={btnRemove}>
                            Eemalda
                          </button>
                        </div>
                      ))}

                      <div style={{ marginTop: 8 }}>
                        <button style={btnAdd} onClick={() => addInvFundingRow(it.id)}>+ Lisa rahastusrida</button>
                      </div>
                    </div>

                    <div style={{ marginTop: 8, textAlign: "right" }}>
                      <button style={btnRemove} onClick={() => removeInvestment(it.id)}>Eemalda investeering</button>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 12, fontFamily: "monospace" }}>
                Selle perioodi investeeringud: {plan.investmentsPipeline.items.length} · maksumus {euro(plan.investmentsPipeline.items.reduce((s, it) => s + (it.totalCostEUR || 0), 0))}
              </div>
              <div style={{ marginTop: 8 }}>
                <button style={btnAdd} onClick={addInvestment}>+ Lisa investeering</button>
              </div>
            </div>
          </div>
        )}

        {(sec === 2 || sec === 3) && (() => {
          const side = sec === 2 ? "COST" : "INCOME";
          const rows = side === "COST" ? plan.budget.costRows : plan.budget.incomeRows;
          return (
            <div style={tabStack}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(sec)}</div>
              <div style={card}>
                <div style={{ marginBottom: 12 }}>
                  <div style={sectionTitle}>{side === "COST" ? "Kulud" : "Tulud"}</div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {rows.map(r => (
                    <div key={r.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ width: 180 }}>
                          <div style={fieldLabel}>Kategooria</div>
                          <select value={r.category || ""} onChange={(e) => side === "COST" ? handleKuluKategooriaChange(r.id, e.target.value) : updateRow(side, r.id, { category: e.target.value })} style={{ ...selectStyle, width: "100%" }}>
                            <option value="">Vali…</option>
                            {side === "COST" ? (
                              <>
                                <optgroup label="Kommunaalteenused">
                                  {KOMMUNAALTEENUSED.map(k => <option key={k} value={k}>{k}</option>)}
                                </optgroup>
                                <optgroup label="Haldusteenused">
                                  {HALDUSTEENUSED.map(k => <option key={k} value={k}>{k}</option>)}
                                </optgroup>
                              </>
                            ) : (
                              TULU_KATEGOORIAD.map(k => <option key={k} value={k}>{k}</option>)
                            )}
                          </select>
                        </div>
                        <div style={{ flex: 2 }}>
                          <div style={fieldLabel}>Nimetus</div>
                          <input value={r.name} onChange={(e) => updateRow(side, r.id, { name: e.target.value })} placeholder={side === "COST" ? (KULU_NIMETUS_PLACEHOLDERS[r.category] || "Kirjelda kulu") : (TULU_NIMETUS_PLACEHOLDERS[r.category] || "Kirjelda tulu")} style={inputStyle} />
                        </div>

                        {side === "COST" && KOMMUNAALTEENUSED.includes(r.category) ? (
                          <>
                            <div style={{ width: 100 }}>
                              <div style={fieldLabel}>Kogus</div>
                              <NumberInput value={r.kogus} onChange={(v) => updateRow(side, r.id, { kogus: v })} placeholder="0" style={numStyle} />
                            </div>
                            <div style={{ width: 120 }}>
                              <div style={fieldLabel}>Ühik</div>
                              <select value={r.uhik || ""} onChange={(e) => updateRow(side, r.id, { uhik: e.target.value })} style={{ ...selectStyle, width: "100%" }}>
                                {(KOMMUNAAL_UHIKUD[r.category] || []).map(u => (
                                  <option key={u} value={u}>{u}</option>
                                ))}
                              </select>
                            </div>
                            <div style={{ width: 130 }}>
                              <div style={fieldLabel}>Ühiku hind €</div>
                              <EuroInput value={r.uhikuHind} onChange={(v) => updateRow(side, r.id, { uhikuHind: v })} placeholder="0" style={numStyle} />
                            </div>
                            <div style={{ width: 130 }}>
                              <div style={fieldLabel}>Summa €</div>
                              <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, paddingTop: 6 }}>
                                {euro((parseFloat(r.kogus) || 0) * (parseFloat(r.uhikuHind) || 0))}
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ width: 140 }}>
                              <div style={fieldLabel}>Arvutus</div>
                              <select
                                value={r.arvutus || "kuus"}
                                onChange={(e) => updateRow(side, r.id, { arvutus: e.target.value })}
                                style={{ ...selectStyle, width: "100%" }}
                              >
                                {HALDUS_ARVUTUS_VALIKUD.map(v => (
                                  <option key={v.value} value={v.value}>{v.label}</option>
                                ))}
                              </select>
                            </div>
                            <div style={{ width: 140 }}>
                              <div style={fieldLabel}>
                                {r.arvutus === "aastas" ? "€/aasta" : r.arvutus === "perioodis" ? "Summa €" : "€/kuu"}
                              </div>
                              <EuroInput value={r.summaInput} onChange={(v) => updateRow(side, r.id, { summaInput: v })} style={numStyle} />
                            </div>
                            <div style={{ width: 130 }}>
                              <div style={fieldLabel}>Perioodis</div>
                              <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, paddingTop: 6 }}>
                                {euro(arvutaHaldusSumma(r))}
                              </div>
                            </div>
                          </>
                        )}

                        <div style={{ width: 120, alignSelf: "end" }}>
                          <button style={btnRemove} onClick={() => removeRow(side, r.id)}>Eemalda</button>
                        </div>
                      </div>

                    </div>
                  ))}
                </div>

                <div style={{ ...helperText, marginTop: 12, fontFamily: "monospace" }}>
                  {side === "COST"
                    ? <>Kulud perioodis: {euro(derived.totals.costPeriodEUR)} · kuus {euro(derived.totals.costMonthlyEUR)}/kuu</>
                    : <>Tulud perioodis: {euro(derived.totals.incomePeriodEUR)} · kuus {euro(derived.totals.incomeMonthlyEUR)}/kuu</>
                  }
                </div>
                <div style={{ marginTop: 8 }}>
                  <button style={btnAdd} onClick={() => addRow(side)}>+ Lisa rida</button>
                </div>
              </div>
            </div>
          );
        })()}

        {sec === 4 && (
          <div style={tabStack}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(4)}</div>
            <div style={card}>
              <div style={{ ...sectionTitle, marginBottom: 4 }}>Remondifond</div>
              <div style={{ fontSize: 13, color: N.sub, marginBottom: 12 }}>Hoone pikaajalise korrashoiu fond, kuhu omanikud maksavad igakuiselt m² alusel.</div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ width: 220 }}>
                  <div style={fieldLabel}>Remondifondi määr (€/m²/kuu)</div>
                  <NumberInput
                    value={plan.funds.repairFund.monthlyRateEurPerM2}
                    onChange={(v) => setPlan(p => ({ ...p, funds: { ...p.funds, repairFund: { monthlyRateEurPerM2: v } } }))}
                    style={numStyle}
                  />
                </div>

                <div style={{ width: 260 }}>
                  <div style={fieldLabel}>Remondifondi laekumine perioodis</div>
                  <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 800 }}>
                    {euro(derived.funds.repairFundIncomePeriodEUR)}
                  </div>
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={{ ...sectionTitle, marginBottom: 4 }}>Reservkapital</div>
              <div style={{ fontSize: 13, color: N.sub, marginBottom: 12 }}>KrtS §48 — reservkapital ettenägematute kulude katteks.</div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ width: 220 }}>
                  <div style={fieldLabel}>Kavandatud reserv €</div>
                  <EuroInput
                    value={plan.funds.reserve.plannedEUR}
                    onChange={(v) => setPlan(p => ({ ...p, funds: { ...p.funds, reserve: { ...p.funds.reserve, plannedEUR: v } } }))}
                    style={numStyle}
                  />
                </div>

                <div style={{ width: 260 }}>
                  <div style={fieldLabel}>Nõutav miinimum</div>
                  <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 800 }}>
                    {euro(derived.funds.reserveRequiredEUR)}
                  </div>
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={{ marginBottom: 12 }}>
                <div style={sectionTitle}>Laenud</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {plan.loans.map(ln => {
                  const d = derived.loans.items.find(x => x.id === ln.id);
                  return (
                    <div key={ln.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ flex: 2 }}>
                          <div style={fieldLabel}>Nimi</div>
                          <input value={ln.name} onChange={(e) => updateLoan(ln.id, { name: e.target.value })} placeholder="nt Renoveerimislaen" style={inputStyle} />
                        </div>
                        <div style={{ width: 160 }}>
                          <div style={fieldLabel}>Summa €</div>
                          <EuroInput value={ln.principalEUR} onChange={(v) => updateLoan(ln.id, { principalEUR: v })} style={numStyle} />
                        </div>
                        <div style={{ width: 140 }}>
                          <div style={fieldLabel}>Intress %/a</div>
                          <NumberInput value={ln.annualRatePct} onChange={(v) => updateLoan(ln.id, { annualRatePct: v })} style={numStyle} />
                        </div>
                        <div style={{ width: 140 }}>
                          <div style={fieldLabel}>Tähtaeg kuud</div>
                          <NumberInput value={ln.termMonths} onChange={(v) => updateLoan(ln.id, { termMonths: v })} style={numStyle} />
                        </div>
                        <div style={{ width: 140 }}>
                          <div style={fieldLabel}>Algus (KK.AAAA)</div>
                          <input value={ln.startYM} onChange={(e) => updateLoan(ln.id, { startYM: e.target.value })} style={inputStyle} />
                          <div style={{ ...helperText, marginTop: 4, fontFamily: "monospace" }}>{formatYMEE(ln.startYM)}</div>
                        </div>
                        <div style={{ width: 140 }}>
                          <div style={fieldLabel}>Laenumakse reserv %</div>
                          <NumberInput value={ln.reservePct} onChange={(v) => updateLoan(ln.id, { reservePct: v })} style={numStyle} />
                        </div>
                        <div style={{ width: 120, alignSelf: "end" }}>
                          <button style={btnRemove} onClick={() => removeLoan(ln.id)}>Eemalda</button>
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
              <div style={{ marginTop: 8 }}>
                <button style={btnAdd} onClick={addLoan}>+ Lisa laen</button>
              </div>
            </div>
          </div>
        )}

        {sec === 5 && (
          <div style={tabStack}>
            <div style={card}>
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Korterite kuumaksed (m² järgi)</div>
              <div style={{ ...helperText, fontFamily: "monospace", marginBottom: 12 }}>
                Omanike kuuvajadus: {euro(derived.totals.ownersNeedMonthlyEUR)}/kuu
              </div>

              <div style={tableWrap}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr style={thRow}>
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
                    <tr key={pmt.aptId} style={tdSep}>
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
          </div>
        )}

        {sec === 6 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── Kokkuvõte ── */}
            {(() => {
              const netState = derived.totals.netOperationalPeriodEUR >= 0 ? STATE.OK : STATE.ERROR;
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  <div style={summaryCard}>
                    <div style={summaryNum}>{euro(derived.totals.costPeriodEUR)}</div>
                    <div style={summaryLabel}>Kulud perioodis</div>
                    <div style={summarySub}>{euro(derived.totals.costMonthlyEUR)}/kuu</div>
                  </div>
                  <div style={summaryCard}>
                    <div style={summaryNum}>{euro(derived.totals.incomePeriodEUR)}</div>
                    <div style={summaryLabel}>Tulud perioodis</div>
                    <div style={summarySub}>{euro(derived.totals.incomeMonthlyEUR)}/kuu</div>
                  </div>
                  <div style={{ ...summaryCard, borderColor: netState.border, background: netState.bg }}>
                    <div style={{ ...summaryNum, color: netState.color }}>
                      {euro(derived.totals.netOperationalPeriodEUR)}
                    </div>
                    <div style={{ ...summaryLabel, color: netState.color }}>Neto tegevus</div>
                    <div style={summarySub}>{euro(derived.totals.netOperationalMonthlyEUR)}/kuu</div>
                  </div>
                  <div style={summaryCard}>
                    <div style={summaryNum}>{euro(derived.totals.ownersNeedMonthlyEUR)}/kuu</div>
                    <div style={summaryLabel}>Omanike kuumakse</div>
                    <div style={summarySub}>= tegevus + laen + laenureserv</div>
                  </div>
                </div>
              );
            })()}

            {/* ── Poliitika & soovitused ── */}
            <div style={{ ...card, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={sectionTitle}>Poliitika & soovitused</div>
                <span style={{ ...helperText, fontFamily: "monospace" }}>{preset}</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <div style={fieldLabel}>Preset</div>
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                  style={selectStyle}
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
                  style={{ ...btnPrimary, opacity: (isSolving || !allActions.length) ? 0.5 : 1 }}
                >
                  {isSolving ? "Rakendan…" : "Rakenda soovitused"}
                </button>
                {solveStatus ? (
                  <span style={{ fontSize: 12, opacity: 0.75 }}>{solveStatus}</span>
                ) : null}
              </div>
            </div>

            {/* ── Riskitase (band + reason only) ── */}
            {evaluation?.risk && (
              <div style={{ ...card, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={sectionTitle}>Riskitase</div>
                  <span style={stateBadge(evaluation.risk.level === "low" ? STATE.OK : evaluation.risk.level === "medium" ? STATE.WARN : STATE.ERROR)}>
                    {evaluation.risk.level.toUpperCase()}
                  </span>
                </div>
                {evaluation.risk.reason && (
                  <div style={{ ...helperText, marginTop: 8 }}>
                    {evaluation.risk.reason}
                  </div>
                )}
              </div>
            )}

            {/* ── UI error ── */}
            {uiError && (
              <div style={{ border: `1px solid ${STATE.ERROR.border}`, borderRadius: 12, padding: 20, background: STATE.ERROR.bg }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ ...sectionTitle, color: STATE.ERROR.color }}>Viga</div>
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
                    <Section title="Vead" items={errors} onApplyAction={onApplyAction} showTechnicalInfo={showTechnicalInfo} />
                  )}
                  {warnings.length > 0 && (
                    <Section title="Hoiatused" items={warnings} onApplyAction={onApplyAction} showTechnicalInfo={showTechnicalInfo} />
                  )}
                  {infos.length > 0 && (
                    <Section title="Info" items={infos} onApplyAction={onApplyAction} showTechnicalInfo={showTechnicalInfo} />
                  )}
                </>
              );
            })()}

            {/* ── Prindi + Ekspordi nupud (always visible) ── */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                style={{ ...btnSecondary, padding: "10px 16px", opacity: derived.controls.hasErrors ? 0.5 : 1 }}
                disabled={derived.controls.hasErrors}
                onClick={onPrint}
                title={derived.controls.hasErrors ? "Paranda vead enne printimist" : "Prindi"}
              >
                Prindi kokkuvõte
              </button>
            </div>

            {/* ── Ekspordi / impordi (buttons only, no version string) ── */}
            <div style={{ ...card, padding: 20 }}>
              <div style={{ ...sectionTitle, marginBottom: 16 }}>Ekspordi / impordi</div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={onExportJSON} style={btnSecondary}>
                  Salvesta fail
                </button>
                <label style={{ ...btnSecondary, display: "inline-block", cursor: "pointer" }}>
                  Ava fail
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

            {/* ── Technical details (single conditional container) ── */}
            {showTechnicalInfo && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, borderTop: `2px dashed ${N.border}`, paddingTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: N.dim }}>
                  Technical details
                </div>

                {/* Risk score */}
                {evaluation?.risk && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 12, color: N.sub }}>Riskiskoor:</span>
                    <span style={{ fontSize: 24, fontWeight: 700 }}>{evaluation.risk.score}</span>
                  </div>
                )}

                {/* TracePanel */}
                <TracePanel evaluation={evaluation} steps={solveAllResult?.steps} stop={solveAllResult?.stop} />

                {/* Vastavuse kokkuvõte */}
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

                {/* Ekspordi versioon */}
                <div style={{ fontSize: 11, fontFamily: "monospace", color: N.dim }}>
                  majanduskavaExport/v1
                </div>

                {/* Süsteemi info */}
                <div style={{ border: `1px solid ${N.border}`, borderRadius: 12, padding: 20, background: N.muted }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.dim, marginBottom: 16 }}>
                    Süsteemi info
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

                {/* Pilot checklist */}
                <div style={{ border: `1px solid ${N.border}`, borderRadius: 12, padding: 20, background: N.surface }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: N.sub, marginBottom: 16 }}>
                    Pilot launch checklist
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

                {/* Dev: tagasiside mall */}
                {(() => {
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
              </div>
            )}

            {/* ── Toggle (bottom, subdued) ── */}
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
              <button
                onClick={() => setShowTechnicalInfo(v => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: N.dim, textDecoration: "underline", padding: "4px 8px" }}
              >
                {showTechnicalInfo ? "Peida tehniline info" : "Näita tehnilist infot"}
              </button>
            </div>

          </div>
        )}

        {/* ── Print-only: all sections rendered for print ── */}
      {isPrinting && (
        <div className="print-content">
          {kyData.nimi && (
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{kyData.nimi}</h1>
              {(kyData.registrikood || kyData.aadress) && (
                <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                  {[kyData.registrikood, kyData.aadress].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          )}
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

          {/* Kaasomandi eseme seisukord */}
          {seisukord.length > 0 && seisukord.some(r => r.ese) && (
            <div className="print-section">
              <h2 className="print-section-title">Kaasomandi eseme seisukord</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: 12, borderBottom: "2px solid #000" }}>
                    <th style={{ padding: "4px 8px" }}>Ese</th>
                    <th style={{ padding: "4px 8px" }}>Seisukord</th>
                    <th style={{ padding: "4px 8px" }}>Prioriteet</th>
                    <th style={{ padding: "4px 8px" }}>Puudused</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Eeldatav kulu</th>
                    <th style={{ padding: "4px 8px" }}>Planeeritud tegevus</th>
                    <th style={{ padding: "4px 8px" }}>Aeg</th>
                  </tr>
                </thead>
                <tbody>
                  {seisukord.filter(r => r.ese).map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px" }}>{s.ese === "Muu" ? "Muu" : s.ese}</td>
                      <td style={{ padding: "4px 8px" }}>{s.seisukordVal || ""}</td>
                      <td style={{ padding: "4px 8px" }}>{s.prioriteet || ""}</td>
                      <td style={{ padding: "4px 8px" }}>{s.puudused || ""}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{s.eeldatavKulu ? euroEE(s.eeldatavKulu) : ""}</td>
                      <td style={{ padding: "4px 8px" }}>{s.tegevus || ""}</td>
                      <td style={{ padding: "4px 8px" }}>{s.tegevusAasta ? `${s.tegevusKvartal ? s.tegevusKvartal + " kv " : ""}${s.tegevusAasta}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Investeeringud */}
          <div className="print-section">
            <h2 className="print-section-title">Investeeringud</h2>
            {plan.investmentsPipeline.items.length === 0
              ? <div>Investeeringuid pole lisatud.</div>
              : plan.investmentsPipeline.items.map(it => (
                <div key={it.id} style={{ marginBottom: 8 }}>
                  <div><span style={{ fontWeight: 700 }}>{it.name || "—"}</span> · {it.quarter}. kv {it.plannedYear} · {euroEE(it.totalCostEUR)}</div>
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
              <div><span style={{ fontWeight: 700 }}>Remondifondi määr:</span> {String(plan.funds.repairFund.monthlyRateEurPerM2).replace(".", ",")} €/m²/kuu</div>
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
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{String(ln.annualRatePct).replace(".", ",")}%</td>
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