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

// Laenu kuumakse arvutamine (annuiteet)
function arvutaKuumakse(summa, aastaneIntress, tahtaegKuudes) {
  const s = parseFloat(summa) || 0;
  const r = (parseFloat(String(aastaneIntress).replace(',', '.')) || 0) / 100 / 12;
  const n = parseInt(tahtaegKuudes) || 0;
  if (s <= 0 || n <= 0) return 0;
  if (r === 0) return Math.round(s / n);
  return Math.round(s * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
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
const KOMMUNAALTEENUSED = ["Soojus", "Vesi ja kanalisatsioon", "Elekter", "Prügivedu", "Kütus"];

const HALDUSTEENUSED = ["Haldus", "Raamatupidamine", "Koristus", "Kindlustus", "Hooldus", "Muu"];

const KULU_KATEGOORIAD = [...KOMMUNAALTEENUSED, ...HALDUSTEENUSED];

const TULU_KATEGOORIAD = ["Majandamiskulude ettemaks", "Vahendustasu", "Renditulu", "Muu tulu"];

const TULU_KATEGOORIA_MAP = {
  "Haldus": "Majandamiskulude ettemaks",
  "Raamatupidamine": "Majandamiskulude ettemaks",
  "Koristus": "Majandamiskulude ettemaks",
  "Kindlustus": "Majandamiskulude ettemaks",
  "Hooldus": "Majandamiskulude ettemaks",
  "Kommunaalmaksed": "Majandamiskulude ettemaks",
  "Muu": "Muu tulu",
};

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

const LAENU_LIIGID = ["Remondilaen", "Investeerimislaen", "Kapitalirent", "Laen omanikelt", "Muu"];

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
  "Majandamiskulude ettemaks": "nt Korteriomanike igakuine ettemaks",
  "Vahendustasu": "nt Kommunaalteenuste vahendustasu",
  "Renditulu": "nt Ruumide või parkimiskohtade rent",
  "Muu tulu": "nt Reklaamitulu, laekumised, toetused",
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
  const [muudInvesteeringud, setMuudInvesteeringud] = useState([]);
  const [repairFundSaldo, setRepairFundSaldo] = useState("");

  const derived = useMemo(() => computePlan(plan), [plan]);

  const kopiiriondvaade = useMemo(() => {
    // Map actual field names → Estonian aliases
    const kulud = plan.budget.costRows.map(r => ({
      kategooria: r.category,
      kogus: r.kogus,
      uhikuHind: r.uhikuHind,
      summaKuus: r.arvutus === "aastas" ? (parseFloat(r.summaInput) || 0) / 12
               : r.arvutus === "perioodis" ? (parseFloat(r.summaInput) || 0) / (derived.period.monthEq || 12)
               : parseFloat(r.summaInput) || 0,
    }));
    const tulud = plan.budget.incomeRows.map(r => ({
      summaKuus: r.arvutus === "aastas" ? (parseFloat(r.summaInput) || 0) / 12
               : r.arvutus === "perioodis" ? (parseFloat(r.summaInput) || 0) / (derived.period.monthEq || 12)
               : parseFloat(r.summaInput) || 0,
    }));
    const laenud = plan.loans.map(l => ({
      summa: l.principalEUR,
      intpiiri: l.annualRatePct,
      tahtaeg: l.termMonths,
    }));

    // Kommunaalkulud kokku (€/kuu)
    const kommunaalKokku = kulud
      .filter(k => KOMMUNAALTEENUSED.some(kt => kt === k.kategooria))
      .reduce((sum, k) => {
        const kogus = parseFloat(String(k.kogus || '0').replace(',', '.')) || 0;
        const hind = parseFloat(String(k.uhikuHind || '0').replace(',', '.')) || 0;
        return sum + Math.round(kogus * hind);
      }, 0);

    // Halduskulud kokku (€/kuu)
    const haldusKokku = kulud
      .filter(k => HALDUSTEENUSED.some(ht => ht === k.kategooria))
      .reduce((sum, k) => {
        const summaKuus = parseFloat(String(k.summaKuus || '0').replace(',', '.')) || 0;
        return sum + Math.round(summaKuus);
      }, 0);

    const kuludKokku = kommunaalKokku + haldusKokku;

    // Tulud kokku (€/kuu)
    const tuludKokku = tulud.reduce((sum, t) => {
      const summaKuus = parseFloat(String(t.summaKuus || '0').replace(',', '.')) || 0;
      return sum + Math.round(summaKuus);
    }, 0);

    // Planeeritud laenumaksed kokku (€/kuu)
    const planeeritudLaenudKokku = laenud.reduce((sum, l) => {
      return sum + arvutaKuumakse(l.summa, l.intpiiri, l.tahtaeg);
    }, 0);

    // Olemasolevate laenude kuumaksed kokku
    const olemasolevaLaenudKokku = olemasolevaLaenud.reduce((sum, l) => {
      return sum + (parseFloat(l.kuumakse) || 0);
    }, 0);

    const laenumaksedKokku = planeeritudLaenudKokku + olemasolevaLaenudKokku;

    const valjaminekudKokku = kuludKokku + laenumaksedKokku;
    const vahe = tuludKokku - valjaminekudKokku;

    return {
      kommunaalKokku,
      haldusKokku,
      kuludKokku,
      tuludKokku,
      planeeritudLaenudKokku,
      olemasolevaLaenudKokku,
      laenumaksedKokku,
      valjaminekudKokku,
      vahe,
    };
  }, [plan.budget.costRows, plan.budget.incomeRows, plan.loans, olemasolevaLaenud, derived.period.monthEq]);

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
  const [naitaVanuLaene, setNaitaVanuLaene] = useState(false);
  const [olemasolevaLaenud, setOlemasolevaLaenud] = useState([]);
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
      muudInvesteeringud,
      olemasolevaLaenud,
      repairFundSaldo,
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
        // Migrate investment quarters (numeric → roman)
        const kvMap = { "1": "I", "2": "II", "3": "III", "4": "IV" };
        if (candidateState.investmentsPipeline?.items) {
          candidateState.investmentsPipeline.items = candidateState.investmentsPipeline.items.map(it => ({
            ...it,
            quarter: kvMap[String(it.quarter)] || it.quarter || "I",
          }));
        }
        // Migrate old income categories + add missing fields
        if (candidateState.budget?.incomeRows) {
          candidateState.budget.incomeRows = candidateState.budget.incomeRows.map(r => ({
            arvutus: "perioodis",
            summaInput: r.calc?.params?.amountEUR || 0,
            ...r,
            category: TULU_KATEGOORIA_MAP[r.category] || r.category,
          }));
        }
        // Migrate old cost rows — add missing UI fields
        if (candidateState.budget?.costRows) {
          candidateState.budget.costRows = candidateState.budget.costRows.map(r => {
            if (r.arvutus !== undefined || r.kogus !== undefined) return r; // already migrated
            const isKommunaal = KOMMUNAALTEENUSED.includes(r.category);
            return isKommunaal
              ? { kogus: "", uhik: KOMMUNAAL_VAIKE_UHIK[r.category] || "", uhikuHind: "", ...r }
              : { arvutus: "perioodis", summaInput: r.calc?.params?.amountEUR || 0, ...r };
          });
        }
        // Migrate loan startYM → algusKvartal + algusAasta
        if (candidateState.loans) {
          const monthToKv = { "01": "I", "02": "I", "03": "I", "04": "II", "05": "II", "06": "II", "07": "III", "08": "III", "09": "III", "10": "IV", "11": "IV", "12": "IV" };
          const fallbackY = String(plan.period.year || new Date().getFullYear());
          candidateState.loans = candidateState.loans.map(ln => {
            const base = { sepiiriostudInvId: ln.sepiiriostudInvId || null };
            if (ln.algusKvartal && ln.algusAasta) return { ...ln, ...base, liik: ln.liik || "Remondilaen" };
            // Vana "KK.AAAA" formaat (algus väli)
            if (ln.algus && !ln.algusKvartal) {
              const ap = ln.algus.split(".");
              const kuu = parseInt(ap[0]) || 1;
              return { ...ln, ...base, algusKvartal: kuu <= 3 ? "I" : kuu <= 6 ? "II" : kuu <= 9 ? "III" : "IV", algusAasta: ap[1] || fallbackY, liik: ln.liik || "Remondilaen" };
            }
            // startYM "AAAA-KK" formaat
            const parts = (ln.startYM || "").split("-");
            return { ...ln, ...base, algusKvartal: monthToKv[parts[1]] || "I", algusAasta: parts[0] || fallbackY, liik: ln.liik || "Remondilaen" };
          });
        }
        setPlan(candidateState);
        // Sync KÜ data
        if (data.kyData) setKyData(data.kyData);
        setRepairFundSaldo(data.repairFundSaldo ?? "");
        // Migrate seisukord + old investments → eseme-based
        let importedSeisukord = [];
        if (data.seisukord) {
          if (typeof data.seisukord === "string") importedSeisukord = [];
          else importedSeisukord = data.seisukord.map(r => {
            const kvMap = { "1": "I", "2": "II", "3": "III", "4": "IV" };
            const kv = r.tegevusKvartal ? (kvMap[r.tegevusKvartal] || r.tegevusKvartal) : "";
            const { tegevusKvartal: _ignored, ...rest } = r;
            return { tegevusAasta: "", investeering: false, invNimetus: "", invMaksumus: 0, rahpiiri: [], id: crypto.randomUUID(), ...rest, tegevusKvartal: kv };
          });
        }
        // Migrate old separate investments into seisukord items or muudInvesteeringud
        const oldItems = candidateState.investmentsPipeline?.items || [];
        const importedMuudInv = [];
        if (oldItems.length > 0 && !importedSeisukord.some(r => r.investeering)) {
          oldItems.forEach(inv => {
            const kvMap = { "1": "I", "2": "II", "3": "III", "4": "IV" };
            const seotud = inv.seisukordId ? importedSeisukord.find(e => e.id === inv.seisukordId) : null;
            const rahpiiri = (inv.fundingPlan || []).map(fp => ({ allikas: ({ REPAIR_FUND: "Remondifond", RESERVE: "Reservkapital", LOAN: "Laen", GRANT: "Toetus", ONE_OFF: "Erakorraline makse" })[fp.source] || fp.source, summa: fp.amountEUR || 0 }));
            if (seotud) {
              seotud.investeering = true;
              seotud.invNimetus = inv.name || "";
              seotud.invMaksumus = inv.totalCostEUR || 0;
              seotud.rahpiiri = rahpiiri;
            } else {
              importedMuudInv.push({
                id: crypto.randomUUID(),
                nimetus: inv.name || "",
                aasta: String(inv.plannedYear || ""),
                kvartal: kvMap[String(inv.quarter)] || inv.quarter || "I",
                maksumus: inv.totalCostEUR || 0,
                rahpiiri,
              });
            }
          });
        }
        // Migrate seisukord "Muu" items to muudInvesteeringud
        importedSeisukord = importedSeisukord.filter(r => {
          if (r.ese === "Muu" && r.investeering) {
            importedMuudInv.push({
              id: crypto.randomUUID(),
              nimetus: r.invNimetus || r.muuNimetus || "",
              aasta: r.tegevusAasta || "",
              kvartal: r.tegevusKvartal || "I",
              maksumus: r.invMaksumus || 0,
              rahpiiri: r.rahpiiri || [],
            });
            return false;
          }
          return r.ese !== "Muu"; // drop non-investment "Muu" items too
        });
        setSeisukord(importedSeisukord);
        // Merge: new-format muudInvesteeringud + migrated old items
        const newFormatMuud = Array.isArray(data.muudInvesteeringud) ? data.muudInvesteeringud : [];
        setMuudInvesteeringud([...newFormatMuud, ...importedMuudInv]);
        setOlemasolevaLaenud((Array.isArray(data.olemasolevaLaenud) ? data.olemasolevaLaenud : []).map(ol => {
          const migKp = (v) => {
            if (v && typeof v === "object" && "d" in v) return v;
            if (typeof v === "string" && v.includes(".")) {
              const p = v.split(".");
              return { d: Number(p[0]) || "", m: Number(p[1]) || "", y: Number(p[2]) || "" };
            }
            return { d: "", m: "", y: "" };
          };
          return { ...ol, algusKuupaev: migKp(ol.algusKuupaev), loppKuupaev: migKp(ol.loppKuupaev) };
        }));
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
      return { ...p, building: { ...p.building, apartments: [...p.building.apartments, { ...mkApartment({ label: nextLabel, areaM2: 0 }), omanikud: "" }] } };
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
      ...(side === "COST"
        ? { category: "Haldus", kogus: "", uhik: "", uhikuHind: "", arvutus: "kuus", summaInput: 0 }
        : { category: "Majandamiskulude ettemaks", arvutus: "kuus", summaInput: 0 }),
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
      patch.arvutus = undefined;
      patch.summaInput = undefined;
    } else {
      patch.arvutus = "kuus";
      patch.summaInput = 0;
      patch.kogus = undefined;
      patch.uhik = undefined;
      patch.uhikuHind = undefined;
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
    const y = plan.period.year || new Date().getFullYear();
    setSeisukord(prev => [...prev, {
      id: crypto.randomUUID(),
      ese: "",
      seisukordVal: "",
      puudused: "",
      prioriteet: "",
      eeldatavKulu: 0,
      tegevus: "",
      tegevusAasta: String(y),
      tegevusKvartal: "I",
      investeering: false,
      invNimetus: "",
      invMaksumus: 0,
      rahpiiri: [],
    }]);
  };

  const uuendaSeisukord = (id, field, value) => {
    setSeisukord(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const eemaldaSeisukordRida = (id) => {
    setSeisukord(prev => prev.filter(r => r.id !== id));
  };

  const handleLooInvesteering = (rida) => {
    if (rida.investeering) return;
    const nimi = rida.ese + (rida.tegevus ? " — " + rida.tegevus : "");
    setSeisukord(prev => prev.map(r => r.id === rida.id ? {
      ...r,
      investeering: true,
      invNimetus: nimi,
      invMaksumus: r.eeldatavKulu || 0,
    } : r));
  };

  const eemaldaInvesteering = (id) => {
    // Eemalda seotud laen enne rahpiiri tühjendamist
    const rida = seisukord.find(r => r.id === id);
    if (rida?.rahpiiri?.some(rp => rp.allikas === "Laen")) {
      eemaldaSeostudLaen(id);
    }
    setSeisukord(prev => prev.map(r => r.id === id ? {
      ...r, investeering: false, invNimetus: "", invMaksumus: 0, rahpiiri: [],
    } : r));
  };

  const lisaRahpiiriRida = (id) => {
    setSeisukord(prev => prev.map(r => r.id === id ? {
      ...r, rahpiiri: [...r.rahpiiri, { allikas: "Remondifond", summa: 0 }],
    } : r));
  };

  const uuendaRahpiiriRida = (id, ri, patch) => {
    setSeisukord(prev => {
      const rida = prev.find(r => r.id === id);
      const vanaAllikas = rida?.rahpiiri[ri]?.allikas;
      const uusAllikas = patch.allikas !== undefined ? patch.allikas : vanaAllikas;
      const updated = prev.map(r => r.id === id ? {
        ...r, rahpiiri: r.rahpiiri.map((row, i) => i === ri ? { ...row, ...patch } : row),
      } : r);
      // Sync laenuga
      if (uusAllikas === "Laen" && vanaAllikas !== "Laen") {
        const uusRida = updated.find(r => r.id === id);
        const summa = parseFloat(uusRida?.rahpiiri[ri]?.summa) || 0;
        setTimeout(() => syncLaenRahastusplaanist(id, summa), 0);
      } else if (vanaAllikas === "Laen" && uusAllikas !== "Laen") {
        setTimeout(() => eemaldaSeostudLaen(id), 0);
      } else if (uusAllikas === "Laen" && patch.summa !== undefined) {
        const uusSumma = parseFloat(patch.summa) || 0;
        setTimeout(() => syncLaenRahastusplaanist(id, uusSumma), 0);
      }
      return updated;
    });
  };

  const eemaldaRahpiiriRida = (id, ri) => {
    setSeisukord(prev => {
      const rida = prev.find(r => r.id === id);
      const eemaldatav = rida?.rahpiiri[ri];
      if (eemaldatav?.allikas === "Laen") {
        setTimeout(() => eemaldaSeostudLaen(id), 0);
      }
      return prev.map(r => r.id === id ? {
        ...r, rahpiiri: r.rahpiiri.filter((_, i) => i !== ri),
      } : r);
    });
  };

  // --- MUUD INVESTEERINGUD ---
  const lisaMuuInvesteering = () => {
    setMuudInvesteeringud(prev => [...prev, {
      id: Date.now().toString(),
      nimetus: "",
      aasta: String(plan.period.year || new Date().getFullYear()),
      kvartal: "I",
      maksumus: "",
      rahpiiri: [],
    }]);
  };

  const eemaldaMuuInvesteering = (idx) => {
    const inv = muudInvesteeringud[idx];
    if (inv?.rahpiiri?.some(rp => rp.allikas === "Laen")) {
      eemaldaSeostudLaen(inv.id);
    }
    setMuudInvesteeringud(prev => prev.filter((_, i) => i !== idx));
  };

  const handleMuuInvChange = (idx, field, value) => {
    setMuudInvesteeringud(prev => prev.map((inv, i) =>
      i === idx ? { ...inv, [field]: value } : inv
    ));
  };

  const lisaMuuRahpiiriRida = (idx) => {
    setMuudInvesteeringud(prev => prev.map((inv, i) =>
      i === idx ? { ...inv, rahpiiri: [...inv.rahpiiri, { allikas: "Remondifond", summa: "" }] } : inv
    ));
  };

  const eemaldaMuuRahpiiriRida = (invIdx, ridaIdx) => {
    setMuudInvesteeringud(prev => {
      const inv = prev[invIdx];
      const eemaldatav = inv?.rahpiiri[ridaIdx];
      if (eemaldatav?.allikas === "Laen") {
        setTimeout(() => eemaldaSeostudLaen(inv.id), 0);
      }
      return prev.map((inv2, i) =>
        i === invIdx ? { ...inv2, rahpiiri: inv2.rahpiiri.filter((_, ri) => ri !== ridaIdx) } : inv2
      );
    });
  };

  const handleMuuRahpiiriChange = (invIdx, ridaIdx, field, value) => {
    setMuudInvesteeringud(prev => {
      const inv = prev[invIdx];
      const vanaAllikas = inv?.rahpiiri[ridaIdx]?.allikas;
      const uusAllikas = field === "allikas" ? value : vanaAllikas;
      const updated = prev.map((inv2, i) =>
        i === invIdx ? {
          ...inv2,
          rahpiiri: inv2.rahpiiri.map((r, ri) => ri === ridaIdx ? { ...r, [field]: value } : r),
        } : inv2
      );
      const invId = inv.id;
      if (uusAllikas === "Laen" && vanaAllikas !== "Laen") {
        const uusRida = updated[invIdx];
        const summa = parseFloat(uusRida?.rahpiiri[ridaIdx]?.summa) || 0;
        setTimeout(() => syncLaenRahastusplaanist(invId, summa), 0);
      } else if (vanaAllikas === "Laen" && uusAllikas !== "Laen") {
        setTimeout(() => eemaldaSeostudLaen(invId), 0);
      } else if (uusAllikas === "Laen" && field === "summa") {
        const uusSumma = parseFloat(value) || 0;
        setTimeout(() => syncLaenRahastusplaanist(invId, uusSumma), 0);
      }
      return updated;
    });
  };

  // --- LAENU SÜNKROON RAHASTUSPLAANIST ---
  const syncLaenRahastusplaanist = (investeeringId, laenSumma) => {
    setPlan(p => {
      const olemas = p.loans.find(l => l.sepiiriostudInvId === investeeringId);
      if (olemas) {
        return { ...p, loans: p.loans.map(l =>
          l.sepiiriostudInvId === investeeringId ? { ...l, principalEUR: laenSumma } : l
        )};
      }
      const y = String(p.period.year || new Date().getFullYear());
      return { ...p, loans: [...p.loans, {
        ...mkLoan({ startYM: `${y}-01` }),
        liik: "Investeerimislaen",
        algusKvartal: "I",
        algusAasta: y,
        sepiiriostudInvId: investeeringId,
        principalEUR: laenSumma,
      }]};
    });
  };

  const eemaldaSeostudLaen = (investeeringId) => {
    setPlan(p => {
      const seotud = p.loans.find(l => l.sepiiriostudInvId === investeeringId);
      if (!seotud) return p;
      if (seotud.annualRatePct || seotud.termMonths) {
        if (!window.confirm("Eemaldada ka seotud laenurida Fondid & laen sektsioonist?")) {
          return { ...p, loans: p.loans.map(l =>
            l.sepiiriostudInvId === investeeringId ? { ...l, sepiiriostudInvId: null } : l
          )};
        }
      }
      return { ...p, loans: p.loans.filter(l => l.sepiiriostudInvId !== investeeringId) };
    });
  };

  const kvToMonth = { I: "01", II: "04", III: "07", IV: "10" };

  const addLoan = () => {
    const y = String(plan.period.year || new Date().getFullYear());
    setPlan(p => ({ ...p, loans: [...p.loans, { ...mkLoan({ startYM: `${y}-01` }), liik: "Remondilaen", algusKvartal: "I", algusAasta: y, sepiiriostudInvId: null }] }));
  };

  const updateLoan = (id, patch) => {
    setPlan(p => ({ ...p, loans: p.loans.map(ln => {
      if (ln.id !== id) return ln;
      const updated = { ...ln, ...patch };
      if (patch.algusKvartal || patch.algusAasta) {
        const fallbackY = String(p.period.year || new Date().getFullYear());
        updated.startYM = `${updated.algusAasta || fallbackY}-${kvToMonth[updated.algusKvartal] || "01"}`;
      }
      return updated;
    }) }));
  };

  const removeLoan = (id) => {
    setPlan(p => {
      const ln = p.loans.find(l => l.id === id);
      if (ln?.sepiiriostudInvId) {
        if (!window.confirm("See laen on seotud investeeringuga. Eemaldada?")) return p;
      }
      const updated = p.loans.filter(l => l.id !== id);
      if (updated.length === 0) setNaitaVanuLaene(false);
      return { ...p, loans: updated };
    });
  };

  // --- OLEMASOLEVAD LAENUD (eelnevate perioodide laenud) ---
  const mkOlemasolevaLaen = () => ({
    id: crypto.randomUUID(),
    liik: "Remondilaen",
    algSumma: "",
    jaak: "",
    intress: "",
    algusKuupaev: { d: "", m: "", y: "" },
    loppKuupaev: { d: "", m: "", y: "" },
    kuumakse: "",
  });

  const addOlemasolevaLaen = () => {
    setOlemasolevaLaenud(prev => [...prev, mkOlemasolevaLaen()]);
    setNaitaVanuLaene(true);
  };

  const updateOlemasolevaLaen = (id, patch) => {
    setOlemasolevaLaenud(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  };

  const removeOlemasolevaLaen = (id) => {
    setOlemasolevaLaenud(prev => {
      const updated = prev.filter(l => l.id !== id);
      if (updated.length === 0) setNaitaVanuLaene(false);
      return updated;
    });
  };

  // Auto-add one empty row when section is empty (setPlan, not addX — idempotent even if effect fires twice)
  useEffect(() => { if (plan.building.apartments.length === 0) setPlan(p => ({ ...p, building: { ...p.building, apartments: [{ ...mkApartment({ label: "1" }), omanikud: "" }] } })); }, [plan.building.apartments.length]);
  // Investeeringud algavad tühjana — luuakse ainult "Loo investeering" või "+ Lisa investeering" kaudu
  useEffect(() => { if (plan.budget.costRows.length === 0) setPlan(p => ({ ...p, budget: { ...p.budget, costRows: [{ ...mkCashflowRow({ side: "COST" }), category: "Haldus", kogus: "", uhik: "", uhikuHind: "", arvutus: "kuus", summaInput: 0 }] } })); }, [plan.budget.costRows.length]);
  useEffect(() => { if (plan.budget.incomeRows.length === 0) setPlan(p => ({ ...p, budget: { ...p.budget, incomeRows: [{ ...mkCashflowRow({ side: "INCOME", category: "Majandamiskulude ettemaks" }), arvutus: "kuus", summaInput: 0 }] } })); }, [plan.budget.incomeRows.length]);

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

  // Tulude summa sünkroonimine engine'ile (→ calc.params.amountEUR)
  useEffect(() => {
    let changed = false;
    const updated = plan.budget.incomeRows.map(r => {
      if (r.arvutus === undefined) return r;
      const summa = arvutaHaldusSumma(r);
      if (r.calc.params.amountEUR !== summa) {
        changed = true;
        return { ...r, calc: { type: "FIXED_PERIOD", params: { amountEUR: summa } } };
      }
      return r;
    });
    if (changed) setPlan(p => ({ ...p, budget: { ...p.budget, incomeRows: updated } }));
  }, [plan.budget.incomeRows, derived.period.monthEq]);

  // Kõik investeeringud ühendatud (seisukord + muud) — ühtne formaat UI ja engine jaoks
  const koikInvesteeringud = [
    ...seisukord.filter(e => e.investeering).map(e => ({
      id: e.id,
      nimetus: e.invNimetus,
      aasta: e.tegevusAasta,
      kvartal: e.tegevusKvartal,
      maksumus: e.invMaksumus,
      rahpiiri: e.rahpiiri || [],
      _src: "ese",
    })),
    ...muudInvesteeringud.map(inv => ({
      id: inv.id,
      nimetus: inv.nimetus,
      aasta: inv.aasta,
      kvartal: inv.kvartal,
      maksumus: inv.maksumus,
      rahpiiri: inv.rahpiiri || [],
      _src: "muu",
    })),
  ];

  // Investeeringute sünkroonimine engine'ile
  useEffect(() => {
    const items = koikInvesteeringud.map(inv => ({
      ...mkInvestmentItem({
        name: inv.nimetus,
        plannedYear: inv.aasta ? Number(inv.aasta) : (plan.period.year || new Date().getFullYear()),
        quarter: inv.kvartal || "I",
        totalCostEUR: inv.maksumus || 0,
      }),
      id: inv.id + (inv._src === "ese" ? "::inv" : "::muuInv"),
      seisukordId: inv._src === "ese" ? inv.id : null,
      fundingPlan: inv.rahpiiri.map(rp => ({ source: rp.allikas, amountEUR: rp.summa || 0 })),
    }));
    const prev = plan.investmentsPipeline.items;
    const same = prev.length === items.length && items.every((it, i) =>
      prev[i]?.id === it.id && prev[i]?.name === it.name && prev[i]?.totalCostEUR === it.totalCostEUR
      && prev[i]?.plannedYear === it.plannedYear && prev[i]?.quarter === it.quarter
      && JSON.stringify(prev[i]?.fundingPlan) === JSON.stringify(it.fundingPlan)
    );
    if (!same) setPlan(p => ({ ...p, investmentsPipeline: { ...p.investmentsPipeline, items } }));
  }, [seisukord, muudInvesteeringud]);

  // Laenud algavad tühjana — luuakse ainult "+ Lisa laen" kaudu või rahastusplaanist automaatselt
  useEffect(() => { if (seisukord.length === 0) { const y = String(plan.period.year || new Date().getFullYear()); setSeisukord([{ id: crypto.randomUUID(), ese: "", seisukordVal: "", puudused: "", prioriteet: "", eeldatavKulu: 0, tegevus: "", tegevusAasta: y, tegevusKvartal: "I", investeering: false, invNimetus: "", invMaksumus: 0, rahpiiri: [] }]); } }, [seisukord.length]);

  // Perioodi aasta muutumisel: uuenda tühjad aasta väljad
  useEffect(() => {
    const y = plan.period.year;
    if (!y) return;
    const ys = String(y);
    setSeisukord(prev => {
      const updated = prev.map(e => (!e.tegevusAasta || e.tegevusAasta === "") ? { ...e, tegevusAasta: ys } : e);
      return updated.some((e, i) => e !== prev[i]) ? updated : prev;
    });
    setMuudInvesteeringud(prev => {
      const updated = prev.map(inv => (!inv.aasta || inv.aasta === "") ? { ...inv, aasta: ys } : inv);
      return updated.some((inv, i) => inv !== prev[i]) ? updated : prev;
    });
  }, [plan.period.year]);

  const SECS = ["Periood & korterid", "Esemed ja investeeringud", "Kulud", "Tulud", "Fondid & laen", "Korterite maksed", "Kontroll & kokkuvõte"];

  const clearSection = (tabIdx) => {
    if (!window.confirm("Kas soovid selle jaotise andmed kustutada? Seda ei saa tagasi võtta.")) return;
    if (tabIdx === 0) { setPeriodParts({ sd: "", sm: "", sy: "", ed: "", em: "", ey: "" }); setKyData({ nimi: "", registrikood: "", aadress: "" }); }
    setPlan(p => {
      if (tabIdx === 0) return { ...p, period: { ...p.period, start: "", end: "" }, building: { ...p.building, apartments: [] } };
      if (tabIdx === 1) { setSeisukord([]); setMuudInvesteeringud([]); return { ...p, investmentsPipeline: { ...p.investmentsPipeline, items: [] } }; }
      if (tabIdx === 2) return { ...p, budget: { ...p.budget, costRows: [] } };
      if (tabIdx === 3) return { ...p, budget: { ...p.budget, incomeRows: [] } };
      if (tabIdx === 4) { setRepairFundSaldo(""); return { ...p, funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } }, loans: [] }; }
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
    // 1: Kaasomandi esemed
    seisukord.some(r => r.ese) ? (seisukord.some(r => r.investeering) ? "done" : "partial") : "empty",
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

        {/* ── Koondvaade — alati nähtav ── */}
        {(() => {
          const { kuludKokku, tuludKokku, laenumaksedKokku, vahe } = kopiiriondvaade;
          const netoColor = vahe >= 0 ? "#15803d" : "#dc2626";
          const kvStyle = { display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" };
          const kvNum = { fontFamily: "monospace", fontWeight: 700, fontSize: 15 };
          const kvLabel = { fontSize: 12, color: N.dim };
          const kvSep = { color: N.border, margin: "0 4px", fontSize: 13 };
          return (
            <div style={{
              display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
              padding: "8px 14px", marginBottom: 16, borderRadius: 8,
              background: N.surface, border: `1px solid ${N.border}`, fontSize: 14,
            }}>
              <span style={kvStyle}><span style={kvLabel}>Kulud</span> <span style={kvNum}>{euro(kuludKokku)}/kuu</span></span>
              <span style={kvSep}>|</span>
              <span style={kvStyle}><span style={kvLabel}>Tulud</span> <span style={kvNum}>{euro(tuludKokku)}/kuu</span></span>
              <span style={kvSep}>|</span>
              <span style={kvStyle}><span style={kvLabel}>Laenumaksed</span> <span style={kvNum}>{euro(laenumaksedKokku)}/kuu</span></span>
              <span style={kvSep}>|</span>
              <span style={kvStyle}><span style={kvLabel}>Neto</span> <span style={{ ...kvNum, color: netoColor }}>{euro(vahe)}/kuu</span></span>
            </div>
          );
        })()}

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

              // Kas kuupäevad vastavad täisaastale? (01.01.XXXX – 31.12.XXXX)
              const majandusaasta = (
                Number(pp.sd) === 1 && Number(pp.sm) === 1 &&
                Number(pp.ed) === 31 && Number(pp.em) === 12 &&
                pp.sy && pp.sy === pp.ey
              ) ? String(pp.sy) : "";

              return (
                <div style={card}>
                  <div style={{ ...sectionTitle, marginBottom: 12 }}>Periood</div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={fieldLabel}>Majandusaasta</div>
                    <select
                      value={majandusaasta}
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
                        <option key={y} value={String(y)}>{y}</option>
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
                    <th style={{ padding: "6px 8px" }}>Omanik(ud)</th>
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
                        <td style={{ padding: "6px 8px" }}><input value={a.omanikud || ""} onChange={(e) => updateApartment(a.id, { omanikud: e.target.value })} placeholder="nt Tamm, Kask" style={inputStyle} /></td>
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
                      <select value={rida.tegevusAasta || String(plan.period.year || new Date().getFullYear())} onChange={(e) => uuendaSeisukord(rida.id, "tegevusAasta", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        {(() => { const y = plan.period.year || new Date().getFullYear(); return [y, y + 1, y + 2, y + 3].map(v => <option key={v} value={String(v)}>{v}</option>); })()}
                      </select>
                    </div>
                    <div style={{ width: 70 }}>
                      <div style={fieldLabel}>Kvartal</div>
                      <select value={rida.tegevusKvartal || ""} onChange={(e) => uuendaSeisukord(rida.id, "tegevusKvartal", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        <option value="">—</option>
                        <option value="I">I</option>
                        <option value="II">II</option>
                        <option value="III">III</option>
                        <option value="IV">IV</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button style={btnRemove} onClick={() => eemaldaSeisukordRida(rida.id)}>Eemalda</button>
                    {rida.ese && (rida.eeldatavKulu > 0 || rida.tegevus) && !rida.investeering && (
                      <button style={{ fontSize: 13, color: "#2563eb", background: "none", border: "1px solid #2563eb", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }} onClick={() => handleLooInvesteering(rida)}>Loo investeering</button>
                    )}
                  </div>

                  {rida.investeering && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${N.rule}` }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: N.text }}>Investeering</div>
                      <div style={{ display: "flex", gap: 16, alignItems: "end" }}>
                        <div style={{ flex: 1 }}>
                          <div style={fieldLabel}>Nimetus</div>
                          <input value={rida.invNimetus} onChange={(e) => uuendaSeisukord(rida.id, "invNimetus", e.target.value)} placeholder="nt Katuse remont" style={inputStyle} />
                        </div>
                        <div style={{ width: 160 }}>
                          <div style={fieldLabel}>Maksumus €</div>
                          <EuroInput value={rida.invMaksumus} onChange={(v) => uuendaSeisukord(rida.id, "invMaksumus", v)} style={numStyle} />
                        </div>
                      </div>

                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4, color: N.sub }}>Rahastusplaan</div>
                        {rida.rahpiiri.length === 0 && (
                          <p style={{ color: N.dim, fontSize: 13 }}>Rahastusridu pole lisatud.</p>
                        )}
                        {rida.rahpiiri.map((rp, ri) => (
                          <div key={ri} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                            <select value={rp.allikas} onChange={(e) => uuendaRahpiiriRida(rida.id, ri, { allikas: e.target.value })} style={{ ...selectStyle, width: 150 }}>
                              <option value="Remondifond">Remondifond</option>
                              <option value="Reservkapital">Reservkapital</option>
                              <option value="Laen">Laen</option>
                              <option value="Toetus">Toetus</option>
                              <option value="Erakorraline makse">Erakorraline makse</option>
                            </select>
                            <div style={{ width: 120 }}>
                              <EuroInput value={rp.summa} onChange={(v) => uuendaRahpiiriRida(rida.id, ri, { summa: v })} style={numStyle} />
                            </div>
                            <button onClick={() => eemaldaRahpiiriRida(rida.id, ri)} style={{ color: N.dim, background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>Eemalda</button>
                            {rp.allikas === "Laen" && plan.loans.find(l => l.sepiiriostudInvId === rida.id) && (
                              <button onClick={() => { setSec(4); setTimeout(() => document.getElementById(`laen-${plan.loans.find(l => l.sepiiriostudInvId === rida.id)?.id}`)?.scrollIntoView({ behavior: "smooth" }), 100); }} style={{ color: "#15803d", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
                                {"\u2713"} Laen {euro(parseFloat(rp.summa) || 0)} {"\u2192"} Fondid & laen
                              </button>
                            )}
                          </div>
                        ))}
                        {(() => {
                          const maksumus = parseFloat(rida.invMaksumus) || 0;
                          const kaetud = (rida.rahpiiri || []).reduce((s, r) => s + (parseFloat(r.summa) || 0), 0);
                          const vahe = maksumus - kaetud;
                          if (maksumus <= 0) return null;
                          return (
                            <div style={{ fontSize: 13, marginTop: 4, color: vahe === 0 ? "#15803d" : "#d97706" }}>
                              {vahe === 0 ? "✓ Täielikult kaetud" : vahe > 0 ? `Kaetud: ${euro(kaetud)} / ${euro(maksumus)} · katmata: ${euro(vahe)}` : `Kaetud: ${euro(kaetud)} / ${euro(maksumus)} · ületab ${euro(Math.abs(vahe))}`}
                            </div>
                          );
                        })()}
                        <button onClick={() => lisaRahpiiriRida(rida.id)} style={{ ...btnAdd, fontSize: 13, padding: "4px 10px", marginTop: 4 }}>+ Lisa rahastusrida</button>
                      </div>

                      <button onClick={() => eemaldaInvesteering(rida.id)} style={{ color: "#dc2626", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginTop: 8 }}>Eemalda investeering</button>
                    </div>
                  )}
                </div>
              ))}

              <div style={{ marginTop: 8 }}>
                <button style={btnAdd} onClick={lisaSeisukordRida}>+ Lisa ese</button>
              </div>
            </div>

            {/* Muud investeeringud */}
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 18, color: N.text, marginBottom: 4 }}>Muud investeeringud</div>
              <div style={{ ...helperText, marginBottom: 12 }}>
                Investeeringud, mis ei ole seotud konkreetse kaasomandi esemega (nt energiaaudit, turvasüsteem, projektijuhtimine).
              </div>

              {muudInvesteeringud.length === 0 && (
                <p style={{ color: N.dim, fontSize: "0.9rem" }}>Muid investeeringuid pole lisatud.</p>
              )}

              {muudInvesteeringud.map((inv, idx) => (
                <div key={inv.id} style={{ border: `1px solid ${N.rule}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 16, alignItems: "end" }}>
                    <div style={{ flex: 1 }}>
                      <div style={fieldLabel}>Nimetus</div>
                      <input value={inv.nimetus} onChange={(e) => handleMuuInvChange(idx, "nimetus", e.target.value)} placeholder="nt Energiaaudit, turvasüsteem" style={inputStyle} />
                    </div>
                    <div style={{ width: 160 }}>
                      <div style={fieldLabel}>Maksumus €</div>
                      <EuroInput value={inv.maksumus} onChange={(v) => handleMuuInvChange(idx, "maksumus", v)} style={numStyle} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "end" }}>
                    <div style={{ width: 100 }}>
                      <div style={fieldLabel}>Aasta</div>
                      <select value={inv.aasta || String(plan.period.year || new Date().getFullYear())} onChange={(e) => handleMuuInvChange(idx, "aasta", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        {(() => { const y = plan.period.year || new Date().getFullYear(); return [y, y + 1, y + 2, y + 3].map(v => <option key={v} value={String(v)}>{v}</option>); })()}
                      </select>
                    </div>
                    <div style={{ width: 80 }}>
                      <div style={fieldLabel}>Kvartal</div>
                      <select value={inv.kvartal} onChange={(e) => handleMuuInvChange(idx, "kvartal", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        <option value="I">I</option><option value="II">II</option><option value="III">III</option><option value="IV">IV</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4, color: N.sub }}>Rahastusplaan</div>
                    {inv.rahpiiri.length === 0 && (
                      <p style={{ color: N.dim, fontSize: 13 }}>Rahastusridu pole lisatud.</p>
                    )}
                    {inv.rahpiiri.map((rp, ri) => (
                      <div key={ri} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                        <select value={rp.allikas} onChange={(e) => handleMuuRahpiiriChange(idx, ri, "allikas", e.target.value)} style={{ ...selectStyle, width: 150 }}>
                          <option value="Remondifond">Remondifond</option>
                          <option value="Reservkapital">Reservkapital</option>
                          <option value="Laen">Laen</option>
                          <option value="Toetus">Toetus</option>
                          <option value="Erakorraline makse">Erakorraline makse</option>
                        </select>
                        <div style={{ width: 120 }}>
                          <EuroInput value={rp.summa} onChange={(v) => handleMuuRahpiiriChange(idx, ri, "summa", v)} style={numStyle} />
                        </div>
                        <button onClick={() => eemaldaMuuRahpiiriRida(idx, ri)} style={{ color: N.dim, background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>Eemalda</button>
                        {rp.allikas === "Laen" && plan.loans.find(l => l.sepiiriostudInvId === inv.id) && (
                          <button onClick={() => { setSec(4); setTimeout(() => document.getElementById(`laen-${plan.loans.find(l => l.sepiiriostudInvId === inv.id)?.id}`)?.scrollIntoView({ behavior: "smooth" }), 100); }} style={{ color: "#15803d", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
                            {"\u2713"} Laen {euro(parseFloat(rp.summa) || 0)} {"\u2192"} Fondid & laen
                          </button>
                        )}
                      </div>
                    ))}
                    {(() => {
                      const maksumus = parseFloat(inv.maksumus) || 0;
                      const kaetud = (inv.rahpiiri || []).reduce((s, r) => s + (parseFloat(r.summa) || 0), 0);
                      const vahe = maksumus - kaetud;
                      if (maksumus <= 0) return null;
                      return (
                        <div style={{ fontSize: 13, marginTop: 4, color: vahe === 0 ? "#15803d" : "#d97706" }}>
                          {vahe === 0 ? "✓ Täielikult kaetud" : vahe > 0 ? `Kaetud: ${euro(kaetud)} / ${euro(maksumus)} · katmata: ${euro(vahe)}` : `Kaetud: ${euro(kaetud)} / ${euro(maksumus)} · ületab ${euro(Math.abs(vahe))}`}
                        </div>
                      );
                    })()}
                    <button onClick={() => lisaMuuRahpiiriRida(idx)} style={{ ...btnAdd, fontSize: 13, padding: "4px 10px", marginTop: 4 }}>+ Lisa rahastusrida</button>
                  </div>

                  <button onClick={() => eemaldaMuuInvesteering(idx)} style={{ color: "#dc2626", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginTop: 8 }}>Eemalda</button>
                </div>
              ))}

              <div style={{ marginTop: 8 }}>
                <button style={btnAdd} onClick={lisaMuuInvesteering}>+ Lisa investeering</button>
              </div>
            </div>

            {(seisukord.some(e => e.investeering) || muudInvesteeringud.length > 0) && (() => {
              const esemeInv = seisukord.filter(e => e.investeering);
              const esemeSum = esemeInv.reduce((s, e) => s + (parseFloat(e.invMaksumus) || 0), 0);
              const muudSum = muudInvesteeringud.reduce((s, inv) => s + (parseFloat(inv.maksumus) || 0), 0);
              const koguarv = esemeInv.length + muudInvesteeringud.length;
              const koguMaksumus = esemeSum + muudSum;
              const koguKaetud = [
                ...esemeInv.flatMap(e => e.rahpiiri || []),
                ...muudInvesteeringud.flatMap(inv => inv.rahpiiri || []),
              ].reduce((s, r) => s + (parseFloat(r.summa) || 0), 0);
              const katmata = koguMaksumus - koguKaetud;
              return (
                <div style={{ fontSize: 14, color: N.sub, marginTop: 16 }}>
                  Investeeringud kokku: {koguarv} · maksumus {euro(koguMaksumus)}
                  {" · "}kaetud {euro(koguKaetud)}
                  {katmata > 0 && <span style={{ color: "#d97706" }}> · katmata {euro(katmata)}</span>}
                </div>
              );
            })()}
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
                        <div style={{ width: side === "INCOME" ? 220 : 180 }}>
                          <div style={fieldLabel}>Kategooria</div>
                          <select value={r.category || ""} onChange={(e) => side === "COST" ? handleKuluKategooriaChange(r.id, e.target.value) : updateRow(side, r.id, { category: e.target.value })} style={{ ...selectStyle, width: "100%" }}>
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
                              <NumberInput value={r.uhikuHind} onChange={(v) => updateRow(side, r.id, { uhikuHind: v })} placeholder="0" style={numStyle} />
                            </div>
                            <div style={{ width: 130 }}>
                              <div style={fieldLabel}>Summa €</div>
                              <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, paddingTop: 6 }}>
                                {euro((parseFloat(r.kogus) || 0) * (parseFloat(r.uhikuHind) || 0))}
                              </div>
                            </div>
                          </>
                        ) : r.category ? (
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
                                {r.arvutus === "aastas" ? "€/aasta" : r.arvutus === "perioodis" ? "Summa €" : "Summa"}
                              </div>
                              <EuroInput value={r.summaInput} onChange={(v) => updateRow(side, r.id, { summaInput: v })} style={numStyle} />
                            </div>
                            <div style={{ width: 130 }}>
                              <div style={fieldLabel}>Perioodis</div>
                              <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, paddingTop: 6 }}>
                                {euro(arvutaHaldusSumma(r) || 0)}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div style={{ width: 140 }}>
                            <div style={fieldLabel}>Summa €</div>
                            <EuroInput value={r.summaInput || 0} onChange={(v) => updateRow(side, r.id, { summaInput: v, arvutus: "perioodis" })} style={numStyle} />
                          </div>
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
                    ? <>Kulud perioodis: {euro(derived.totals.costPeriodEUR || 0)} · kuus {euro(derived.totals.costMonthlyEUR || 0)}/kuu</>
                    : <>Tulud perioodis: {euro(derived.totals.incomePeriodEUR || 0)} · kuus {euro(derived.totals.incomeMonthlyEUR || 0)}/kuu</>
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
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Remondifond</div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ width: 200 }}>
                  <div style={fieldLabel}>Remondifondi saldo €</div>
                  <EuroInput value={repairFundSaldo} onChange={(v) => setRepairFundSaldo(v)} placeholder="Fondi praegune seis" style={numStyle} />
                </div>
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
              <div style={{ fontSize: 13, color: N.sub, marginBottom: 12 }}>Seadusega nõutav reserv ettenägematute kulude katteks (1/12 aasta kuludest).</div>

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

              {/* ── Olemasolevad laenud (eelnevatest perioodidest) ── */}
              {!naitaVanuLaene && olemasolevaLaenud.length === 0 && (
                <button
                  type="button"
                  onClick={addOlemasolevaLaen}
                  style={{ ...btnAdd, fontSize: 13, marginBottom: 12 }}
                >
                  + Eelnevatest perioodidest võetud laen
                </button>
              )}

              {(naitaVanuLaene || olemasolevaLaenud.length > 0) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: N.sub, marginBottom: 8 }}>Olemasolevad laenud</div>
                  <div style={{ ...helperText, marginBottom: 8 }}>Eelnevatest perioodidest võetud laenud, mille teenindus jätkub.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {olemasolevaLaenud.map(ol => (
                      <div key={ol.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "start" }}>
                          <div style={{ width: 176 }}>
                            <div style={fieldLabel}>Liik</div>
                            <select value={ol.liik} onChange={(e) => updateOlemasolevaLaen(ol.id, { liik: e.target.value })} style={{ ...selectStyle, width: "100%" }}>
                              {LAENU_LIIGID.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                          </div>
                          <div style={{ width: 128 }}>
                            <div style={fieldLabel}>Esialgne summa</div>
                            <EuroInput value={ol.algSumma} onChange={(v) => updateOlemasolevaLaen(ol.id, { algSumma: v })} style={numStyle} />
                          </div>
                          <div style={{ width: 128 }}>
                            <div style={fieldLabel}>Laenujääk</div>
                            <EuroInput value={ol.jaak} onChange={(v) => updateOlemasolevaLaen(ol.id, { jaak: v })} style={numStyle} />
                          </div>
                          <div style={{ width: 96 }}>
                            <div style={fieldLabel}>Intress %</div>
                            <NumberInput value={ol.intress} onChange={(v) => updateOlemasolevaLaen(ol.id, { intress: v })} style={numStyle} />
                          </div>
                          {(() => {
                            const kpDdStyle = { ...selectStyle, minWidth: 52, appearance: "auto" };
                            const kpYears = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035];
                            const kpMonths = Array.from({ length: 12 }, (_, i) => i + 1);
                            const kpDays = (m, y) => (m && y) ? new Date(y, m, 0).getDate() : 31;
                            const algKp = ol.algusKuupaev || {};
                            const lopKp = ol.loppKuupaev || {};
                            return (<>
                              <div>
                                <div style={fieldLabel}>Algus</div>
                                <div style={{ display: "flex", gap: 4 }}>
                                  <select value={algKp.d || ""} onChange={(e) => updateOlemasolevaLaen(ol.id, { algusKuupaev: { ...algKp, d: Number(e.target.value) || "" } })} style={kpDdStyle}>
                                    <option value="">PP</option>
                                    {Array.from({ length: kpDays(algKp.m, algKp.y) }, (_, i) => i + 1).map(d => <option key={d} value={d}>{String(d).padStart(2, "0")}</option>)}
                                  </select>
                                  <select value={algKp.m || ""} onChange={(e) => updateOlemasolevaLaen(ol.id, { algusKuupaev: { ...algKp, m: Number(e.target.value) || "" } })} style={kpDdStyle}>
                                    <option value="">KK</option>
                                    {kpMonths.map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
                                  </select>
                                  <select value={algKp.y || ""} onChange={(e) => updateOlemasolevaLaen(ol.id, { algusKuupaev: { ...algKp, y: Number(e.target.value) || "" } })} style={{ ...kpDdStyle, minWidth: 70 }}>
                                    <option value="">AAAA</option>
                                    {kpYears.map(y => <option key={y} value={y}>{y}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div>
                                <div style={fieldLabel}>Lõpp</div>
                                <div style={{ display: "flex", gap: 4 }}>
                                  <select value={lopKp.d || ""} onChange={(e) => updateOlemasolevaLaen(ol.id, { loppKuupaev: { ...lopKp, d: Number(e.target.value) || "" } })} style={kpDdStyle}>
                                    <option value="">PP</option>
                                    {Array.from({ length: kpDays(lopKp.m, lopKp.y) }, (_, i) => i + 1).map(d => <option key={d} value={d}>{String(d).padStart(2, "0")}</option>)}
                                  </select>
                                  <select value={lopKp.m || ""} onChange={(e) => updateOlemasolevaLaen(ol.id, { loppKuupaev: { ...lopKp, m: Number(e.target.value) || "" } })} style={kpDdStyle}>
                                    <option value="">KK</option>
                                    {kpMonths.map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
                                  </select>
                                  <select value={lopKp.y || ""} onChange={(e) => updateOlemasolevaLaen(ol.id, { loppKuupaev: { ...lopKp, y: Number(e.target.value) || "" } })} style={{ ...kpDdStyle, minWidth: 70 }}>
                                    <option value="">AAAA</option>
                                    {kpYears.map(y => <option key={y} value={y}>{y}</option>)}
                                  </select>
                                </div>
                              </div>
                            </>);
                          })()}
                          <div style={{ width: 128 }}>
                            <div style={fieldLabel}>Kuumakse</div>
                            <EuroInput value={ol.kuumakse} onChange={(v) => updateOlemasolevaLaen(ol.id, { kuumakse: v })} style={numStyle} />
                          </div>
                          <div style={{ marginTop: 20 }}>
                            <button style={btnRemove} onClick={() => removeOlemasolevaLaen(ol.id)}>Eemalda</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {olemasolevaLaenud.length > 0 && (
                    <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 13, color: N.sub }}>
                      Olemasolevad kuumaksed kokku: {euro(olemasolevaLaenud.reduce((s, l) => s + (parseFloat(l.kuumakse) || 0), 0))}/kuu
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <button style={{ ...btnAdd, fontSize: 13 }} onClick={addOlemasolevaLaen}>+ Lisa olemasolev laen</button>
                  </div>
                </div>
              )}

              {/* ── Planeeritud laenud (investeeringutest + käsitsi) ── */}
              <div style={{ fontWeight: 600, fontSize: 14, color: N.sub, marginBottom: 8 }}>Planeeritud laenud</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {plan.loans.map(ln => {
                  const d = derived.loans.items.find(x => x.id === ln.id);
                  return (
                    <div key={ln.id} id={`laen-${ln.id}`} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                      {ln.sepiiriostudInvId && (
                        <div style={{ fontSize: 12, color: "#6366f1", marginBottom: 4 }}>(seotud investeeringuga)</div>
                      )}
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ width: 180 }}>
                          <div style={fieldLabel}>Liik</div>
                          <select value={ln.liik || "Remondilaen"} onChange={(e) => updateLoan(ln.id, { liik: e.target.value })} style={{ ...selectStyle, width: "100%" }}>
                            {LAENU_LIIGID.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
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
                        <div style={{ width: 160 }}>
                          <div style={fieldLabel}>Algus</div>
                          {(() => {
                            const lnKv = ln.algusKvartal || "I";
                            const lnAasta = ln.algusAasta || String(plan.period.year || new Date().getFullYear());
                            return (
                              <div style={{ display: "flex", gap: 4 }}>
                                <select value={lnKv} onChange={(e) => updateLoan(ln.id, { algusKvartal: e.target.value })} style={{ ...selectStyle, width: 55 }}>
                                  {["I", "II", "III", "IV"].map(k => <option key={k} value={k}>{k}</option>)}
                                </select>
                                <select value={lnAasta} onChange={(e) => updateLoan(ln.id, { algusAasta: e.target.value })} style={{ ...selectStyle, flex: 1 }}>
                                  {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + i).map(a => <option key={a} value={String(a)}>{a}</option>)}
                                </select>
                              </div>
                            );
                          })()}
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
                          Teenindus perioodis: {euro(d.servicingPeriodEUR)} · kuumakse: {euro(d.servicingMonthlyEUR)} · laenureserv: {euro(d.reservePeriodEUR)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 12, fontFamily: "monospace" }}>
                Laenuteenindus kokku: {euro(derived.loans.servicePeriodEUR)} · laenureserv kokku: {euro(derived.loans.reservePeriodEUR)}
              </div>
              <div style={{ marginTop: 8 }}>
                <button style={btnAdd} onClick={addLoan}>+ Lisa planeeritud laen</button>
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

            {/* ── Koondvaade ── */}
            <div style={{ ...card, padding: 24 }}>
              <div style={{ ...sectionTitle, marginBottom: 16 }}>Koondvaade</div>
              {(() => {
                const kvRow = { display: "flex", justifyContent: "space-between", fontSize: 14, color: N.sub, padding: "4px 0" };
                const kvBold = { display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600, color: N.text, padding: "6px 0", borderTop: `1px solid ${N.border}`, marginTop: 4 };
                const kvHr = { display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, padding: "8px 0", borderTop: `2px solid ${N.border}`, marginTop: 8 };
                return (
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={kvRow}><span>Kommunaalkulud</span><span style={{ fontFamily: "monospace" }}>{euro(kopiiriondvaade.kommunaalKokku)}/kuu</span></div>
                    <div style={kvRow}><span>Halduskulud</span><span style={{ fontFamily: "monospace" }}>{euro(kopiiriondvaade.haldusKokku)}/kuu</span></div>
                    <div style={kvBold}><span>Kulud kokku</span><span style={{ fontFamily: "monospace" }}>{euro(kopiiriondvaade.kuludKokku)}/kuu</span></div>

                    {kopiiriondvaade.laenumaksedKokku > 0 && (
                      <div style={kvRow}><span>Laenumaksed</span><span style={{ fontFamily: "monospace" }}>{euro(kopiiriondvaade.laenumaksedKokku)}/kuu</span></div>
                    )}

                    <div style={{ ...kvBold, borderTopColor: N.text }}><span>Väljaminekud kokku</span><span style={{ fontFamily: "monospace" }}>{euro(kopiiriondvaade.valjaminekudKokku)}/kuu</span></div>

                    <div style={{ ...kvBold, marginTop: 12 }}><span>Tulud kokku</span><span style={{ fontFamily: "monospace" }}>{euro(kopiiriondvaade.tuludKokku)}/kuu</span></div>

                    <div style={{ ...kvHr, color: kopiiriondvaade.vahe >= 0 ? "#15803d" : "#dc2626" }}>
                      <span>Vahe</span>
                      <span style={{ fontFamily: "monospace" }}>
                        {kopiiriondvaade.vahe >= 0 ? "+" : ""}{euro(kopiiriondvaade.vahe)}/kuu
                        {kopiiriondvaade.vahe >= 0 ? " \u2713" : " \u26A0"}
                      </span>
                    </div>

                    {kopiiriondvaade.vahe < 0 && (
                      <div style={{ marginTop: 8, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>
                        Tulud ei kata väljaminekuid. Puudujääk {euro(Math.abs(kopiiriondvaade.vahe))}/kuu.
                      </div>
                    )}

                    {/* Aastane kokkuvõte */}
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${N.border}` }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: N.dim, marginBottom: 8 }}>Aastane kokkuvõte</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, textAlign: "center" }}>
                        <div style={{ background: N.surface, borderRadius: 8, padding: 12, border: `1px solid ${N.border}` }}>
                          <div style={{ fontSize: 12, color: N.dim }}>Väljaminekud</div>
                          <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: N.text }}>{euro(kopiiriondvaade.valjaminekudKokku * 12)}/a</div>
                        </div>
                        <div style={{ background: N.surface, borderRadius: 8, padding: 12, border: `1px solid ${N.border}` }}>
                          <div style={{ fontSize: 12, color: N.dim }}>Tulud</div>
                          <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: N.text }}>{euro(kopiiriondvaade.tuludKokku * 12)}/a</div>
                        </div>
                        <div style={{ background: kopiiriondvaade.vahe >= 0 ? "#f0fdf4" : "#fef2f2", borderRadius: 8, padding: 12, border: `1px solid ${kopiiriondvaade.vahe >= 0 ? "#bbf7d0" : "#fecaca"}` }}>
                          <div style={{ fontSize: 12, color: N.dim }}>Vahe</div>
                          <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: kopiiriondvaade.vahe >= 0 ? "#15803d" : "#dc2626" }}>
                            {kopiiriondvaade.vahe >= 0 ? "+" : ""}{euro(kopiiriondvaade.vahe * 12)}/a
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

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
                  <div style={summaryCard}>
                    <div style={summaryNum}>{euro(derived.loans.servicePeriodEUR)}</div>
                    <div style={summaryLabel}>Laenumaksed perioodis</div>
                    <div style={summarySub}>{euro(derived.loans.serviceMonthlyEUR)}/kuu</div>
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
                  <th style={{ padding: "4px 8px" }}>Omanik(ud)</th>
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
                      <td style={{ padding: "4px 8px" }}>{a.omanikud || ""}</td>
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

          {/* Kaasomandi esemed */}
          {seisukord.length > 0 && seisukord.some(r => r.ese) && (
            <div className="print-section">
              <h2 className="print-section-title">Kaasomandi esemed</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: 12, borderBottom: "2px solid #000" }}>
                    <th style={{ padding: "4px 8px" }}>Ese</th>
                    <th style={{ padding: "4px 8px" }}>Seisukord</th>
                    <th style={{ padding: "4px 8px" }}>Prioriteet</th>
                    <th style={{ padding: "4px 8px" }}>Puudused</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Eeldatav kulu</th>
                    <th style={{ padding: "4px 8px" }}>Tegevus</th>
                    <th style={{ padding: "4px 8px" }}>Aeg</th>
                    <th style={{ padding: "4px 8px" }}>Investeering</th>
                  </tr>
                </thead>
                <tbody>
                  {seisukord.filter(r => r.ese).map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px" }}>{s.ese}</td>
                      <td style={{ padding: "4px 8px" }}>{s.seisukordVal || ""}</td>
                      <td style={{ padding: "4px 8px" }}>{s.prioriteet || ""}</td>
                      <td style={{ padding: "4px 8px" }}>{s.puudused || ""}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{s.eeldatavKulu ? euroEE(s.eeldatavKulu) : ""}</td>
                      <td style={{ padding: "4px 8px" }}>{s.tegevus || ""}</td>
                      <td style={{ padding: "4px 8px" }}>{s.tegevusAasta ? `${s.tegevusKvartal ? s.tegevusKvartal + " kv " : ""}${s.tegevusAasta}` : ""}</td>
                      <td style={{ padding: "4px 8px" }}>{s.investeering ? <>{s.invNimetus || "—"} · {euroEE(s.invMaksumus)}{(s.rahpiiri || []).length > 0 && <> ({s.rahpiiri.map(rp => `${rp.allikas}: ${euroEE(rp.summa)}`).join(", ")})</>}</> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Muud investeeringud */}
          {muudInvesteeringud.length > 0 && (
            <div className="print-section">
              <h2 className="print-section-title">Muud investeeringud</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: 12, borderBottom: "2px solid #000" }}>
                    <th style={{ padding: "4px 8px" }}>Nimetus</th>
                    <th style={{ padding: "4px 8px" }}>Aasta</th>
                    <th style={{ padding: "4px 8px" }}>Kvartal</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Maksumus</th>
                    <th style={{ padding: "4px 8px" }}>Rahastusplaan</th>
                  </tr>
                </thead>
                <tbody>
                  {muudInvesteeringud.map(inv => (
                    <tr key={inv.id} style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px" }}>{inv.nimetus || "—"}</td>
                      <td style={{ padding: "4px 8px" }}>{inv.aasta || ""}</td>
                      <td style={{ padding: "4px 8px" }}>{inv.kvartal || ""}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(inv.maksumus)}</td>
                      <td style={{ padding: "4px 8px" }}>{(inv.rahpiiri || []).map(rp => `${rp.allikas}: ${euroEE(rp.summa)}`).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Kulud */}
          <div className="print-section">
            <h2 className="print-section-title">Kulud</h2>
            {plan.budget.costRows.length === 0
              ? <div>Kulusid pole lisatud.</div>
              : plan.budget.costRows.map(r => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                  <span>{r.category ? <span style={{ color: "#666" }}>{r.category} · </span> : ""}{r.name || "—"}</span>
                  <span style={{ fontFamily: "monospace" }}>
                    {euroEE(r.calc.params.amountEUR)}
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
                  <span>{r.category ? <span style={{ color: "#666" }}>{r.category} · </span> : ""}{r.name || "—"}</span>
                  <span style={{ fontFamily: "monospace" }}>
                    {euroEE(r.calc.params.amountEUR)}
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
                    <th style={{ padding: "4px 8px" }}>Liik</th>
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
                        <td style={{ padding: "4px 8px" }}>{ln.liik || "Remondilaen"}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(ln.principalEUR)}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{String(ln.annualRatePct).replace(".", ",")}%</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{ln.termMonths} kuud</td>
                        <td style={{ padding: "4px 8px" }}>{ln.algusKvartal || "I"} kv {ln.algusAasta || ""}</td>
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