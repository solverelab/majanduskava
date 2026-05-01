// src/App.jsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultPlan, mkApartment, mkCashflowRow, mkInvestmentItem, mkLoan, mkRfUsageItem, getEffectiveAllocationBasis, patchAllocationPolicy, deriveLegalBasisType, todayYmd } from "./domain/planSchema";
import { describeAllocationPolicy, summarizeAllocationPolicy } from "./domain/allocationBasisDisplay";
import { syncLoan } from "./utils/syncLoan";
import { normalizeInvestmentsField, cleanAssetConditionInvestmentFields } from "./utils/importNormalize";
import { cleanupOrphanLinkedLoans } from "./utils/planCleanup";
import { syncRepairFundRate, syncRepairFundOpeningBalance, fillMissingYearsFromPeriod } from "./utils/planSync";
import { computePlan, euro } from "./engine/computePlan";
import { runPlan, applyActionAndRun, applyOnly, setPreset as setHostPreset, runAutoResolve, SOLVERE_CORE_CONTRACT_VERSION } from "./solvereBridge/majanduskavaHost";
import { buildStateSignature } from "../packages/solvere-core/src/moduleHost.ts";
import { TracePanel } from "./components/TracePanel";
import { AddressSearch } from "./components/AddressSearch";
import {
  arvutaKuumakse, arvutaKuumakseExact,
  computeKopiiriondvaade, computeReserveMin, computeRemondifondiArvutus,
  investmentStatus, kulureaOsa, jaotusalusSilt, getEffectiveRowAllocationBasis,
  UTILITY_TYPE_BY_CATEGORY, utilityTypeForRow, utilityRowStatus,
  KOMMUNAALTEENUSED, HALDUSTEENUSED, LAENUMAKSED,
  seedDefaultKommunaalRows, makeKommunaalRow, KOMMUNAAL_DEFAULT_CATEGORIES,
  normalizeIncomeAllocations,
} from "./utils/majanduskavaCalc";
import { sortInvestmentsCanonical } from "./utils/sortInvestments";
import { isInvestmentCounted } from "./utils/investmentInclusion";
import { parseNumericInput } from "./utils/parseNumericInput";
import { autoNormalizeText, normalizeIfChanged } from "./utils/grammarCheck";
import { normalizeCostAllocation, displayCostAllocationBasis, displayLegalBasis } from "./utils/allocationModel";

// ── Euro formatting (Estonian: 1 235 €, täisarvuna) ──
function euroEE(n) {
  const rounded = Math.round(Number(n) || 0);
  const abs = Math.abs(rounded);
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (rounded < 0 ? "−" : "") + grouped + " €";
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



// p3 jaotusaluse silt — lõppvaate p3 tarbeks, ei muuda arvutusi ega muud UI-d.
// p3 lõppvaate jaoks arusaadavam m²-põhise jaotuse silt
const p3AlusSilt = (basis) =>
  (basis === "m2") ? "Kaasomandi osa suuruse alusel" : jaotusalusSilt(basis);

// ════════════════════════════════════════════════════════════════════════
// Design tokens — single source of truth for the entire UI
// ════════════════════════════════════════════════════════════════════════

// ── NEUTRAL PALETTE ──
const N = {
  bg:      "#f7f7f7",
  surface: "#ffffff",
  muted:   "#f5f6f7",
  border:  "#e5e5e5",
  rule:    "#eeeeee",
  text:    "#222222",
  sub:     "#666666",
  dim:     "#666666",
  accent:  "#333333",
  sidebar: "#2c2c2c",
};


// -- TYPOGRAPHY (4 taset, mitte rohkem) --
const H1_STYLE = { fontSize: 20, fontWeight: 600, color: N.text, margin: 0, marginBottom: 24 };
const H2_STYLE = { fontSize: 16, fontWeight: 600, color: N.text, margin: 0, marginTop: 84, marginBottom: 16 };
const H3_STYLE = { fontSize: 14, fontWeight: 600, color: N.text, margin: 0, marginBottom: 8 };
// Body: fontSize 14, fontWeight 400, lineHeight 1.5 (rakendatakse main div-il)

const sectionTitle = H2_STYLE;  // tagasiühilduvus
const fieldLabel   = { fontSize: 14, fontWeight: 400, color: N.sub, marginBottom: 8 };
const helperText   = { fontSize: 14, fontWeight: 400, color: N.sub };

// ── INPUTS ──
const inputBase  = { height: 38, padding: "0 12px", border: "1px solid #dcdcdc", borderRadius: 6, fontSize: 14, background: N.surface, color: N.text, outline: "none", boxSizing: "border-box" };
const inputStyle = { ...inputBase, width: "100%" };
const numStyle   = { ...inputStyle, fontFamily: "monospace", textAlign: "right" };
const selectStyle = { ...inputBase, padding: "0 10px", appearance: "auto" };
const numFocus   = (e) => e.target.select();

// ── Universal number input with Estonian comma-decimal support ──
function NumberInput({ value, onChange, ...props }) {
  const [display, setDisplay] = useState(value === 0 || value === "" || value == null ? "" : String(value).replace(".", ","));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDisplay(value === 0 || value === "" || value == null ? "" : String(value).replace(".", ","));
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
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onBlur={() => {
        setEditing(false);
        const cleaned = parseNumericInput(display);
        if (cleaned !== "") {
          const parsed = parseFloat(cleaned);
          if (!isNaN(parsed)) { onChange(parsed); return; }
        }
        // tühi või vigane — säilita eelmine väärtus, taasta display
        setDisplay(value === 0 || value === "" || value == null ? "" : String(value).replace(".", ","));
      }}
      {...props}
    />
  );
}

// ── Auto-grow textarea — adjusts height to content on mount and value change ──
function AutoGrowTextarea({ value, onChange, onBlur, placeholder, style }) {
  const ref = useRef(null);
  const adjust = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);
  useEffect(() => { adjust(); }, [value, adjust]);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onBlur={onBlur}
      onChange={(e) => { adjust(); onChange(e); }}
      style={{ ...style, resize: "none", overflow: "hidden" }}
    />
  );
}

// ── Confirm modal — replaces window.confirm with an Estonian-language dialog ──
function ConfirmModal({ message, confirmLabel = "Kinnita", cancelLabel = "Loobu", onConfirm, onCancel }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ background: "#fff", borderRadius: 10, padding: "28px 32px", maxWidth: 420, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <div style={{ fontSize: 15, color: "#2c2825", marginBottom: 24, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: 6, border: "1px solid #e0ddd8", background: "#f7f6f4", fontSize: 14, cursor: "pointer", color: "#5c554d" }}>{cancelLabel}</button>
          <button onClick={onConfirm} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#dc2626", fontSize: 14, cursor: "pointer", color: "#fff", fontWeight: 500 }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
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
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
      onFocus={(e) => {
        setEditing(true);
        const rounded = Math.round(value) || 0;
        setDisplay(rounded ? String(rounded) : "");
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => {
        setEditing(false);
        const cleaned = parseNumericInput(display);
        if (cleaned !== "") {
          const parsed = parseFloat(cleaned);
          if (!isNaN(parsed)) {
            const rounded = Math.round(parsed);
            onChange(rounded);
            setDisplay(fmtEur(rounded));
            return;
          }
        }
        // tühi või vigane — säilita eelmine väärtus, taasta display
        setDisplay(fmtEur(value));
      }}
      {...props}
    />
  );
}

function DateInput({ value, onChange, ...props }) {
  const isoToEE = (iso) => {
    if (!iso || typeof iso !== "string") return "";
    const p = iso.split("-");
    if (p.length !== 3) return iso;
    return p[2] + "." + p[1] + "." + p[0];
  };
  const eeToISO = (ee) => {
    if (!ee) return "";
    const digits = ee.replace(/\D/g, "");
    if (digits.length < 8) return "";
    const d = digits.slice(0, 2);
    const m = digits.slice(2, 4);
    const y = digits.slice(4, 8);
    if (!y || !m || !d || isNaN(Date.parse(y + "-" + m + "-" + d))) return "";
    return y + "-" + m + "-" + d;
  };

  const [display, setDisplay] = useState(isoToEE(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDisplay(isoToEE(value));
  }, [value, editing]);

  const handleChange = (e) => {
    const raw = e.target.value;
    const cleaned = raw.replace(/[^\d.]/g, "");
    const digits = cleaned.replace(/\./g, "");
    const limited = digits.slice(0, 8);

    let masked = "";
    for (let i = 0; i < limited.length; i++) {
      if (i === 2 || i === 4) masked += ".";
      masked += limited[i];
    }
    setDisplay(masked);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="PP.KK.AAAA"
      value={display}
      onChange={handleChange}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onBlur={() => {
        setEditing(false);
        const iso = eeToISO(display.trim());
        if (iso) {
          onChange(iso);
        } else if (display.trim() === "") {
          onChange("");
        }
        setDisplay(isoToEE(iso || value));
      }}
      {...props}
    />
  );
}

// ── BUTTONS ──
const _btnBase    = { height: 38, borderRadius: 6, cursor: "pointer", fontSize: 14, border: "none", padding: "0 16px", lineHeight: "38px" };
const btnPrimary  = { ..._btnBase, background: "#333", color: "#fff", fontWeight: 600 };
const btnSecondary = { ..._btnBase, background: N.surface, color: N.text, fontWeight: 500, border: `1px solid ${N.border}` };
const btnAdd      = btnSecondary;  // sama mis secondary
const btnRemove   = { background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#c53030", padding: "4px 8px" };
const btn         = btnSecondary;

// KOMMUNAALTEENUSED, HALDUSTEENUSED, LAENUMAKSED — imported from utils/majanduskavaCalc

const KULU_KATEGOORIAD = [...KOMMUNAALTEENUSED, ...HALDUSTEENUSED, ...LAENUMAKSED];

const TULU_KATEGOORIAD = ["Renditulu", "Muu tulu"];
const TULU_KATEGORIAD_TAB2 = ["Toetus", "Kindlustushüvitis", "Üüritulu", "Reklaamitulu", "Muu tulu"];

const TULU_KATEGOORIA_MAP = {
  "Haldus": "Haldustasu",
  "Raamatupidamine": "Haldustasu",
  "Koristus": "Haldustasu",
  "Kindlustus": "Haldustasu",
  "Hooldus": "Haldustasu",
  "Kommunaalmaksed": "Haldustasu",
  "Muu haldusteenus": "Muu tulu",
};

const KOMMUNAAL_UHIKUD = {
  "Kütus": ["m³", "l", "t"],
  "Soojus": ["MWh", "kWh"],
  "Vesi ja kanalisatsioon": ["m³"],
  "Elekter": ["kWh", "MWh"],
};

const KOMMUNAAL_VAIKE_UHIK = {
  "Kütus": "m³",
  "Soojus": "MWh",
  "Vesi ja kanalisatsioon": "m³",
  "Elekter": "kWh",
};

const P5_KOMMUNAALTEENUSED = ["Soojus", "Vesi ja kanalisatsioon", "Elekter", "Kütus"];

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
  "Laenumakse": "nt Remondilaen, investeerimislaen",
  "Muu haldusteenus": "Kirjelda kulu",
  "Muu kommunaalteenus": "Kirjelda kulu",
};

const TULU_NIMETUS_PLACEHOLDERS = {
  "Renditulu": "nt Ruumide või parkimiskohtade rent",
  "Muu tulu": "nt Reklaamitulu, laekumised, toetused",
};

const TEGEVUS_PLACEHOLDERS = {
  "Katus":           "nt parandamine, katusekatte vahetus",
  "Fassaad":         "nt parandamine, värvimine",
  "Aknad":           "nt tihendite vahetus, akende vahetus",
  "Trepp/trepikoda": "nt remont, valgustuse uuendamine",
  "Torustik (vesi)": "nt remont, renoveerimine",
  "Kanalisatsioon":  "nt puhastus, torustiku uuendamine",
  "Küttesüsteem":    "nt tasakaalustamine, remont",
  "Elektrisüsteem":  "nt kontroll, uuendamine",
  "Ventilatsioon":   "nt puhastus, parandamine",
  "Kelder":          "nt kuivendamine, hüdroisolatsioon",
  "Lift":            "nt remont, moderniseerimine",
  "Õueala":          "nt kõnnitee remont, valgustuse uuendamine",
  "Parkla":          "nt asfalteerimine, märgistuse uuendamine",
};

const PUUDUSED_PLACEHOLDERS = {
  "Katus":           "nt lekked, läbiviikude kahjustused",
  "Fassaad":         "nt praod, krohvikahjustused",
  "Aknad":           "nt udune klaaspakett, katkised tihendid",
  "Trepp/trepikoda": "nt kulunud pinnad, valgustuse puudused",
  "Torustik (vesi)": "nt lekked, rooste, surveprobleemid",
  "Kanalisatsioon":  "nt ummistused, lõhnaprobleemid",
  "Küttesüsteem":    "nt ebaühtlane soojus, rikked",
  "Elektrisüsteem":  "nt vananenud juhtmestik, rikked",
  "Ventilatsioon":   "nt puudulik õhuvahetus, ummistused",
  "Kelder":          "nt niiskus, hallitus",
  "Lift":            "nt sagedased rikked, ei vasta nõuetele",
  "Õueala":          "nt lagunev kõnnitee, puuduv valgustus",
  "Parkla":          "nt pragud asfaldis, puuduv märgistus",
};

// ── LAYOUT ──
const card     = { border: "1px solid #eee", borderRadius: 8, padding: "20px 24px", background: N.surface, marginBottom: 24 };
const tabStack = { display: "flex", flexDirection: "column", gap: 24 };
const tableWrap = { overflowX: "auto" };

const thRow = { fontSize: 14, fontWeight: 600, color: N.text, background: N.muted, borderBottom: "1px solid #eee" };
const tdSep = { borderBottom: "1px solid #eee" };

function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 4 }}>
      <span
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 15, height: 15, borderRadius: "50%",
          border: `1px solid ${N.dim}`,
          fontSize: 10, color: N.dim, cursor: "help",
          fontStyle: "italic", fontWeight: 700, lineHeight: 1,
          userSelect: "none", flexShrink: 0,
        }}
      >i</span>
      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)",
          background: "#1e293b", color: "#f1f5f9",
          padding: "8px 12px", borderRadius: 6, fontSize: 12,
          lineHeight: 1.5, width: 270, zIndex: 200,
          boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
          whiteSpace: "normal", pointerEvents: "none",
        }}>
          {text}
        </div>
      )}
    </span>
  );
}

function Issue({ it }) {
  return (
    <div style={{ background: N.muted, border: `1px solid ${N.border}`, padding: "8px 16px", borderRadius: 8, marginBottom: 8 }}>
      <b>{it.severity}</b> - {it.message}
      <div style={{ fontSize: 14, color: N.sub, marginTop: 8 }}>{it.code} - {it.section}</div>
    </div>
  );
}

function Section({ title, items, onApplyAction, showTechnicalInfo }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ ...sectionTitle, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {items.map(finding => (
          <div
            key={finding.id}
            style={card}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: N.text }}>
              {finding.title}
            </div>
            {finding.message && (
              <div style={{ ...helperText, marginTop: 8 }}>
                {finding.message}
              </div>
            )}
            {finding.actions?.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
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
                        <span style={{ fontSize: 14, color: N.sub }}>
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
  const [plan, setPlan] = useState(() => seedDefaultKommunaalRows(defaultPlan()));
  const [preset, setPreset] = useState("BALANCED");
  const [kyData, setKyData] = useState({ nimi: "", registrikood: "", aadress: "", kyAadress: "", kyAadressEdited: false, ehrKood: "", ehitusaasta: "", suletudNetopind: "", koetavPind: "", korteriteArv: "", korrusteArv: "", ehrPind: null, ehrArv: null });
  const seisukord = plan.assetCondition?.items || [];
  // muudInvesteeringud → eemaldatud; kõik investeeringud elavad plan.investments.items
  const [tab1InfoOpen, setTab1InfoOpen] = useState(false);
  const [kuluInfoOpen, setKuluInfoOpen] = useState(null);
  const [aastaInfoOpen, setAastaInfoOpen] = useState(null);
  const [tab0PindalaInfoOpen, setTab0PindalaInfoOpen] = useState(false);
  const [tab0PerioodInfoOpen, setTab0PerioodInfoOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // { message, confirmLabel, cancelLabel?, onConfirm, onCancel? }
  const [repairFundSaldo, setRepairFundSaldo] = useState(""); // tagasiühilduvus
  const [remondifond, setRemondifond] = useState({
    saldoAlgus: "",
    kogumisViis: "eraldi",      // "eraldi" | "uhine"
    pangaKoefitsient: 1.15,     // vaikimisi 1.15
    pangaMaarOverride: null,    // null = auto, number = käsitsi €/m²/a
    maarOverride: null,         // null = auto (investeeringutest), number = käsitsi €/m²/kuu
    maarKorterKuu: null,        // €/korter/kuu (apartment jaotuse puhul)
    planeeritudKogumine: "",    // kogumine perioodis (apartment ja muu jaotuse puhul)
    soovitudSaldoLopp: "",      // soovitud minimaalne lõppsaldo
    fondiMuuTulu: "",           // fondi suunatud muu tulu perioodis
  });
  const [resKapManual, setResKapManual] = useState(false);
  const [resKap, setResKap] = useState({
    saldoAlgus: "",
    kasutamine: "",
    pohjendus: "",
    usesReserveDuringPeriod: false,
  });
  const [isSihttaseOpen, setIsSihttaseOpen] = useState(false);
  const [loanStatus, setLoanStatus] = useState("APPLIED"); // "APPLIED" | "APPROVED"
  const [openCostExplanationId, setOpenCostExplanationId] = useState(null);
  const [openTab2TaepsustusId, setOpenTab2TaepsustusId] = useState(null);
  const [openRfMarkusId, setOpenRfMarkusId] = useState(null);


  const derived = useMemo(() => computePlan(plan, { loanStatus }), [plan, loanStatus]);

  const reserveMin = useMemo(() =>
    computeReserveMin(plan.budget.costRows, derived.period.monthEq),
  [plan.budget.costRows, derived.period.monthEq]);

  // Auto-täida reserv miinimumiga ainult siis, kui kasutaja pole midagi sisestanud (null/undefined/0).
  useEffect(() => {
    if (resKapManual) return;
    const min = reserveMin.noutavMiinimum;
    setPlan(p => ({ ...p, funds: { ...p.funds, reserve: { ...p.funds.reserve, plannedEUR: min } } }));
  }, [reserveMin.noutavMiinimum, resKapManual]);

  const kopiiriondvaade = useMemo(() =>
    computeKopiiriondvaade(plan.budget.costRows, plan.budget.incomeRows, plan.loans, derived.period.monthEq, loanStatus),
  [plan.budget.costRows, plan.budget.incomeRows, plan.loans, derived.period.monthEq, loanStatus]);

  const fondiMuuTuluFromTab2 = useMemo(() => {
    const incomeRows = plan.budget.incomeRows;
    return incomeRows.reduce((sum, r) => {
      const norm = normalizeIncomeAllocations(r);
      return sum + norm.allocations
        .filter(a => a.target === "repairFund")
        .reduce((s, a) => s + Math.max(0, Math.round(parseFloat(a.amount) || 0)), 0);
    }, 0);
  }, [plan.budget.incomeRows]);

  const remondifondiArvutus = useMemo(() => {
    const rfBasis = plan.allocationPolicies?.remondifond?.defaultBasis;
    const rfSelectVal = rfBasis === "apartment" ? "apartment" : rfBasis === "muu" ? "muu" : "kaasomand";
    const aptCount = plan.building.apartments.length;
    const mEq = derived.period.monthEq || 12;
    let planeeritudKogumine = null;
    if (rfSelectVal === "apartment") {
      const maarKorterKuu = remondifond.maarKorterKuu != null ? parseFloat(String(remondifond.maarKorterKuu).replace(",", ".")) || 0 : null;
      if (maarKorterKuu != null) planeeritudKogumine = Math.round(maarKorterKuu * aptCount * mEq);
    } else if (rfSelectVal === "muu") {
      planeeritudKogumine = remondifond.planeeritudKogumine !== "" ? parseFloat(String(remondifond.planeeritudKogumine).replace(",", ".")) || 0 : null;
    }
    return computeRemondifondiArvutus({
      saldoAlgusRaw: remondifond.saldoAlgus,
      koguPind: derived.building.totAreaM2,
      periodiAasta: plan.period.year || new Date().getFullYear(),
      pangaKoef: remondifond.pangaKoefitsient || 1.15,
      kogumisViis: remondifond.kogumisViis,
      pangaMaarOverride: remondifond.pangaMaarOverride,
      maarOverride: remondifond.maarOverride,
      investments: plan.investments.items,
      loans: plan.loans,
      loanStatus,
      monthEq: mEq,
      costRows: plan.budget.costRows,
      rfUsageItems: plan.funds.repairFund.usageItems || [],
      planeeritudKogumine,
      fondiMuuTulu: fondiMuuTuluFromTab2,
    });
  },
  [
    remondifond.saldoAlgus, remondifond.kogumisViis,
    remondifond.pangaKoefitsient, remondifond.pangaMaarOverride,
    remondifond.maarOverride, remondifond.maarKorterKuu,
    remondifond.planeeritudKogumine, fondiMuuTuluFromTab2,
    derived.building.totAreaM2, derived.period.monthEq, plan.period.year,
    plan.loans, plan.investments.items, loanStatus, plan.budget.costRows,
    plan.funds.repairFund.usageItems,
    plan.allocationPolicies?.remondifond?.defaultBasis,
    plan.building.apartments.length,
  ]);

  const korteriteKuumaksed = useMemo(() => {
    const apts = plan.building.apartments;
    const koguPind = derived.building.totAreaM2;
    const aptCount = apts.length;
    const ra = remondifondiArvutus;
    const mEq = derived.period.monthEq || 12;

    const rfKuuKokku = ra.maarAastasM2 * koguPind / 12;
    // Baasstsenaariumi kuumaksed: olemasolevad laenud alati, planeeritud ainult kui APPROVED
    const laenKuuKokku = ra.olemasolevLaenumaksedKuus + (ra.loanApproved ? ra.planeeritudLaenumaksedKuus : 0);
    const reservKuuKokku = (plan.funds.reserve.plannedEUR || 0) / 12;

    // Kuluread kuupõhiselt, jaotusalusega. Maintenance-tundlikel ridadel
    // tuleb alus ühest tõest: plan.allocationPolicies.maintenance.
    const maintenanceBasis = getEffectiveAllocationBasis(plan.allocationPolicies?.maintenance);
    const kulureadKuus = plan.budget.costRows.map(r => {
      const v = Math.max(0, parseFloat(r.summaInput) || 0);
      const kuus = KOMMUNAALTEENUSED.includes(r.category)
        ? v / mEq
        : r.arvutus === "aastas" ? v / 12
        : r.arvutus === "perioodis" ? v / mEq
        : v;
      const jaotusalus = HALDUSTEENUSED.includes(r.category)
        ? maintenanceBasis
        : getEffectiveRowAllocationBasis(r);
      // KrtS § 40 lg 2 ls 2: kui kommunaalrida on settledPostHoc, ei lisata seda ettemaksetesse.
      return { category: r.category, kuus, jaotusalus, settledPostHoc: r.settledPostHoc === true };
    });

    return apts.map(k => {
      const pind = parseFloat(k.areaM2) || 0;

      // Jaota iga kulurida vastavalt selle jaotusalusele
      let kommunaal = 0;
      let haldus = 0;
      for (const kr of kulureadKuus) {
        const osa = kulureaOsa(kr.jaotusalus, pind, koguPind, aptCount);
        if (KOMMUNAALTEENUSED.includes(kr.category)) {
          if (!kr.settledPostHoc) kommunaal += kr.kuus * osa;
        } else if (HALDUSTEENUSED.includes(kr.category)) {
          haldus += kr.kuus * osa;
        }
      }
      kommunaal = Math.round(kommunaal);
      haldus = Math.round(haldus);

      const osaM2 = koguPind > 0 ? pind / koguPind : 0;
      const rf = Math.round(rfKuuKokku * osaM2);
      const laen = Math.round(laenKuuKokku * osaM2);
      const reserv = Math.round(reservKuuKokku * osaM2);
      const kokku = kommunaal + haldus + rf + laen + reserv;

      const laenTingimuslik = Math.round((ra.loanApproved ? 0 : ra.planeeritudLaenumaksedKuus) * osaM2);
      const rfLoan = Math.round((ra.loanScenario.maarAastasM2 * koguPind / 12) * osaM2);
      const kokkuLoan = kommunaal + haldus + rfLoan + Math.round((ra.olemasolevLaenumaksedKuus + ra.planeeritudLaenumaksedKuus) * osaM2) + reserv;

      return { id: k.id, tahis: k.label, pind, osa: osaM2, kommunaal, haldus, remondifond: rf, laenumakse: laen, reserv, kokku, laenTingimuslik, kokkuLoan };
    });
  }, [plan.building.apartments, derived.building.totAreaM2, derived.period.monthEq, remondifondiArvutus, kopiiriondvaade, plan.budget.costRows, plan.funds.reserve.plannedEUR, plan.allocationPolicies, loanStatus]);

  // Legacy/import kaitse: puhasta katkised investeeringuga seotud laenud,
  // mida võib tulla sisse vanast failist või mittetäielikust migratsioonist.
  // Tavaline UI töövoog (eemaldaSeisukordRida, eemaldaInvesteering jne)
  // puhastab sidemed ise — see efekt on ainult viimane turvavõrk.
  useEffect(() => {
    setPlan(p => cleanupOrphanLinkedLoans(p));
  }, [plan.investments.items, plan.loans]);

  // Sünkrooni arvutatud remondifondi määr engine'iga
  useEffect(() => {
    setPlan(p => syncRepairFundRate(p, remondifondiArvutus.maarAastasM2));
  }, [remondifondiArvutus.maarAastasM2]);

  // Sünkrooni remondifondi algsaldo engine'iga
  useEffect(() => {
    setPlan(p => syncRepairFundOpeningBalance(p, remondifond.saldoAlgus));
  }, [remondifond.saldoAlgus]);

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
  const [printMode, setPrintMode] = useState(null); // null | "full" | "apartments"
  const isPrinting = printMode !== null;

  const [avaKorterDetail, setAvaKorterDetail] = useState({});
  const [ehrTotalAreaM2, setEhrTotalAreaM2] = useState(null); // EHR pindalade summa, null = pole laetud

  const onPrint = (mode = "full") => {
    setPrintMode(mode);
    // Wait one frame for React to render all sections
    requestAnimationFrame(() => {
      document.body.classList.add("print-mode");
      try {
        window.print();
      } finally {
        document.body.classList.remove("print-mode");
        setPrintMode(null);
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
          ? "Lõpetan: risk ega hoiatused/vead ei paranenud."
          : result.stoppedBecause === "LOOP_GUARD"
          ? "Lõpetan: korduv soovitus."
          : result.stoppedBecause === "MAX_STEPS"
          ? "Lõpetan: max sammud täis."
          : result.stoppedBecause === "NO_CHOICE"
          ? "Lõpetan: sobivat soovitust ei leitud."
          : "Lõpetan: " + result.stoppedBecause;
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

  // Grammatikakontrolli UI-state — AINULT vabatekstiväljade tarbeks.
  // Ei sisalda summasid, kategooriaid, fundingPlani, nimetusi ega jaotusi.
  // Canonical tekst plaani peal jääb puutumata, kuni kasutaja kinnitab ettepaneku.

  // Jaotusaluse erandi diskreetne editor. Renderdab ühe checkbox-toggle'i; avab
  // lisaväljad ainult siis, kui kasutaja aktiveerib. Kasutaja ei peaks juristina
  // mõtlema — valik on "Alus: Põhikiri / Erikokkulepe" + vabatekst-selgitus.
  const renderPolicyException = (key) => {
    const policy = plan.allocationPolicies?.[key] || { defaultBasis: "m2", overrideBasis: null, legalBasis: null, legalBasisNote: "", legalBasisType: "DEFAULT_KRTS40_1", legalBasisText: "" };
    const overrideOn = !!policy.overrideBasis;
    const patch = (p) => setPlan(prev => {
      const next = patchAllocationPolicy(prev, key, p);
      const derived = deriveLegalBasisType(next.allocationPolicies[key]);
      if (next.allocationPolicies[key].legalBasisType === derived) return next;
      return patchAllocationPolicy(next, key, { legalBasisType: derived });
    });
    const onToggle = (e) => {
      // Toggle ON kirjutab AINULT overrideBasis — legalBasis'e ei prefill'ita,
      // et arithmetic ei muutuks enne kasutaja tegelikku kinnitust dropdown'ist.
      if (e.target.checked) patch({ overrideBasis: "korter" });
      else patch({ overrideBasis: null, legalBasis: null, legalBasisNote: "" });
    };
    return (
      <div style={{ marginTop: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: N.sub, cursor: "pointer" }}>
          <input type="checkbox" checked={overrideOn} onChange={onToggle} />
          <span>Kas põhikiri või erikokkulepe näeb ette teise jaotuse?</span>
        </label>
        {overrideOn && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
            <div style={{ width: 180 }}>
              <div style={fieldLabel}>Alus</div>
              <select
                value={policy.legalBasis || "pohikiri"}
                onChange={(e) => patch({ legalBasis: e.target.value })}
                style={{ ...selectStyle, width: "100%" }}
              >
                <option value="pohikiri">Põhikiri</option>
                <option value="erikokkulepe">Erikokkulepe</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={fieldLabel}>Selgitus (valikuline)</div>
              <input
                type="text"
                value={policy.legalBasisNote || ""}
                onChange={(e) => patch({ legalBasisNote: e.target.value })}
                placeholder="Kirjelda lühidalt erandi alust"
                style={{ ...inputStyle }}
              />
            </div>
            <div style={{ fontSize: 12, color: N.dim, width: "100%" }}>
              Erandi info kuvatakse väljundis.
            </div>
          </div>
        )}
      </div>
    );
  };
  const patchRfPolicy = (updates) => setPlan(p => patchAllocationPolicy(p, "remondifond", updates));
  const addRfUsageItem = (item) => setPlan(p => ({
    ...p,
    funds: { ...p.funds, repairFund: { ...p.funds.repairFund, usageItems: [...(p.funds.repairFund.usageItems || []), item] } },
  }));
  const removeRfUsageItem = (id) => setPlan(p => ({
    ...p,
    funds: { ...p.funds, repairFund: { ...p.funds.repairFund, usageItems: (p.funds.repairFund.usageItems || []).filter(it => it.id !== id) } },
  }));
  const clearKommunaalid = () => setPlan(p => seedDefaultKommunaalRows({
    ...p,
    removedDefaultKommunaalCategories: [],
    budget: {
      ...p.budget,
      costRows: p.budget.costRows.filter(r => !KOMMUNAALTEENUSED.includes(r.category)),
    },
  }));

  const onExportJSON = () => {
    const bundle = {
      schemaVersion: "majanduskavaExport/v2",
      moduleId: "majanduskava",
      preset,
      policyVersion: evaluation?.policyVersion ?? "",
      stateSignature: buildStateSignature(plan),
      state: (() => {
        const cleanState = {
          ...plan,
          investments: { items: plan.investments?.items || [] },
        };
        delete cleanState.investmentsPipeline;
        return cleanState;
      })(),  // plan.investments.items on kanoniline investeeringute allikas
      kyData,
      // muudInvesteeringud eemaldatud v2-s — investeeringud on plan.investments.items sees
      repairFundSaldo,
      remondifond,
      resKap,
      loanStatus,
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
        const hasCompositeSchema = data.schemaVersion === "majanduskavaExport/v1" || data.schemaVersion === "majanduskavaExport/v2";
        const hasSplitSchema = data.type === "majanduskavaExport" && data.version === "v1";
        if (!hasCompositeSchema && !hasSplitSchema) {
          setImportError("Toetamata ekspordi versioon. Oodatud: majanduskavaExport/v1 või v2");
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

        const candidateState = data.state;

        // Migrate first, validate after
        if (data.preset) {
          setPreset(data.preset);
          setHostPreset(data.preset);
        }
        // Strip investment quarters from old data
        if (candidateState.investments?.items) {
          candidateState.investments.items = candidateState.investments.items.map(({ quarter: _ignored, ...rest }) => rest);
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
        // Migrate old "Muu" → "Muu haldusteenus"
        if (candidateState.budget?.costRows) {
          candidateState.budget.costRows = candidateState.budget.costRows.map(r =>
            r.category === "Muu" ? { ...r, category: "Muu haldusteenus" } : r
          );
        }
        // Migrate old cost rows — add missing UI fields
        if (candidateState.budget?.costRows) {
          candidateState.budget.costRows = candidateState.budget.costRows.map(r => {
            if (r.arvutus !== undefined || r.kogus !== undefined) return r; // already migrated
            const isKommunaal = KOMMUNAALTEENUSED.includes(r.category);
            return isKommunaal
              ? { kogus: "", uhik: KOMMUNAAL_VAIKE_UHIK[r.category] || "", uhikuHind: "", selgitus: "", ...r }
              : { arvutus: "perioodis", summaInput: r.calc?.params?.amountEUR || 0, selgitus: "", ...r };
          });
        }
        // Migrate cost rows — lisa puuduvad forecast-väljad (backward compatibility)
        if (candidateState.budget?.costRows) {
          candidateState.budget.costRows = candidateState.budget.costRows.map(r => ({
            forecastAdjustmentEnabled: false,
            forecastAdjustmentType: null,
            forecastAdjustmentPercent: null,
            forecastAdjustmentNote: "",
            ...r,
          }));
        }
        // Migrate cost rows — lisa canonical allocation väljad ja translateeri legacy jaotusalus → allocationBasis (backward compatibility, ainus koht, kus legacy jaotusalus't loetakse)
        if (candidateState.budget?.costRows) {
          candidateState.budget.costRows = candidateState.budget.costRows.map(r => ({
            ...r,
            allocationBasis: r.allocationBasis ?? (r.jaotusalus === "korter" ? "apartment" : "m2"),
            legalBasisBylaws: r.legalBasisBylaws ?? false,
            legalBasisSpecialAgreement: r.legalBasisSpecialAgreement ?? false,
            allocationExplanation: r.allocationExplanation ?? "",
            // KrtS § 40 lg 2 ls 2: kommunaalteenused võib tasuda pärast tegeliku kulu selgumist.
            // false = ettemaks (vaikimisi); true = ei arvestata kuumaksesse.
            settledPostHoc: r.settledPostHoc ?? false,
          }));
        }
        // Migrate cost rows — lisa fundingSource, recursNextPeriod, nextPeriodAmount
        if (candidateState.budget?.costRows) {
          candidateState.budget.costRows = candidateState.budget.costRows.map(r => ({
            fundingSource: "eelarve",
            recursNextPeriod: false,
            nextPeriodAmount: null,
            ...r,
          }));
        }
        // Migrate preparedAt — backward-compat: täida tänase kuupäevaga kui puudub
        candidateState.preparedAt = candidateState.preparedAt ?? todayYmd();
        // Migrate allocationPolicies — lisa puuduv legalBasisType / legalBasisText
        if (candidateState.allocationPolicies) {
          for (const key of ["maintenance", "remondifond", "reserve"]) {
            const pol = candidateState.allocationPolicies[key];
            if (!pol) continue;
            if (pol.legalBasisType === undefined || pol.legalBasisText === undefined) {
              candidateState.allocationPolicies[key] = {
                ...pol,
                legalBasisType: pol.legalBasisType ?? deriveLegalBasisType(pol),
                legalBasisText: pol.legalBasisText ?? "",
              };
            }
          }
        }
        // Migrate draftApproval — lisa ohutu vaikeseis, kui fail on vana
        if (!candidateState.draftApproval || typeof candidateState.draftApproval !== "object") {
          candidateState.draftApproval = { isLocked: false, lockedAt: null, stateSignature: null };
        }
        // Migrate materialsPackage — sama mustri järgi, ohutu vaikeseis vanale failile
        if (!candidateState.materialsPackage || typeof candidateState.materialsPackage !== "object") {
          candidateState.materialsPackage = { isCreated: false, createdAt: null, stateSignature: null, items: [] };
        }
        // Migrate writtenVotingPackage — ohutu vaikeseis vanale failile
        if (!candidateState.writtenVotingPackage || typeof candidateState.writtenVotingPackage !== "object") {
          candidateState.writtenVotingPackage = { isCreated: false, createdAt: null, stateSignature: null, deadline: null, agendaItems: [], materialItems: [] };
        }
        // Migrate loan → algusAasta
        if (candidateState.loans) {
          // Eelistatud allikas on imporditava faili periood; fallback aktiivse plaani
          // perioodile ja süsteemiaastale ainult siis, kui failis periood puudub.
          const fallbackY = String(candidateState.period?.year || plan.period.year || new Date().getFullYear());
          candidateState.loans = candidateState.loans.map(ln => {
            const base = { sepiiriostudInvId: ln.sepiiriostudInvId || null };
            if (ln.algusAasta) return { ...ln, ...base, liik: ln.liik || "Remondilaen" };
            // Vana "KK.AAAA" formaat (algus väli)
            if (ln.algus) {
              const ap = ln.algus.split(".");
              return { ...ln, ...base, algusAasta: ap[1] || fallbackY, liik: ln.liik || "Remondilaen" };
            }
            // startYM "AAAA-KK" formaat
            const parts = (ln.startYM || "").split("-");
            return { ...ln, ...base, algusAasta: parts[0] || fallbackY, liik: ln.liik || "Remondilaen" };
          });
        }

        // --- Migreeri seisukord ---
        const rawAssetConditionItems = Array.isArray(candidateState.assetCondition?.items)
          ? candidateState.assetCondition.items
          : null;

        const rawLegacySeisukord =
          rawAssetConditionItems == null && Array.isArray(data.seisukord)
            ? data.seisukord
            : [];

        let importedSeisukord = (rawAssetConditionItems ?? rawLegacySeisukord).map(r => {
          const { tegevusKvartal: _ignored, ...rest } = r;
          return { tegevusAasta: "", eeldatavKulu: 0, tegevus: "", ...rest };
        });

        // Migrate seisukord "Muu" items out
        const importedMuudInv = [];
        importedSeisukord = importedSeisukord.filter(r => {
          if (r.ese === "Muu" && r.investeering) {
            importedMuudInv.push({
              nimetus: r.invNimetus || r.muuNimetus || "",
              aasta: r.tegevusAasta || "",
              maksumus: r.invMaksumus || 0,
              rahpiiri: r.rahpiiri || [],
            });
            return false;
          }
          return r.ese !== "Muu";
        });

        // Migreeri vanad rahastusallika nimed
        const migreeriAllikas = (a) => a === "Erakorraline makse" ? "Sihtmakse" : a === "Reservkapital" ? "Remondifond" : a;
        importedSeisukord.forEach(e => { if (e.rahpiiri) e.rahpiiri = e.rahpiiri.map(rp => ({ ...rp, allikas: migreeriAllikas(rp.allikas) })); });
        importedMuudInv.forEach(e => { if (e.rahpiiri) e.rahpiiri = e.rahpiiri.map(rp => ({ ...rp, allikas: migreeriAllikas(rp.allikas) })); });

        // Merge new-format muudInvesteeringud from v1 export
        const newFormatMuud = Array.isArray(data.muudInvesteeringud) ? data.muudInvesteeringud : [];
        newFormatMuud.forEach(e => { if (e.rahpiiri) e.rahpiiri = e.rahpiiri.map(rp => ({ ...rp, allikas: migreeriAllikas(rp.allikas) })); });
        const allMuud = [...newFormatMuud, ...importedMuudInv];

        // --- migrateToCanonicalPlan ---
        // Kui investments on tühi VÕI puuduvad sourceType väljad → migreerime
        const currentInvestmentItems =
          candidateState.investments?.items ??
          candidateState.investmentsPipeline?.items ??
          [];

        const needsMigration =
          !currentInvestmentItems.length ||
          !currentInvestmentItems[0]?.sourceType;

        if (needsMigration) {
          const investments = [];
          // Legacy condition_item investments are preserved for backward compatibility,
          // but Tab 1 no longer creates, displays, or syncs them.
          // 1. seisukord → condition_item investments (legacy import only)
          importedSeisukord.forEach(r => {
            if (r.investeering) {
              investments.push({
                ...mkInvestmentItem({
                  name: r.invNimetus || r.ese,
                  plannedYear: Number(r.tegevusAasta) || candidateState.period?.year,
                  totalCostEUR: Number(r.invMaksumus || r.eeldatavKulu) || 0,
                }),
                sourceType: "condition_item",
                sourceRefId: r.id,
                fundingPlan: (r.rahpiiri || []).map(rp => ({ source: rp.allikas, amountEUR: Number(rp.summa) || 0 })),
              });
            }
          });
          // 2. muud investeeringud → standalone investments
          allMuud.forEach(m => {
            investments.push({
              ...mkInvestmentItem({
                name: m.nimetus,
                plannedYear: Number(m.aasta) || candidateState.period?.year,
                totalCostEUR: Number(m.maksumus) || 0,
              }),
              sourceType: "standalone",
              sourceRefId: null,
              fundingPlan: (m.rahpiiri || []).map(rp => ({ source: rp.allikas, amountEUR: Number(rp.summa) || 0 })),
            });
          });
          // Also fold in old investments items that have no sourceType
          currentInvestmentItems.forEach(inv => {
            if (!inv.sourceType) {
              const seotud = inv.seisukordId ? importedSeisukord.find(e => e.id === inv.seisukordId) : null;
              const rahpiiri = (inv.fundingPlan || []).map(fp => ({
                source: ({ REPAIR_FUND: "Remondifond", RESERVE: "Remondifond", LOAN: "Laen", GRANT: "Toetus", ONE_OFF: "Sihtmakse" })[fp.source] || fp.source,
                amountEUR: fp.amountEUR || 0,
              }));
              if (!investments.some(i => i.sourceRefId === inv.seisukordId)) {
                investments.push({
                  ...mkInvestmentItem({ name: inv.name || "", plannedYear: inv.plannedYear || candidateState.period?.year, totalCostEUR: inv.totalCostEUR || 0 }),
                  sourceType: seotud ? "condition_item" : "standalone",
                  sourceRefId: seotud ? inv.seisukordId : null,
                  fundingPlan: rahpiiri,
                });
              }
            } else {
              // Already canonical
              if (!investments.some(i => i.id === inv.id)) investments.push(inv);
            }
          });
          candidateState.investments = { items: investments };
        }

        // Alati normaliseeri investments väli (ka ilma migratsioonita)
        normalizeInvestmentsField(candidateState);

        // Migrate investments — lisa puuduvad contingency-väljad (backward compatibility)
        if (Array.isArray(candidateState.investments?.items)) {
          candidateState.investments.items = candidateState.investments.items.map(inv => ({
            contingencyEnabled: false,
            contingencyType: null,
            contingencyPercent: null,
            contingencyNote: "",
            ...inv,
          }));
        }

        // Puhasta seisukord — eemalda inv väljad (need elavad nüüd investments-s)
        const cleanSeisukord = cleanAssetConditionInvestmentFields(importedSeisukord);

        candidateState.assetCondition = {
          items: cleanSeisukord ?? candidateState.assetCondition?.items ?? [],
        };

        // Dry-run: validate migrated state produces a valid evaluation
        let dryRunResult;
        try {
          dryRunResult = runPlan(candidateState);
        } catch (err) {
          setImportError("Import ebaõnnestus: sisend ei läbinud kontrolli pärast migratsiooni — " + (err.message || "tundmatu viga"));
          return;
        }
        const dryEval = dryRunResult.evaluation;
        if (!dryEval || !dryEval.trace || dryEval.trace.schemaVersion !== "trace/v1") {
          setImportError("Import ebaõnnestus: evaluation trace/v1 kontroll ebaõnnestus.");
          return;
        }

        setPlan(candidateState);
        if (data.kyData) setKyData(data.kyData);
        setRepairFundSaldo(data.repairFundSaldo ?? "");
        if (data.remondifond) {
          setRemondifond({
            saldoAlgus: data.remondifond.saldoAlgus || "",
            kogumisViis: data.remondifond.kogumisViis || "eraldi",
            pangaKoefitsient: data.remondifond.pangaKoefitsient ?? 1.15,
            pangaMaarOverride: data.remondifond.pangaMaarOverride ?? null,
            maarOverride: data.remondifond.maarOverride > 0 ? data.remondifond.maarOverride : null,
            maarKorterKuu: data.remondifond.maarKorterKuu ?? null,
            planeeritudKogumine: data.remondifond.planeeritudKogumine || "",
            soovitudSaldoLopp: data.remondifond.soovitudSaldoLopp || "",
            fondiMuuTulu: data.remondifond.fondiMuuTulu || "",
          });
        } else if (data.repairFundSaldo) {
          setRemondifond({
            saldoAlgus: data.repairFundSaldo,
            kogumisViis: "eraldi",
            pangaKoefitsient: 1.15,
            pangaMaarOverride: null,
            maarOverride: null,
            maarKorterKuu: null,
            planeeritudKogumine: "",
            soovitudSaldoLopp: "",
            fondiMuuTulu: "",
          });
        }
        if (data.resKap) {
          const loadedKasutamine = data.resKap.kasutamine || "";
          setResKap({
            saldoAlgus: data.resKap.saldoAlgus || "",
            kasutamine: loadedKasutamine,
            pohjendus: data.resKap.pohjendus || "",
            usesReserveDuringPeriod: parseFloat(loadedKasutamine) > 0,
          });
        }
        setResKapManual(false);
        if (data.loanStatus) setLoanStatus(data.loanStatus);
        setSolvereMetrics(dryRunResult.metrics);
        setEvaluation(dryEval);
        setImportError(null);
      } catch {
        setImportError("Faili lugemine ebaõnnestus: vigane JSON.");
      }
    };
    reader.readAsText(file);
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

  const handleApartmentsLoaded = (apartmentsFromEHR) => {
    const ehrSum = apartmentsFromEHR.reduce((s, a) => s + (parseFloat(a.area) || 0), 0);
    setEhrTotalAreaM2(Math.round(ehrSum * 100) / 100);
    const ehrPind = ehrSum > 0 ? Math.round(ehrSum * 100) / 100 : null;
    const ehrArv = String(apartmentsFromEHR.length);
    setKyData(prev => ({
      ...prev,
      korteriteArv: ehrArv,
      ...(ehrPind != null ? { suletudNetopind: ehrPind } : {}),
      ehrPind,
      ehrArv,
    }));
    const doLoadApts = () => setPlan(p => ({
      ...p,
      building: { ...p.building, apartments: apartmentsFromEHR.map(a => mkApartment({ label: a.number, areaM2: a.area })) },
    }));
    const existing = plan.building.apartments;
    const hasReal = existing.some(a => a.areaM2 > 0 || (a.label && a.label !== "1"));
    if (hasReal && existing.length > 0) {
      askConfirm(
        `Hoones leiti ${apartmentsFromEHR.length} korterit. Kas asendada olemasolevad ${existing.length} korterit?`,
        "Asenda",
        doLoadApts
      );
    } else {
      doLoadApts();
    }
  };

  const addRow = (side, overrides = {}) => {
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
        ? { category: "", kogus: "", uhik: "", uhikuHind: "", arvutus: "aastas", summaInput: 0, selgitus: "", forecastAdjustmentEnabled: false, forecastAdjustmentType: null, forecastAdjustmentPercent: null, forecastAdjustmentNote: "", allocationBasis: "m2", legalBasisSeadus: true, legalBasisBylaws: false, legalBasisSpecialAgreement: false, legalBasisMuu: false, allocationExplanation: "", settledPostHoc: false, fundingSource: "eelarve", recursNextPeriod: false, nextPeriodAmount: null }
        : { category: "", arvutus: "aastas", summaInput: "", incomeAllocation: "general", incomeAllocations: [], incomeUse: "general", targetFund: null, fundDirectedAmount: "" }),
      ...overrides,
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
    patch.utilityType = UTILITY_TYPE_BY_CATEGORY[newKategooria] || null;
    if (KOMMUNAALTEENUSED.includes(newKategooria)) {
      patch.uhik = KOMMUNAAL_VAIKE_UHIK[newKategooria] || "";
      patch.kogus = "";
      patch.uhikuHind = "";
      patch.arvutus = undefined;
      patch.summaInput = 0;
    } else {
      patch.arvutus = "aastas";
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
    const endY = plan.period.end ? Number(plan.period.end.slice(0, 4)) : 0;
    const y = plan.period.year && endY >= new Date().getFullYear() ? String(plan.period.year) : "";
    setPlan(p => ({
      ...p,
      assetCondition: {
        ...p.assetCondition,
        items: [
          ...(p.assetCondition?.items || []),
          {
            id: crypto.randomUUID(),
            ese: "",
            seisukordVal: "",
            puudused: "",
            prioriteet: "",
            eeldatavKulu: 0,
            tegevus: "",
            tegevusAasta: y,
          },
        ],
      },
    }));
  };

  const uuendaSeisukord = (id, field, value) => {
    setPlan(p => ({
      ...p,
      assetCondition: {
        ...p.assetCondition,
        items: (p.assetCondition?.items || []).map(r =>
          r.id !== id ? r : { ...r, [field]: value }
        ),
      },
    }));
  };

  const eemaldaSeisukordRida = (id) => {
    setPlan(p => ({
      ...p,
      assetCondition: {
        ...p.assetCondition,
        items: (p.assetCondition?.items || []).filter(r => r.id !== id),
      },
    }));
  };

  const seisukordRidaOnAndmeid = (rida) => Boolean(
    rida.ese || rida.seisukordVal || rida.prioriteet ||
    rida.puudused?.trim() || rida.tegevus?.trim() ||
    Number(rida.eeldatavKulu) > 0 || rida.tegevusAasta
  );

  const tühjendaSeisukordRida = (id) => {
    setPlan(p => ({
      ...p,
      assetCondition: {
        ...p.assetCondition,
        items: (p.assetCondition?.items || []).map(r =>
          r.id !== id ? r : { ...r, ese: "", seisukordVal: "", puudused: "", prioriteet: "", eeldatavKulu: 0, tegevus: "", tegevusAasta: "" }
        ),
      },
    }));
  };


  const eemaldaInvesteering = (sourceRefId) => {
    askConfirm("Kas soovid investeeringu eemaldada?", "Eemalda", () => {
      setPlan(p => {
        const inv = p.investments.items.find(i => i.sourceRefId === sourceRefId);
        const hasLoan = (inv?.fundingPlan || []).some(fp => fp.source === "Laen");
        return {
          ...p,
          investments: { ...p.investments, items: p.investments.items.filter(i => i.sourceRefId !== sourceRefId) },
          loans: hasLoan ? p.loans.filter(l => l.sepiiriostudInvId !== sourceRefId) : p.loans,
        };
      });
    });
  };

  // Rahastusridade CRUD — condition_item investeeringud (seisukord.id = sourceRefId)
  const lisaRahpiiriRida = (sourceRefId) => {
    setPlan(p => ({
      ...p,
      investments: {
        ...p.investments,
        items: p.investments.items.map(i =>
          i.sourceRefId === sourceRefId
            ? { ...i, fundingPlan: [...(i.fundingPlan || []), { source: "", amountEUR: 0 }] }
            : i
        ),
      },
    }));
  };

  const uuendaRahpiiriRida = (sourceRefId, ri, patch) => {
    const fpPatch = {};
    if (patch.allikas !== undefined) fpPatch.source = patch.allikas;
    if (patch.summa !== undefined) fpPatch.amountEUR = Number(patch.summa) || 0;

    setPlan(p => {
      const inv = p.investments.items.find(i => i.sourceRefId === sourceRefId);
      const vanaAllikas = inv?.fundingPlan?.[ri]?.source;
      const uusAllikas = fpPatch.source !== undefined ? fpPatch.source : vanaAllikas;

      const updatedItems = p.investments.items.map(i =>
        i.sourceRefId === sourceRefId
          ? { ...i, fundingPlan: (i.fundingPlan || []).map((fp, fi) => fi === ri ? { ...fp, ...fpPatch } : fp) }
          : i
      );

      let loans = p.loans;
      if (uusAllikas === "Laen" && vanaAllikas !== "Laen") {
        const summa = fpPatch.amountEUR ?? (inv?.fundingPlan?.[ri]?.amountEUR || 0);
        loans = syncLoan(p, sourceRefId, summa);
      } else if (vanaAllikas === "Laen" && uusAllikas !== "Laen") {
        loans = p.loans.filter(l => l.sepiiriostudInvId !== sourceRefId);
      } else if (uusAllikas === "Laen" && fpPatch.amountEUR !== undefined) {
        loans = syncLoan(p, sourceRefId, fpPatch.amountEUR);
      }

      return { ...p, investments: { ...p.investments, items: updatedItems }, loans };
    });
  };

  const eemaldaRahpiiriRida = (sourceRefId, ri) => {
    setPlan(p => {
      const inv = p.investments.items.find(i => i.sourceRefId === sourceRefId);
      const eemaldatav = inv?.fundingPlan?.[ri];

      const updatedItems = p.investments.items.map(i =>
        i.sourceRefId === sourceRefId
          ? { ...i, fundingPlan: (i.fundingPlan || []).filter((_, fi) => fi !== ri) }
          : i
      );

      const loans = eemaldatav?.source === "Laen"
        ? p.loans.filter(l => l.sepiiriostudInvId !== sourceRefId)
        : p.loans;

      return { ...p, investments: { ...p.investments, items: updatedItems }, loans };
    });
  };

  // --- STANDALONE INVESTEERINGUD (endised "muud investeeringud") ---
  const lisaStandaloneInvesteering = () => {
    const y = plan.period.year;
    const newInv = {
      ...mkInvestmentItem({ name: "", plannedYear: y, totalCostEUR: 0 }),
      sourceType: "standalone",
      sourceRefId: null,
      fundingPlan: [],
      contingencyEnabled: false,
      contingencyType: null,
      contingencyPercent: null,
      contingencyNote: "",
    };
    setPlan(p => ({ ...p, investments: { ...p.investments, items: [...p.investments.items, newInv] } }));
  };

  const eemaldaStandaloneInvesteering = (invId) => {
    setPlan(p => {
      const inv = p.investments.items.find(i => i.id === invId);
      const hasLoan = (inv?.fundingPlan || []).some(fp => fp.source === "Laen");
      return {
        ...p,
        investments: { ...p.investments, items: p.investments.items.filter(i => i.id !== invId) },
        loans: hasLoan ? p.loans.filter(l => l.sepiiriostudInvId !== invId) : p.loans,
      };
    });
  };

  const uuendaStandaloneInvesteering = (invId, patch) => {
    setPlan(p => ({
      ...p,
      investments: {
        ...p.investments,
        items: p.investments.items.map(i => i.id === invId ? { ...i, ...patch } : i),
      },
    }));
  };

  const lisaStandaloneRahpiiriRida = (invId) => {
    setPlan(p => ({
      ...p,
      investments: {
        ...p.investments,
        items: p.investments.items.map(i =>
          i.id === invId
            ? { ...i, fundingPlan: [...(i.fundingPlan || []), { source: "", amountEUR: 0 }] }
            : i
        ),
      },
    }));
  };

  const eemaldaStandaloneRahpiiriRida = (invId, ridaIdx) => {
    setPlan(p => {
      const inv = p.investments.items.find(i => i.id === invId);
      const eemaldatav = inv?.fundingPlan?.[ridaIdx];

      const updatedItems = p.investments.items.map(i =>
        i.id === invId
          ? { ...i, fundingPlan: (i.fundingPlan || []).filter((_, ri) => ri !== ridaIdx) }
          : i
      );

      const loans = eemaldatav?.source === "Laen"
        ? p.loans.filter(l => l.sepiiriostudInvId !== invId)
        : p.loans;

      return { ...p, investments: { ...p.investments, items: updatedItems }, loans };
    });
  };

  const handleStandaloneRahpiiriChange = (invId, ridaIdx, field, value) => {
    const fpPatch = {};
    if (field === "allikas") fpPatch.source = value;
    if (field === "summa") fpPatch.amountEUR = Number(value) || 0;

    setPlan(p => {
      const inv = p.investments.items.find(i => i.id === invId);
      const vanaAllikas = inv?.fundingPlan?.[ridaIdx]?.source;
      const uusAllikas = field === "allikas" ? value : vanaAllikas;

      const updatedItems = p.investments.items.map(i =>
        i.id === invId
          ? { ...i, fundingPlan: (i.fundingPlan || []).map((fp, ri) => ri === ridaIdx ? { ...fp, ...fpPatch } : fp) }
          : i
      );

      let loans = p.loans;
      if (uusAllikas === "Laen" && vanaAllikas !== "Laen") {
        const summa = fpPatch.amountEUR ?? (inv?.fundingPlan?.[ridaIdx]?.amountEUR || 0);
        loans = syncLoan(p, invId, summa);
      } else if (vanaAllikas === "Laen" && uusAllikas !== "Laen") {
        loans = p.loans.filter(l => l.sepiiriostudInvId !== invId);
      } else if (uusAllikas === "Laen" && field === "summa") {
        loans = syncLoan(p, invId, Number(value) || 0);
      }

      return { ...p, investments: { ...p.investments, items: updatedItems }, loans };
    });
  };

  // --- LAENU SÜNKROON RAHASTUSPLAANIST ---
  const syncLaenRahastusplaanist = (investeeringId, laenSumma) => {
    setPlan(p => ({ ...p, loans: syncLoan(p, investeeringId, laenSumma) }));
  };

  const eemaldaSeostudLaen = (investeeringId) => {
    const seotud = plan.loans.find(l => l.sepiiriostudInvId === investeeringId);
    if (!seotud) return;
    if (seotud.annualRatePct || seotud.termMonths) {
      askConfirm(
        "Eemaldada ka seotud laenurida Rahastamine sektsioonist?",
        "Eemalda laen",
        () => setPlan(p => ({ ...p, loans: p.loans.filter(l => l.sepiiriostudInvId !== investeeringId) })),
        "Säilita laen",
        () => setPlan(p => ({ ...p, loans: p.loans.map(l =>
          l.sepiiriostudInvId === investeeringId ? { ...l, sepiiriostudInvId: null } : l
        )}))
      );
      return;
    }
    setPlan(p => ({ ...p, loans: p.loans.filter(l => l.sepiiriostudInvId !== investeeringId) }));
  };

  const addLoan = () => {
    const y = String(plan.period.year || new Date().getFullYear());
    setPlan(p => ({ ...p, loans: [...p.loans, { ...mkLoan({ startYM: `${y}-01` }), liik: "Remondilaen", algusAasta: y, sepiiriostudInvId: null, termMonths: 12 }] }));
  };

  const addExistingLoan = () => {
    setPlan(p => ({ ...p, loans: [...p.loans, mkLoan({ allocationBasis: "m2", legalBasisSeadus: true })] }));
  };

  const updateLoan = (id, patch) => {
    setPlan(p => ({ ...p, loans: p.loans.map(ln => {
      if (ln.id !== id) return ln;
      const updated = { ...ln, ...patch };
      if (patch.algusAasta) {
        updated.startYM = `${updated.algusAasta}-01`;
      }
      return updated;
    }) }));
  };

  const removeLoan = (loanId) => {
    const ln = plan.loans.find(l => l.id === loanId);
    const doRemove = () => setPlan(p => {
      const loan = p.loans.find(l => l.id === loanId);
      const linkedInvId = loan?.sepiiriostudInvId ?? null;
      const updatedLoans = p.loans.filter(l => l.id !== loanId);
      const updatedInvestments = linkedInvId
        ? {
            ...p.investments,
            items: p.investments.items.map(inv => {
              if (inv.id !== linkedInvId && inv.sourceRefId !== linkedInvId) return inv;
              return { ...inv, fundingPlan: (inv.fundingPlan || []).filter(fp => fp.source !== "Laen") };
            }),
          }
        : p.investments;
      return { ...p, loans: updatedLoans, investments: updatedInvestments };
    });
    if (ln?.sepiiriostudInvId) {
      askConfirm("See laen on seotud investeeringuga. Eemaldada?", "Eemalda", doRemove);
    } else {
      doRemove();
    }
  };

  // Auto-add one empty row when section is empty (setPlan, not addX — idempotent even if effect fires twice)
  useEffect(() => { if (plan.building.apartments.length === 0) setPlan(p => ({ ...p, building: { ...p.building, apartments: [mkApartment({ label: "1" })] } })); }, [plan.building.apartments.length]);
  // Investeeringud algavad tühjana — luuakse ainult "Loo investeering" või "+ Lisa investeering" kaudu
  useEffect(() => { if (plan.budget.costRows.length === 0) setPlan(p => ({ ...p, budget: { ...p.budget, costRows: [{ ...mkCashflowRow({ side: "COST" }), category: "", kogus: "", uhik: "", uhikuHind: "", arvutus: "aastas", summaInput: 0, selgitus: "", forecastAdjustmentEnabled: false, forecastAdjustmentType: null, forecastAdjustmentPercent: null, forecastAdjustmentNote: "", allocationBasis: "m2", legalBasisBylaws: false, legalBasisSpecialAgreement: false, allocationExplanation: "", settledPostHoc: false }] } })); }, [plan.budget.costRows.length]);
  useEffect(() => { if (plan.budget.incomeRows.length === 0) setPlan(p => ({ ...p, budget: { ...p.budget, incomeRows: [{ ...mkCashflowRow({ side: "INCOME" }), category: "", arvutus: "aastas", summaInput: "" }] } })); }, [plan.budget.incomeRows.length]);

  // Migreeri vanad tulukategooriad → Muu tulu või eemalda
  useEffect(() => {
    let changed = false;
    const filtered = plan.budget.incomeRows.map(r => {
      // Kõik vanad kategooriad → eemalda (Haldustasu on nüüd automaatne)
      if (r.category === "Halduskulude ettemaks" || r.category === "Majandamiskulude ettemaks" || r.category === "Vahendustasu") {
        changed = true;
        return null;
      }
      // "Renditulu" → "Muu tulu" (Renditulu on nüüd lihtsalt nimetus "Muu tulu" all)
      if (r.category === "Renditulu") {
        changed = true;
        return { ...r, category: "Muu tulu", name: r.name || "Renditulu" };
      }
      // Kõik ülejäänud tundmatud → "Muu tulu" (kehtivad Tab 2 kategooriad säilivad)
      if (r.category && !TULU_KATEGORIAD_TAB2.includes(r.category)) {
        changed = true;
        return { ...r, category: "Muu tulu" };
      }
      return r;
    }).filter(Boolean);
    if (changed) setPlan(p => ({ ...p, budget: { ...p.budget, incomeRows: filtered } }));
  }, []);

  // Kulude summa sünkroonimine engine'ile (→ calc.params.amountEUR)
  useEffect(() => {
    setPlan(p => {
      let changed = false;
      const updated = p.budget.costRows.map(r => {
        let summa;
        if (KOMMUNAALTEENUSED.includes(r.category)) {
          summa = parseFloat(r.summaInput) || 0;
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
      return changed ? { ...p, budget: { ...p.budget, costRows: updated } } : p;
    });
  }, [plan.budget.costRows, derived.period.monthEq]);

  // Tulude summa sünkroonimine engine'ile (→ calc.params.amountEUR)
  useEffect(() => {
    setPlan(p => {
      let changed = false;
      const updated = p.budget.incomeRows.map(r => {
        if (r.arvutus === undefined) return r;
        const summa = arvutaHaldusSumma(r);
        if (r.calc.params.amountEUR !== summa) {
          changed = true;
          return { ...r, calc: { type: "FIXED_PERIOD", params: { amountEUR: summa } } };
        }
        return r;
      });
      return changed ? { ...p, budget: { ...p.budget, incomeRows: updated } } : p;
    });
  }, [plan.budget.incomeRows, derived.period.monthEq]);

  // Investeeringud algavad tühjana — luuakse ainult "Loo investeering" või "+ Lisa investeering" kaudu
  useEffect(() => {
    if ((plan.assetCondition?.items || []).length > 0) return;
    const y = plan.period.start ? plan.period.start.slice(0, 4) : "";
    setPlan(p => ({
      ...p,
      assetCondition: {
        ...p.assetCondition,
        items: [{
          id: crypto.randomUUID(),
          ese: "",
          seisukordVal: "",
          puudused: "",
          prioriteet: "",
          eeldatavKulu: 0,
          tegevus: "",
          tegevusAasta: y,
        }],
      },
    }));
  }, [plan.assetCondition?.items?.length, plan.period.start]);

  // Perioodi aasta muutumisel: uuenda tühjad aasta väljad
  useEffect(() => {
    setPlan(p => fillMissingYearsFromPeriod(p, plan.period.year));
  }, [plan.period.year]);


  const SECS = ["Üldandmed", "Seisukord ja plaan", "Tulud ja kulud", "Kommunaalid", "Fondid", "Kohustuste jaotus", "Majanduskava"];

  const askConfirm = useCallback((message, confirmLabel, onConfirm, cancelLabel = "Loobu", onCancel) => {
    setConfirmModal({ message, confirmLabel, cancelLabel, onConfirm, onCancel: onCancel ?? null });
  }, []);

  const clearSection = (tabIdx) => {
    askConfirm("Kas oled kindel, et soovid selle jaotise andmed tühjendada?", "Tühjenda", () => {
    if (tabIdx === 0) { setKyData({ nimi: "", registrikood: "", aadress: "", kyAadress: "", kyAadressEdited: false, ehrKood: "", ehitusaasta: "", suletudNetopind: "", koetavPind: "", korteriteArv: "", korrusteArv: "" }); }
    setPlan(p => {
      if (tabIdx === 0) return { ...p, period: { ...p.period, start: "", end: "" }, building: { ...p.building, apartments: [] } };
      if (tabIdx === 1) return { ...p, assetCondition: { items: [] } };
      if (tabIdx === 2) return { ...p, budget: { ...p.budget, costRows: p.budget.costRows.filter(r => KOMMUNAALTEENUSED.includes(r.category)), incomeRows: [] } };
      if (tabIdx === 4) { setRepairFundSaldo(""); setRemondifond({ saldoAlgus: "", kogumisViis: "eraldi", pangaKoefitsient: 1.15, pangaMaarOverride: null, maarOverride: null, maarKorterKuu: null, planeeritudKogumine: "", soovitudSaldoLopp: "" }); setResKap({ saldoAlgus: "", kasutamine: "", pohjendus: "", usesReserveDuringPeriod: false }); return { ...p, funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } }, loans: [], allocationPolicies: defaultPlan().allocationPolicies }; }
      return p;
    });
    });
  };
  const clearBtn = (tabIdx) => (
    <button onClick={() => clearSection(tabIdx)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: N.dim, textDecoration: "underline", padding: 0 }}>
      Tühjenda
    </button>
  );

  // ── Tab completion status: "empty" | "partial" | "done" ──
  const hasPeriod = plan.period.start && plan.period.end;
  const hasAnyApt = plan.building.apartments.length > 0;
  const hasRealApt = plan.building.apartments.some(a => (parseFloat(a.areaM2) || 0) > 0);
  const hasRealCost = plan.budget.costRows.some(r => (parseFloat(r.summaInput) || 0) > 0);
  const kommunaalRows = plan.budget.costRows.filter(r => KOMMUNAALTEENUSED.includes(r.category));
  const hasFondidData = plan.loans.length > 0 || plan.funds.repairFund.monthlyRateEurPerM2 > 0;
  const tab0AllFilled = Boolean(
    kyData.registrikood?.trim() &&
    kyData.nimi?.trim() &&
    kyData.aadress?.trim() &&
    parseFloat(kyData.suletudNetopind) > 0 &&
    kyData.korteriteArv &&
    plan.period.start &&
    plan.period.end
  );
  const tab0AnyTouched = Boolean(
    kyData.registrikood?.trim() ||
    kyData.nimi?.trim() ||
    kyData.aadress?.trim() ||
    parseFloat(kyData.suletudNetopind) > 0 ||
    kyData.korteriteArv ||
    plan.period.start ||
    plan.period.end
  );
  const tab1MultiYear = Boolean(
    plan.period.start && plan.period.end &&
    Number(plan.period.end.slice(0, 4)) > Number(plan.period.start.slice(0, 4))
  );

  const tabStatus = [
    // 0: Üldandmed
    tab0AllFilled ? "valid" : tab0AnyTouched ? "invalid" : "",
    // 1: Hoone seisukord ja tööd
    (() => {
      const active = seisukord.filter(r => r.ese);
      if (active.length === 0) return "";
      const allComplete = active.every(r =>
        r.seisukordVal && r.prioriteet && r.puudused?.trim() && r.tegevus?.trim() &&
        Number(r.eeldatavKulu) > 0 && (!tab1MultiYear || r.tegevusAasta)
      );
      return allComplete ? "valid" : "invalid";
    })(),
    // 2: Kavandatavad tulud ja kulud (kommunaalread ja uued planeeritavad laenud ei loe)
    (() => {
      const tab2Costs = plan.budget.costRows.filter(r => !KOMMUNAALTEENUSED.includes(r.category));
      const tab2ExistingLoans = plan.loans.filter(l => !l.sepiiriostudInvId);
      const activeIncomes = plan.budget.incomeRows.filter(r => (r.category && r.category !== "Muu tulu") || (parseFloat(r.summaInput) || 0) > 0 || r.name?.trim());
      const activeCosts = tab2Costs.filter(r => r.category || (parseFloat(r.summaInput) || 0) > 0);
      const activeLoans = tab2ExistingLoans.filter(l => l.laenuandja || l.name || (parseFloat(l.pohiosPerioodis) || 0) + (parseFloat(l.intressPerioodis) || 0) + (parseFloat(l.teenustasudPerioodis) || 0) > 0);
      if (!activeIncomes.length && !activeCosts.length && !activeLoans.length) return "";
      const ok =
        activeIncomes.every(r => r.category && (parseFloat(r.summaInput) || 0) > 0) &&
        activeCosts.every(r => r.category && (parseFloat(r.summaInput) || 0) > 0) &&
        activeLoans.every(l => (l.laenuandja || l.name) && (parseFloat(l.pohiosPerioodis) || 0) + (parseFloat(l.intressPerioodis) || 0) + (parseFloat(l.teenustasudPerioodis) || 0) > 0);
      return ok ? "valid" : "invalid";
    })(),
    // 3: Kommunaalid
    kommunaalRows.some(r => (parseFloat(r.summaInput) || 0) > 0) ? "valid" : kommunaalRows.length > 0 ? "invalid" : "",
    // 4: Fondid ja laen
    hasFondidData ? "valid" : "",
    // 5: Maksed korteritele
    (hasRealApt && hasPeriod) ? "valid" : hasAnyApt ? "invalid" : "",
    // 6: Kokkuvõte
    (() => {
      if (hasRealApt && hasPeriod && hasRealCost) return "valid";
      if (hasAnyApt || hasPeriod || hasRealCost) return "invalid";
      return "";
    })(),
  ];


  const kuluRidaEditor = (r, allowedGroups = null, allowedKommunaalCategories = null, hideRemove = false) => {
    const isKommunaal = KOMMUNAALTEENUSED.includes(r.category);
    const isMuuKomm   = r.category === "Muu kommunaalteenus";
    const isMuuHaldus = r.category === "Muu haldusteenus";
    // Haru A: mõõdetavad kommunaalteenused (Soojus, Vesi, Elekter, Kütus)
    const showKogusUhik = isKommunaal && !isMuuKomm;
    // Nimetus: ainult "Muu" kategooriate puhul — muud on ise oma nimetus
    const showNimetus = isMuuKomm || isMuuHaldus;

    return (
      <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>

          {/* Kategooria */}
          <div style={{ width: 180 }}>
            <div style={fieldLabel}>Kategooria</div>
            <select
              value={r.category || ""}
              onChange={(e) => handleKuluKategooriaChange(r.id, e.target.value)}
              style={{ ...selectStyle, width: "100%" }}
            >
              <option value="" disabled>Vali...</option>
              {(!allowedGroups || allowedGroups.includes("kommunaal")) && (
                <optgroup label="Kommunaalteenused">
                  {(allowedKommunaalCategories || KOMMUNAALTEENUSED).map(k => <option key={k} value={k}>{k}</option>)}
                </optgroup>
              )}
              {(!allowedGroups || allowedGroups.includes("haldus")) && (
                <optgroup label="Haldusteenused">
                  {HALDUSTEENUSED.map(k => <option key={k} value={k}>{k}</option>)}
                </optgroup>
              )}
              {(!allowedGroups || allowedGroups.includes("laenu")) && (
                <optgroup label="Laenumaksed">
                  {LAENUMAKSED.map(k => <option key={k} value={k}>{k}</option>)}
                </optgroup>
              )}
            </select>
          </div>

          {/* Nimetus — ainult "Muu" kategooriate puhul */}
          {showNimetus && (
            <div style={{ flex: 2 }}>
              <div style={fieldLabel}>Nimetus</div>
              <input
                value={r.name}
                onChange={(e) => updateRow("COST", r.id, { name: e.target.value })}
                placeholder={KULU_NIMETUS_PLACEHOLDERS[r.category] || "Kirjelda kulu"}
                style={inputStyle}
              />
            </div>
          )}

          {/* Haru A: Kogus × ühik (mõõdetavad kommunaalteenused) */}
          {showKogusUhik ? (
            <>
              <div style={{ width: 100 }}>
                <div style={fieldLabel}>Kogus</div>
                <NumberInput
                  value={r.kogus}
                  onChange={(v) => updateRow("COST", r.id, { kogus: v })}
                  placeholder="0"
                  style={numStyle}
                />
                {(() => {
                  const s = utilityRowStatus(r);
                  return s.isUtility && s.missing.length > 0 ? (
                    <div style={{ fontSize: 12, color: "#c53030", marginTop: 4 }}>
                      {s.missing.map(m => m === "kogus" ? "Kogus puudub" : "Ühik puudub").join(", ")}
                    </div>
                  ) : null;
                })()}
              </div>
              <div style={{ width: 100 }}>
                <div style={fieldLabel}>Ühik</div>
                <select
                  value={r.uhik || ""}
                  onChange={(e) => updateRow("COST", r.id, { uhik: e.target.value })}
                  style={{ ...selectStyle, width: "100%" }}
                >
                  {(KOMMUNAAL_UHIKUD[r.category] || []).map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div style={{ width: 140 }}>
                <div style={fieldLabel}>Maksumus €/periood</div>
                <EuroInput
                  value={r.summaInput || 0}
                  onChange={(v) => updateRow("COST", r.id, { summaInput: v })}
                  style={numStyle}
                />
              </div>
            </>
          ) : (
            /* Haru B: kõik ülejäänud — ainult summa */
            <div style={{ width: 140 }}>
              <div style={fieldLabel}>{isMuuKomm ? "€/periood" : "Maksumus €/periood"}</div>
              <EuroInput
                value={r.summaInput || 0}
                onChange={(v) => updateRow("COST", r.id, {
                  summaInput: v,
                  arvutus: r.category ? "aastas" : "perioodis",
                })}
                style={numStyle}
              />
            </div>
          )}

          {/* Rahastusallikas — kõigil mitte-kommunaalteenuste ridadel */}
          {!isKommunaal && !LAENUMAKSED.includes(r.category) && (
            <div style={{ width: 160 }}>
              <div style={fieldLabel}>Rahastusallikas</div>
              <select
                value={r.fundingSource || "eelarve"}
                onChange={(e) => updateRow("COST", r.id, { fundingSource: e.target.value })}
                style={{ ...selectStyle, width: "100%" }}
              >
                <option value="eelarve">Tavapärane eelarve</option>
                <option value="remondifond">Remondifond</option>
              </select>
              {r.fundingSource === "remondifond" && (
                <div style={{ fontSize: 12, color: N.dim, marginTop: 4 }}>
                  Kavandatavate tööde maksumus kuulub Tab 1 investeeringute tabelisse.
                </div>
              )}
            </div>
          )}

          <div style={{ width: 100 }}>
            <div style={fieldLabel}>Jaotamise alus</div>
            {HALDUSTEENUSED.includes(r.category) ? (() => {
              const desc = describeAllocationPolicy(plan.allocationPolicies?.maintenance);
              return (
                <>
                  <div style={{ ...selectStyle, width: "100%", display: "flex", alignItems: "center", background: N.muted, color: N.text }}>
                    {desc.basisLabel}
                  </div>
                  <div style={{ fontSize: 12, color: N.dim, marginTop: 4 }}>
                    {desc.hasOverride
                      ? `Õiguslik alus: ${desc.legalBasis}${desc.legalBasisNote ? " — " + desc.legalBasisNote : ""}`
                      : "Kaasomandi osa suuruse alusel"}
                  </div>
                </>
              );
            })() : (() => {
              const selectedBasis = r.allocationBasis || "m2";
              const needsWarning = selectedBasis !== "m2" && getEffectiveRowAllocationBasis(r) === "m2";
              return (
                <>
                  <select
                    value={selectedBasis}
                    onChange={(e) => updateRow("COST", r.id, { allocationBasis: e.target.value })}
                    style={{ ...selectStyle, width: "100%" }}
                  >
                    <option value="m2">m²</option>
                    <option value="apartment">korter</option>
                  </select>
                  <div style={{ fontSize: 12, color: N.dim, marginTop: 4 }}>
                    {selectedBasis === "apartment" ? "Korteri kohta" : "Kaasomandi osa suuruse alusel"}
                  </div>
                  {needsWarning && (
                    <div style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>
                      Õiguslik alus märkimata — arvutuses rakendatakse seadusjärgset alust (m²).
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {!hideRemove && (
            <div style={{ alignSelf: "end", marginLeft: "auto" }}>
              <button style={btnRemove} onClick={() => removeRow("COST", r.id)}>Eemalda rida</button>
            </div>
          )}
        </div>

        {HALDUSTEENUSED.includes(r.category) && renderPolicyException("maintenance")}

        {!isKommunaal && !LAENUMAKSED.includes(r.category) && r.fundingSource === "remondifond" && (
          <div style={{ marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: N.sub, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={r.recursNextPeriod || false}
                onChange={(e) => updateRow("COST", r.id, { recursNextPeriod: e.target.checked })}
              />
              <span>Kordub järgmises perioodis</span>
            </label>
            {r.recursNextPeriod && (
              <div style={{ marginTop: 4, marginLeft: 24 }}>
                <div style={{ ...fieldLabel, marginBottom: 4 }}>Järgmise perioodi summa (€) — tühi = sama mis praegu</div>
                <EuroInput
                  value={r.nextPeriodAmount ?? ""}
                  onChange={(v) => updateRow("COST", r.id, { nextPeriodAmount: v > 0 ? v : null })}
                  placeholder="Sama mis praegu"
                  style={numStyle}
                />
              </div>
            )}
          </div>
        )}

        {isKommunaal && (
          <div style={{ marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: N.sub, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={r.settledPostHoc || false}
                onChange={(e) => updateRow("COST", r.id, { settledPostHoc: e.target.checked })}
              />
              <span>Tasumine pärast kulude suuruse selgumist</span>
            </label>
            <div style={{ fontSize: 12, color: N.dim, marginTop: 4, marginLeft: 24 }}>
              Kui põhikirja või korteriomanike kokkuleppega on ette nähtud tegelikust tarbimisest sõltuvate kulude tasumine pärast kulude suuruse selgumist, määratakse majanduskavas kindlaks ainult muud kulud (näiteks haldus-, hooldus-, remondi- ja reservkulud).
            </div>
            {r.settledPostHoc && (
              <div style={{ fontSize: 13, color: N.sub, marginTop: 4, marginLeft: 24 }}>
                See kulu ei lähe kuumakse ettemaksu hulka.
              </div>
            )}
            {(r.settledPostHoc || r.allocationBasis !== "m2") && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: N.dim, marginBottom: 6 }}>
                  Seadusjärgsest erinev kord peab tuginema põhikirjale või korteriomanike kokkuleppele.
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: N.sub, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={r.legalBasisBylaws || false}
                      onChange={(e) => updateRow("COST", r.id, { legalBasisBylaws: e.target.checked })}
                    />
                    <span>Põhikirjas</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: N.sub, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={r.legalBasisSpecialAgreement || false}
                      onChange={(e) => updateRow("COST", r.id, { legalBasisSpecialAgreement: e.target.checked })}
                    />
                    <span>Kokkuleppes</span>
                  </label>
                </div>
                {r.settledPostHoc && !r.legalBasisBylaws && !r.legalBasisSpecialAgreement && (
                  <div style={{ fontSize: 12, color: N.sub, marginTop: 4 }}>
                    Kontrolli, kas see kord on põhikirjas või kokkuleppes ette nähtud.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px dashed ${N.rule}` }}>
          {(() => {
            const isOpen = openCostExplanationId === r.id;
            if (!r.selgitus && !isOpen) {
              return (
                <button
                  type="button"
                  onClick={() => setOpenCostExplanationId(r.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: N.sub, textDecoration: "underline", padding: 0 }}
                >
                  Lisa selgitus (valikuline)
                </button>
              );
            }
            return (
              <>
                <textarea
                  value={r.selgitus || ""}
                  onChange={(e) => updateRow("COST", r.id, { selgitus: e.target.value })}
                  onBlur={(e) => {
                    const norm = normalizeIfChanged(e.target.value, (next) => updateRow("COST", r.id, { selgitus: next }));
                    if (!norm) setOpenCostExplanationId(null);
                  }}
                  placeholder="Selgitus (valikuline)"
                  rows={2}
                  autoFocus={isOpen && !r.selgitus}
                  style={{ ...inputBase, width: "100%", height: "auto", minHeight: 56, padding: "8px 12px", fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }}
                />
              </>
            );
          })()}
        </div>

        {/* Kindlustuse vihje */}
        {r.category === "Kindlustus" && (() => {
          const onKindlustus = (parseFloat(r.summaInput) || 0) > 0;
          const onPlaneeritudLaen = remondifondiArvutus.onLaen;
          if (onKindlustus && onPlaneeritudLaen)
            return <div style={{ fontSize: 14, color: N.sub, marginTop: 8 }}>Uue pangalaenu kavandamisel on soovitatav planeerida kindlustuskulud vähemalt 20% kõrgemana, kuna pank nõuab üldjuhul laiendatud koguriskikindlustust.</div>;
          if (!onKindlustus && onPlaneeritudLaen)
            return <div style={{ fontSize: 14, color: "#c53030", fontWeight: 500, marginTop: 8 }}>Pangalaenu taotlemisel on kindlustus kohustuslik. Lisage kindlustuskulu.</div>;
          if (!onKindlustus && !onPlaneeritudLaen)
            return <div style={{ fontSize: 14, color: N.dim, marginTop: 8 }}>Kindlustus on korteriühistu vara kaitseks soovitatav.</div>;
          return null;
        })()}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: N.bg, fontSize: 14, fontWeight: 400, color: N.text, lineHeight: 1.5, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* -- Sidebar -- */}
      <aside style={{
        width: 230, minWidth: 230, background: N.sidebar,
        display: "flex", flexDirection: "column",
        borderRight: `1px solid ${N.border}`,
      }}>
        <div style={{ padding: "24px 16px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#ddd" }}>Majanduskava</div>
          {kyData.nimi?.trim() && (
            <div style={{ fontSize: 13, color: "#bbb", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kyData.nimi.trim()}</div>
          )}
          <div style={{ fontSize: 14, color: N.sub, marginTop: 4 }}>{plan.period.start && plan.period.end ? formatDateEE(plan.period.start) + "–" + formatDateEE(plan.period.end) : plan.period.start ? formatDateEE(plan.period.start) : ""}</div>
        </div>

        <div style={{ padding: "8px 0", flex: 1 }}>
          {SECS.map((name, i) => {
            const dotColor = tabStatus[i] === "valid" ? "#4caf50" : tabStatus[i] === "invalid" ? "#e53935" : "#555";
            const dotLabel = tabStatus[i] === "valid" ? "Korras" : tabStatus[i] === "invalid" ? "Vajab täiendamist" : "Alustamata";
            return (
              <button
                key={name}
                onClick={() => setSec(i)}
                style={{
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left",
                  background: sec === i ? "rgba(255,255,255,0.05)" : "transparent",
                  border: "none",
                  borderLeft: sec === i ? "3px solid #222" : "3px solid transparent",
                  padding: "12px 16px",
                  fontSize: 14, cursor: "pointer",
                  color: sec === i ? "#ddd" : "#888",
                  fontWeight: sec === i ? 600 : 400,
                }}
              >
                <span>{name}</span>
                <span
                  aria-label={tabStatus[i]}
                  title={tabStatus[i]}
                  style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0, marginLeft: 8 }}
                />
              </button>
            );
          })}
        </div>
      </aside>

      <main style={{ flex: 1, padding: 32, overflowY: "auto", maxWidth: 880, boxSizing: "border-box", position: "relative" }}>

        {/* ── Koondvaade — nähtav alates Tab 2 ── */}
        {(sec === 4) && (() => {
          const haldusA = plan.budget.costRows
            .filter(r => HALDUSTEENUSED.includes(r.category))
            .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const kommunaalA = plan.budget.costRows
            .filter(r => KOMMUNAALTEENUSED.includes(r.category))
            .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const laenuA = plan.budget.costRows
            .filter(r => LAENUMAKSED.includes(r.category))
            .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const naitaKoondribana = haldusA > 0 || kommunaalA > 0 || laenuA > 0;
          if (!naitaKoondribana) return null;
          const kvNum = { fontFamily: "monospace", fontWeight: 600, fontSize: 14 };
          const kvLabel = { fontSize: 14, color: N.sub, minWidth: 110 };
          const kvSep = { color: N.border, margin: "0 6px", fontSize: 14 };
          const rowStyle = { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" };
          return (
            <div style={{
              padding: "8px 14px", marginBottom: 16, borderRadius: 8,
              background: N.surface, border: `1px solid ${N.border}`, fontSize: 14,
            }}>
              <div style={rowStyle}>
                <span style={kvLabel}>Haldusteenused</span> <span style={kvNum}>{euro(haldusA)}</span>
                <span style={kvSep}>|</span>
                <span style={{ ...kvLabel, opacity: 0.6 }}>Kommunaalteenused</span> <span style={{ ...kvNum, opacity: 0.6 }}>{euro(kommunaalA)}</span>
                {laenuA > 0 && (
                  <>
                    <span style={kvSep}>|</span>
                    <span style={kvLabel}>Laenumaksed</span> <span style={kvNum}>{euro(laenuA)}</span>
                  </>
                )}
                <span style={kvSep}>|</span>
                <span style={kvLabel}>Kokku</span> <span style={kvNum}>{euro(haldusA + kommunaalA + laenuA)}</span>
              </div>
            </div>
          );
        })()}

        {sec === 0 && (
          <div style={tabStack}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(0)}</div>
            <h1 style={H1_STYLE}>Üldandmed</h1>

            {/* KÜ andmed */}
            <div style={card}>
              <div style={{ ...H2_STYLE, marginTop: 0 }}>Korteriühistu andmed</div>
              <div style={{ marginBottom: 12, background: "#fdf8ee", border: "1px dashed #c5a84d", borderRadius: 8, padding: "10px 12px" }}>
                <AddressSearch
                  value={kyData.aadress}
                  onChange={(addr) => setKyData(prev => ({ ...prev, aadress: addr }))}
                  onApartmentsLoaded={handleApartmentsLoaded}
                  onAddressSelected={(addr) => setKyData(prev => prev.kyAadressEdited ? prev : { ...prev, kyAadress: addr })}
                />
                <div style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>Ajutine EHR aadress läbimänguks. Hiljem peidetakse.</div>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                <div style={{ flex: "1 1 180px" }}>
                  <div style={fieldLabel}>Registrikood</div>
                  <input type="text" value={kyData.registrikood} onChange={(e) => setKyData(prev => ({ ...prev, registrikood: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ flex: "1 1 180px" }}>
                  <div style={fieldLabel}>KÜ nimi</div>
                  <input type="text" value={kyData.nimi} onChange={(e) => setKyData(prev => ({ ...prev, nimi: e.target.value }))} style={inputStyle} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={fieldLabel}>KÜ aadress</div>
                <input type="text" value={kyData.kyAadress} onChange={(e) => setKyData(prev => ({ ...prev, kyAadress: e.target.value, kyAadressEdited: true }))} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                  <div style={{ ...fieldLabel, display: "flex", alignItems: "center", gap: 4 }}>
                    Korteriomandite pindala kokku (m²)
                    <span style={{ position: "relative", display: "inline-flex" }}
                      onMouseEnter={() => setTab0PindalaInfoOpen(true)}
                      onMouseLeave={() => setTab0PindalaInfoOpen(false)}>
                      <button onClick={() => setTab0PindalaInfoOpen(v => !v)} aria-label="Näita selgitust"
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 16, height: 16, borderRadius: "50%", border: `1px solid ${N.border}`,
                          background: N.surface, fontSize: 11, color: N.dim, cursor: "help",
                          padding: 0, fontWeight: 600, fontStyle: "italic", flexShrink: 0, lineHeight: 1 }}>i</button>
                      {tab0PindalaInfoOpen && (
                        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20,
                          background: N.surface, border: `1px solid ${N.border}`, borderRadius: 8,
                          padding: "10px 14px", fontSize: 13, color: N.text, width: 320,
                          boxShadow: "0 4px 16px rgba(0,0,0,0.10)", lineHeight: 1.55, fontWeight: 400 }}>
                          Korteriomandite pindalaandmed on võetud EHR-ist. Kulude jaotuse õiguslik alus on kaasomandi osa suurus. Pindalaandmeid kasutatakse siin ainult arvutusliku abinäitajana. Vajadusel kontrolli andmed Kinnistusraamatust üle ja paranda käsitsi.
                        </div>
                      )}
                    </span>
                  </div>
                  <div style={fieldLabel}>Korteriomandite arv</div>
                  <NumberInput value={kyData.suletudNetopind} onChange={(v) => setKyData(prev => ({ ...prev, suletudNetopind: v }))} style={numStyle} />
                  <NumberInput value={kyData.korteriteArv} onChange={(v) => setKyData(prev => ({ ...prev, korteriteArv: v === "" || v == null ? "" : String(Math.max(0, Math.round(Number(v) || 0))) }))} style={numStyle} />
                  {kyData.ehrPind != null && String(kyData.suletudNetopind) !== String(kyData.ehrPind) &&
                    <button onClick={() => setKyData(prev => ({ ...prev, suletudNetopind: prev.ehrPind }))} style={{ gridColumn: "1", fontSize: 12, color: N.sub, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", textAlign: "left" }}>Taasta EHR väärtus</button>}
                  {kyData.ehrArv != null && String(kyData.korteriteArv) !== String(kyData.ehrArv) &&
                    <button onClick={() => setKyData(prev => ({ ...prev, korteriteArv: prev.ehrArv }))} style={{ gridColumn: "2", fontSize: 12, color: N.sub, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", textAlign: "left" }}>Taasta EHR väärtus</button>}
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={{ ...H2_STYLE, marginTop: 0 }}>Majanduskava periood</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, alignItems: "flex-start" }}>
                <div>
                  <div style={{ ...fieldLabel, display: "flex", alignItems: "center", gap: 4 }}>
                    Majandusaasta
                    <span style={{ position: "relative", display: "inline-flex" }}
                      onMouseEnter={() => setTab0PerioodInfoOpen(true)}
                      onMouseLeave={() => setTab0PerioodInfoOpen(false)}>
                      <button onClick={() => setTab0PerioodInfoOpen(v => !v)} aria-label="Näita selgitust"
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 16, height: 16, borderRadius: "50%", border: `1px solid ${N.border}`,
                          background: N.surface, fontSize: 11, color: N.dim, cursor: "help",
                          padding: 0, fontWeight: 600, fontStyle: "italic", flexShrink: 0, lineHeight: 1 }}>i</button>
                      {tab0PerioodInfoOpen && (
                        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20,
                          background: N.surface, border: `1px solid ${N.border}`, borderRadius: 8,
                          padding: "10px 14px", fontSize: 13, color: N.text, width: 320,
                          boxShadow: "0 4px 16px rgba(0,0,0,0.10)", lineHeight: 1.55, fontWeight: 400 }}>
                          Majanduskava võib vajaduse korral kehtestada ka tagasiulatuvalt, kuid varasema perioodi maksed muutuvad sissenõutavaks kõige varem alates üldkoosoleku otsusest, millega majanduskava kehtestati.
                        </div>
                      )}
                    </span>
                  </div>
                  <select
                    value={(() => {
                      const s = plan.period.start, e = plan.period.end;
                      if (s && e && s.endsWith("-01-01") && e.endsWith("-12-31") && s.slice(0,4) === e.slice(0,4)) return s.slice(0,4);
                      return "";
                    })()}
                    onChange={(e) => {
                      const y = e.target.value;
                      setPlan(p => ({ ...p, period: { ...p.period, start: `${y}-01-01`, end: `${y}-12-31`, year: Number(y) } }));
                    }}
                    style={{ ...selectStyle, appearance: "auto" }}
                  >
                    <option value="" disabled>Vali aasta…</option>
                    {[2024,2025,2026,2027,2028,2029,2030,2031,2032,2033,2034,2035].map(y => (
                      <option key={y} value={String(y)}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 180px" }}>
                  <div style={fieldLabel}>Algus</div>
                  <DateInput
                    value={plan.period.start || ""}
                    onChange={(iso) => {
                      const y = iso ? Number(iso.slice(0,4)) : plan.period.year;
                      setPlan(p => ({ ...p, period: { ...p.period, start: iso, year: y || p.period.year } }));
                    }}
                    style={inputStyle}
                    placeholder=""
                  />
                </div>
                <div style={{ flex: "1 1 180px" }}>
                  <div style={fieldLabel}>Lõpp</div>
                  <DateInput
                    value={plan.period.end || ""}
                    onChange={(iso) => {
                      setPlan(p => ({ ...p, period: { ...p.period, end: iso } }));
                    }}
                    style={inputStyle}
                    placeholder=""
                  />
                </div>
              </div>
              <div style={{ ...helperText, marginTop: 8, textAlign: "justify" }}>Vajadusel muuda kuupäevi käsitsi</div>
              {plan.period.start && plan.period.end && (
                <div style={{ ...helperText, marginTop: 8 }}>
                  {formatDateEE(plan.period.start)} – {formatDateEE(plan.period.end)}
                </div>
              )}
              {plan.period.start && plan.period.end &&
                plan.period.start > plan.period.end && (
                <div style={{ marginTop: 8, fontSize: 14, color: "#c53030" }}>
                  Alguskuupäev on hilisem kui lõppkuupäev
                </div>
              )}
            </div>

          </div>
        )}

        {sec === 1 && (
          <div style={tabStack}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(1)}</div>
            <h1 style={H1_STYLE}>Ülevaade kaasomandi eseme seisukorrast ja kavandatavatest toimingutest</h1>
            <div style={card}>
              <div style={{ ...H2_STYLE, marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
                Kaasomandi ese
                <span
                  style={{ position: "relative", display: "inline-flex" }}
                  onMouseEnter={() => setTab1InfoOpen(true)}
                  onMouseLeave={() => setTab1InfoOpen(false)}
                >
                  <button
                    onClick={() => setTab1InfoOpen(v => !v)} aria-label="Näita selgitust"
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: "50%", border: `1px solid ${N.border}`, background: N.surface, fontSize: 11, color: N.dim, cursor: "help", padding: 0, fontWeight: 600, fontStyle: "italic", flexShrink: 0, lineHeight: 1 }}
                  >i</button>
                  {tab1InfoOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20, background: N.surface, border: `1px solid ${N.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: N.text, width: 340, boxShadow: "0 4px 16px rgba(0,0,0,0.10)", lineHeight: 1.55, fontWeight: 400 }}>
                      Kirjelda siin maja ühiste osade seisukorda ja nendega seotud kavandatavaid töid. Korteri sees olevaid puudusi siia ei lisata, välja arvatud juhul, kui need puudutavad maja ühist osa või ühist tehnosüsteemi, näiteks torustikku, küttesüsteemi või ventilatsiooni.
                    </div>
                  )}
                </span>
              </div>

              {seisukord.map((rida) => {
                const sy = plan.period.start ? Number(plan.period.start.slice(0, 4)) : null;
                const ey = plan.period.end ? Number(plan.period.end.slice(0, 4)) : null;
                const isMultiYear = Boolean(sy && ey && ey > sy);
                const periodYears = isMultiYear ? Array.from({ length: ey - sy + 1 }, (_, i) => sy + i) : [];
                const effectiveAasta = isMultiYear
                  ? (rida.tegevusAasta && Number(rida.tegevusAasta) >= sy && Number(rida.tegevusAasta) <= ey
                      ? rida.tegevusAasta : String(sy))
                  : rida.tegevusAasta;
                const isAktiivne = Boolean(rida.ese);
                const rb = (empty) => isAktiivne && empty ? { border: "1px solid #fca5a5" } : {};
                return (
                  <div key={rida.id} style={{ border: `1px solid ${N.rule}`, borderRadius: 8, padding: 12, marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={fieldLabel}>Nimetus</div>
                        <select value={rida.ese} onChange={(e) => uuendaSeisukord(rida.id, "ese", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                          <option value="">Vali…</option>
                          {ESEMED.map(e => <option key={e} value={e}>{e}</option>)}
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={fieldLabel}>Seisukord</div>
                        <select value={rida.seisukordVal} onChange={(e) => uuendaSeisukord(rida.id, "seisukordVal", e.target.value)} style={{ ...selectStyle, width: "100%", ...rb(!rida.seisukordVal) }}>
                          <option value="">Vali…</option>
                          {SEISUKORD_VALIKUD.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={fieldLabel}>Prioriteet</div>
                        <select value={rida.prioriteet} onChange={(e) => uuendaSeisukord(rida.id, "prioriteet", e.target.value)} style={{ ...selectStyle, width: "100%", ...rb(!rida.prioriteet) }}>
                          <option value="">Vali…</option>
                          {PRIORITEEDID.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={fieldLabel}>Puudused</div>
                        <AutoGrowTextarea placeholder={PUUDUSED_PLACEHOLDERS[rida.ese] || "nt kirjelda kaasomandi eseme puudus"} value={rida.puudused}
                          onChange={(e) => uuendaSeisukord(rida.id, "puudused", e.target.value)}
                          onBlur={(e) => normalizeIfChanged(e.target.value, (next) => uuendaSeisukord(rida.id, "puudused", next))}
                          style={{ ...inputStyle, minHeight: 38, padding: "8px 12px", lineHeight: 1.4, ...rb(!rida.puudused?.trim()) }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={fieldLabel}>Kavandatav toiming</div>
                        <AutoGrowTextarea placeholder={TEGEVUS_PLACEHOLDERS[rida.ese] || "nt kirjelda kavandatav toiming"} value={rida.tegevus}
                          onChange={(e) => uuendaSeisukord(rida.id, "tegevus", e.target.value)}
                          onBlur={(e) => normalizeIfChanged(e.target.value, (next) => uuendaSeisukord(rida.id, "tegevus", next))}
                          style={{ ...inputStyle, minHeight: 38, padding: "8px 12px", lineHeight: 1.4, ...rb(!rida.tegevus?.trim()) }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <div style={{ flex: "0 1 200px" }}>
                        <div style={fieldLabel}>Eeldatav maksumus (€)</div>
                        <EuroInput value={rida.eeldatavKulu} onChange={(v) => uuendaSeisukord(rida.id, "eeldatavKulu", v)} style={{ ...numStyle, ...rb(!(Number(rida.eeldatavKulu) > 0)) }} />
                      </div>
                      {isMultiYear && (
                        <div style={{ flex: "0 1 140px", minWidth: 90 }}>
                          <div style={fieldLabel}>Aasta</div>
                          <select value={effectiveAasta} onChange={(e) => uuendaSeisukord(rida.id, "tegevusAasta", e.target.value)} style={{ ...selectStyle, width: "100%", ...rb(!rida.tegevusAasta) }}>
                            {periodYears.map(y => <option key={y} value={String(y)}>{y}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {seisukord.length <= 1
                        ? <button style={btnRemove} onClick={() => {
                            if (!seisukordRidaOnAndmeid(rida)) { tühjendaSeisukordRida(rida.id); return; }
                            askConfirm("Kas oled kindel, et soovid selle kaasomandi eseme andmed kustutada?", "Kustuta", () => tühjendaSeisukordRida(rida.id));
                          }}>Tühjenda</button>
                        : <button style={btnRemove} onClick={() => {
                            if (!seisukordRidaOnAndmeid(rida)) { eemaldaSeisukordRida(rida.id); return; }
                            askConfirm("Kas oled kindel, et soovid selle kaasomandi eseme andmed kustutada?", "Kustuta", () => eemaldaSeisukordRida(rida.id));
                          }}>Eemalda ese</button>
                      }
                    </div>
                  </div>
                );
              })}

              <div style={{ marginTop: 8 }}>
                <button style={btnAdd} onClick={lisaSeisukordRida}>+ Lisa ese</button>
              </div>
            </div>

          </div>
        )}

        {sec === 2 && (() => {
          const HALDUS_UI_KULULIIGID = HALDUSTEENUSED.filter(c => !["Haldus", "Hooldus", "Muu haldusteenus"].includes(c));
          const MUUD_MAJANDAMISKULUD_KATEGORIAD = ["Ekspertiis", "Energiaaudit", "Projekt", "Jooksev remont", "Muu majandamiskulu"];

          const kommunaalRead = plan.budget.costRows.filter(r => P5_KOMMUNAALTEENUSED.includes(r.category));
          const komSum = kommunaalRead.reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const tab2KuluAllRows = plan.budget.costRows.filter(r => !KOMMUNAALTEENUSED.includes(r.category));
          const haldusRead = tab2KuluAllRows.filter(r =>
            HALDUSTEENUSED.includes(r.category) ||
            (r.category === "" && r._inSection === "haldus")
          );
          const muudRead = tab2KuluAllRows.filter(r =>
            !KOMMUNAALTEENUSED.includes(r.category) &&
            !HALDUSTEENUSED.includes(r.category) &&
            !LAENUMAKSED.includes(r.category) &&
            !(r.category === "" && r._inSection === "haldus")
          );
          const groupLabel = { fontSize: 12, fontWeight: 600, color: N.sub, textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 0 0", marginTop: 8 };

          const tab2KuluRida = (r, kululiigid) => {
            const basis = r.allocationBasis || "m2";
            const isErand = basis === "apartment" || basis === "muu";
            const taepsustusPlaceholder = r.legalBasisBylaws ? "Nt põhikirja punkt" : r.legalBasisSpecialAgreement ? "Nt kokkuleppe kirjeldus" : r.legalBasisMuu ? "Nt muu õiguslik alus või selgitus" : "Lisa täpsustus";
            const isMarkusOpen2 = !!r.selgitus || openTab2TaepsustusId === r.id;
            const isMuuTeenus = r.category === "Muu teenus" || r.category === "Muu haldusteenus";
            return (
              <div key={r.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ width: 200 }}>
                    <div style={fieldLabel}>Kululiik</div>
                    <select value={r.category || ""} onChange={(e) => updateRow("COST", r.id, { category: e.target.value })} style={{ ...selectStyle, width: "100%" }}>
                      <option value="" disabled>Vali...</option>
                      {["Haldus", "Hooldus", "Muu haldusteenus"].includes(r.category) && (
                        <option value={r.category}>{r.category}</option>
                      )}
                      {(kululiigid || HALDUS_UI_KULULIIGID).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={fieldLabel}>Nimetus</div>
                    <input value={r.name || ""} onChange={(e) => updateRow("COST", r.id, { name: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateRow("COST", r.id, { name: next }))} placeholder="Kirjelda lühidalt" style={inputStyle} />
                  </div>
                  <div style={{ width: 130 }}>
                    <div style={fieldLabel}>Summa (€/periood)</div>
                    <EuroInput value={r.summaInput} onChange={(v) => updateRow("COST", r.id, { summaInput: v })} style={numStyle} />
                  </div>
                  <div style={{ alignSelf: "end" }}><button style={btnRemove} onClick={() => removeRow("COST", r.id)}>Eemalda kulu</button></div>
                </div>
                {isMuuTeenus && (
                  <div style={{ marginTop: 6 }}>
                    <div style={fieldLabel}>Kirjelda teenust</div>
                    <input value={r.muuTeenusKirjeldus || ""} onChange={(e) => updateRow("COST", r.id, { muuTeenusKirjeldus: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateRow("COST", r.id, { muuTeenusKirjeldus: next }))} placeholder="Kirjelda teenust" style={{ ...inputStyle, width: "100%" }} />
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <div style={fieldLabel}>Kulude jaotuse alus</div>
                  <select value={basis} onChange={(e) => {
                    const v = e.target.value;
                    if (v === "m2") updateRow("COST", r.id, { allocationBasis: "m2", legalBasisBylaws: false, legalBasisSpecialAgreement: false, allocationBasisMuuKirjeldus: "" });
                    else if (v === "apartment") updateRow("COST", r.id, { allocationBasis: "apartment", legalBasisSeadus: false });
                    else updateRow("COST", r.id, { allocationBasis: v });
                  }} style={{ ...selectStyle, width: 220 }}>
                    <option value="m2">Kaasomandi osa suuruse alusel</option>
                    <option value="apartment">Korteri kohta</option>
                    <option value="muu">Muu jaotus</option>
                  </select>
                  {basis === "m2" && <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>Kulu jaotatakse KrtS § 40 lg 1 alusel kaasomandi osa suuruse järgi.</div>}
                  {isErand && (
                    <div style={{ marginTop: 8, padding: 8, background: N.muted, borderRadius: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Erandi alus</div>
                      <label style={{ display: "flex", gap: 6, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={!!r.legalBasisBylaws} onChange={(e) => updateRow("COST", r.id, { "legalBasisBylaws": e.target.checked })} />"Põhikiri"</label>
                      <label style={{ display: "flex", gap: 6, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={!!r.legalBasisSpecialAgreement} onChange={(e) => updateRow("COST", r.id, { "legalBasisSpecialAgreement": e.target.checked })} />"Kokkulepe"</label>
                      <label style={{ display: "flex", gap: 6, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={!!r.legalBasisMuu} onChange={(e) => updateRow("COST", r.id, { "legalBasisMuu": e.target.checked })} />Muu</label>
                      {basis === "muu" && <div style={{ marginTop: 4 }}><div style={fieldLabel}>Jaotuse kirjeldus</div><input value={r.allocationBasisMuuKirjeldus || ""} onChange={(e) => updateRow("COST", r.id, { allocationBasisMuuKirjeldus: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateRow("COST", r.id, { allocationBasisMuuKirjeldus: next }))} placeholder="Kirjelda jaotusviisi" style={{ ...inputStyle, width: "100%" }} /></div>}
                      <div style={{ marginTop: 4 }}><input value={r.legalBasisTaepsustus || ""} onChange={(e) => updateRow("COST", r.id, { legalBasisTaepsustus: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateRow("COST", r.id, { legalBasisTaepsustus: next }))} placeholder={taepsustusPlaceholder} style={{ ...inputStyle, width: "100%" }} /></div>
                    </div>
                  )}
                </div>
                {!isMarkusOpen2 && <button onClick={() => setOpenTab2TaepsustusId(r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6366f1", padding: "4px 0" }}>+ Lisa märkus</button>}
                {isMarkusOpen2 && <div><div style={fieldLabel}>Märkus (valikuline)</div><input value={r.selgitus || ""} onChange={(e) => updateRow("COST", r.id, { selgitus: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateRow("COST", r.id, { selgitus: next }))} style={inputStyle} /></div>}
              </div>
            );
          };
          const existingLoans = plan.loans.filter(l => !l.sepiiriostudInvId);
          const planeeritudLoans = plan.loans.filter(l => !!l.sepiiriostudInvId);
          const loanItems = plan.loans.map(l => ({ id: l.id, name: l.name, basis: l.allocationBasis || "m2" }));
          const haldusSum = plan.budget.costRows.filter(r => HALDUSTEENUSED.includes(r.category)).reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const muudKuluSum = muudRead.reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const muudTuludSum = plan.budget.incomeRows.reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const muuTuluUldkuludeks = plan.budget.incomeRows
            .filter(r => (r.incomeAllocation || "general") === "general")
            .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const korteriomanikeMaksedHalduseks = Math.max(0, haldusSum - muuTuluUldkuludeks);
          const tuludKokku = korteriomanikeMaksedHalduseks + muudTuludSum;
          const laenuPeriood = Math.round(kopiiriondvaade.laenumaksedKokku * (derived.period.monthEq || 12));
          const olemasolevadLaenudPeriood = existingLoans.reduce((s, l) => {
            const lnItem = (derived.loans?.items || []).find(item => item.id === l.id);
            const lnP = parseFloat(l.pohiosPerioodis) || 0;
            const lnIr = parseFloat(l.intressPerioodis) || 0;
            const lnT = parseFloat(l.teenustasudPerioodis) || 0;
            const hasManual = lnP > 0 || lnIr > 0 || lnT > 0;
            return s + (hasManual ? lnP + lnIr + lnT : Math.round(lnItem?.servicingPeriodEUR || 0));
          }, 0);
          return (
            <div style={tabStack}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(2)}</div>
              <h1 style={H1_STYLE}>Kavandatavad tulud ja kulud</h1>

              {/* ── 1. Tulud ── */}
              <div style={card}>
                <div style={{ ...H2_STYLE, marginTop: 0 }}>Tulud</div>
                <div style={{ fontSize: 13, color: N.text, marginBottom: 16 }}>Siia sisestatakse korteriühistu muud tulud. Korteriomanike maksed arvutatakse kavandatud kulude, fondimaksete ja jaotuse aluste põhjal.</div>
                <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 16, marginTop: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: N.text, marginBottom: 8 }}>Muud tulud</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {plan.budget.incomeRows.map(r => {
                      const isMarkusOpenR = !!r.note || openRfMarkusId === ("income_" + r.id);
                      return (
                        <div key={r.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                            <div style={{ width: 180 }}>
                              <div style={fieldLabel}>Kategooria</div>
                              <select value={r.category || ""} onChange={(e) => updateRow("INCOME", r.id, { category: e.target.value })} style={{ ...selectStyle, width: "100%" }}>
                                <option value="" disabled>Vali...</option>
                                {TULU_KATEGORIAD_TAB2.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div style={{ flex: 2, minWidth: 160 }}>
                              <div style={fieldLabel}>Nimetus</div>
                              <input value={r.name || ""} onChange={(e) => updateRow("INCOME", r.id, { name: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateRow("INCOME", r.id, { name: next }))} style={inputStyle} />
                            </div>
                            <div style={{ width: 150 }}>
                              <div style={fieldLabel}>Summa perioodis (€)</div>
                              <EuroInput value={r.summaInput} onChange={(v) => {
                                const updates = { summaInput: v, arvutus: "aastas" };
                                if (r.incomeAllocation === "targeted" && (r.incomeAllocations || []).length > 0) {
                                  const first = r.incomeAllocations[0];
                                  updates.incomeAllocations = [{ id: first.id || crypto.randomUUID(), target: first.target, amount: v }];
                                }
                                updateRow("INCOME", r.id, updates);
                              }} style={numStyle} />
                            </div>
                          </div>
                          {!isMarkusOpenR && <button onClick={() => setOpenRfMarkusId("income_" + r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: N.text, padding: "4px 0" }}>+ Lisa märkus</button>}
                          {isMarkusOpenR && (
                            <div style={{ marginTop: 8 }}>
                              <div style={fieldLabel}>Märkus (valikuline)</div>
                              <input value={r.note || ""} onChange={(e) => updateRow("INCOME", r.id, { note: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateRow("INCOME", r.id, { note: next }))} style={inputStyle} />
                              <button onClick={() => { updateRow("INCOME", r.id, { note: "" }); setOpenRfMarkusId(null); }} style={{ ...btnRemove, marginTop: 4 }}>Eemalda märkus</button>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                            <button style={btnRemove} onClick={() => askConfirm("Kas oled kindel, et soovid selle tulu andmed kustutada?", "Kustuta", () => removeRow("INCOME", r.id))}>Eemalda tulu</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <button style={btnAdd} onClick={() => addRow("INCOME")}>+ Lisa tulu</button>
                  </div>
                  {muudTuludSum > 0 && (
                    <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${N.rule}`, fontSize: 14, display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                      <span>Muud tulud perioodis:</span>
                      <span style={{ fontFamily: "monospace" }}>{euro(muudTuludSum)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── 2. Kulud ── */}
              <div style={card}>
                <div style={{ ...H2_STYLE, marginTop: 0 }}>Kulud</div>
                <div style={{ fontSize: 13, color: N.sub, marginBottom: 16 }}>Kommunaalkulud (soojus, vesi, elekter, kütus) sisestatakse eraldi Kommunaalid plokis.</div>

                {/* ── Haldus- ja hoolduskulud ── */}
                <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 16, marginTop: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: N.text, marginBottom: 8 }}>Haldus- ja hoolduskulud</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {haldusRead.map(r => tab2KuluRida(r, HALDUS_UI_KULULIIGID))}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <button style={btnAdd} onClick={() => addRow("COST", { _inSection: "haldus", allocationBasis: "m2", legalBasisSeadus: true })}>+ Lisa halduskulu</button>
                  </div>
                </div>

                {/* ── Muud majandamiskulud ── */}
                <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 16, marginTop: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: N.text, marginBottom: 8 }}>Muud majandamiskulud</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {muudRead.map(r => tab2KuluRida(r, MUUD_MAJANDAMISKULUD_KATEGORIAD))}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <button style={btnAdd} onClick={() => addRow("COST", { allocationBasis: "m2", legalBasisSeadus: true })}>+ Lisa muu kulu</button>
                  </div>
                </div>

                {/* ── Olemasoleva laenu teenindamine ── */}
                <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 16, marginTop: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: N.text, marginBottom: 4 }}>Olemasoleva laenu teenindamine</div>
                  <div style={{ fontSize: 13, color: N.sub, marginBottom: 12 }}>Uue laenu planeerimine toimub eraldi. Siin näidatakse ainult olemasoleva laenu teenindamise kulud.</div>
                  {existingLoans.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {existingLoans.map(ln => {
                        const lnBasis = ln.allocationBasis || "m2";
                        const isLnErand = lnBasis === "apartment" || lnBasis === "muu";
                        const taepsustusPlaceholder = ln.legalBasisBylaws ? "Nt põhikirja punkt" : ln.legalBasisSpecialAgreement ? "Nt kokkuleppe kirjeldus" : ln.legalBasisMuu ? "Nt muu õiguslik alus või selgitus" : "Lisa täpsustus";
                        const lnItem = (derived.loans?.items || []).find(i => i.id === ln.id);
                        const autoKokku = lnItem ? Math.round(lnItem.servicingPeriodEUR || 0) : 0;
                        const lnP = parseFloat(ln.pohiosPerioodis) || 0;
                        const lnIr = parseFloat(ln.intressPerioodis) || 0;
                        const lnT = parseFloat(ln.teenustasudPerioodis) || 0;
                        const hasManual = lnP > 0 || lnIr > 0 || lnT > 0;
                        const kokku = hasManual ? lnP + lnIr + lnT : autoKokku;
                        return (
                          <div key={ln.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                              <div style={{ width: 210 }}>
                                <div style={fieldLabel}>Laenuandja</div>
                                <select value={ln.laenuandja || ""} onChange={(e) => updateLoan(ln.id, { laenuandja: e.target.value, laenuandjaKirjeldus: e.target.value !== "Muu" ? "" : ln.laenuandjaKirjeldus })} style={{ ...selectStyle, width: "100%" }}>
                                  <option value="" disabled>Vali...</option>
                                  <option value="Swedbank">Swedbank</option>
                                  <option value="SEB">SEB</option>
                                  <option value="LHV">LHV</option>
                                  <option value="Coop Pank">Coop Pank</option>
                                  <option value="Bigbank">Bigbank</option>
                                  <option value="KredEx / EIS">KredEx / EIS</option>
                                  <option value="muu pank või krediidiandja">muu pank või krediidiandja</option>
                                  <option value="Muu">Muu</option>
                                </select>
                                {ln.laenuandja === "Muu" && (
                                  <input value={ln.laenuandjaKirjeldus || ""} onChange={(e) => updateLoan(ln.id, { laenuandjaKirjeldus: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateLoan(ln.id, { laenuandjaKirjeldus: next }))} placeholder="Sisesta laenuandja nimi" style={{ ...inputStyle, marginTop: 4, width: "100%" }} />
                                )}
                              </div>
                              <div style={{ width: 210 }}>
                                <div style={fieldLabel}>Eesmärk</div>
                                <select value={ln.eesmärk || ""} onChange={(e) => updateLoan(ln.id, { eesmärk: e.target.value, eesmärkKirjeldus: e.target.value !== "Muu" ? "" : ln.eesmärkKirjeldus })} style={{ ...selectStyle, width: "100%" }}>
                                  <option value="" disabled>Vali...</option>
                                  <option value="renoveerimine">renoveerimine</option>
                                  <option value="katuse remont">katuse remont</option>
                                  <option value="fassaadi remont">fassaadi remont</option>
                                  <option value="küttesüsteemi uuendamine">küttesüsteemi uuendamine</option>
                                  <option value="torustiku vahetus">torustiku vahetus</option>
                                  <option value="elektrisüsteemi uuendamine">elektrisüsteemi uuendamine</option>
                                  <option value="lifti remont / uuendamine">lifti remont / uuendamine</option>
                                  <option value="energiatõhususe töö">energiatõhususe töö</option>
                                  <option value="muu töö">muu töö</option>
                                  <option value="Muu">Muu</option>
                                </select>
                                {ln.eesmärk === "Muu" && (
                                  <input value={ln.eesmärkKirjeldus || ""} onChange={(e) => updateLoan(ln.id, { eesmärkKirjeldus: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateLoan(ln.id, { eesmärkKirjeldus: next }))} placeholder="Kirjelda eesmärki" style={{ ...inputStyle, marginTop: 4, width: "100%" }} />
                                )}
                              </div>
                              <div style={{ alignSelf: "end" }}><button style={btnRemove} onClick={() => removeLoan(ln.id)}>Eemalda laen</button></div>
                            </div>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                              <div style={{ width: 130 }}>
                                <div style={fieldLabel}>Põhiosa perioodis (€)</div>
                                <EuroInput value={ln.pohiosPerioodis || ""} onChange={(v) => updateLoan(ln.id, { pohiosPerioodis: v })} style={numStyle} />
                              </div>
                              <div style={{ width: 130 }}>
                                <div style={fieldLabel}>Intress perioodis (€)</div>
                                <EuroInput value={ln.intressPerioodis || ""} onChange={(v) => updateLoan(ln.id, { intressPerioodis: v })} style={numStyle} />
                              </div>
                              <div style={{ width: 130 }}>
                                <div style={{ ...fieldLabel, display: "flex", alignItems: "center" }}>Teenustasud perioodis (€)<InfoTooltip text="Näited: lepingu haldustasu, kontohaldustasu, laenu administreerimise tasu, maksegraafiku või lepingu muutmise tasu, maksepuhkuse vormistamise tasu, ennetähtaegse tagastamise tasu, muu laenulepingust tulenev teenustasu." /></div>
                                <EuroInput value={ln.teenustasudPerioodis || ""} onChange={(v) => updateLoan(ln.id, { teenustasudPerioodis: v })} style={numStyle} />
                              </div>
                              <div style={{ width: 120 }}>
                                <div style={fieldLabel}>Kokku (€)</div>
                                <div style={{ padding: "6px 8px", background: N.muted, borderRadius: 4, fontFamily: "monospace", fontSize: 14, border: `1px solid ${N.border}` }}>{euro(kokku)}</div>
                              </div>
                            </div>
                            <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>Täidetakse majanduskava perioodi kohta, mitte kogu laenu kohta.</div>
                            <div style={{ marginTop: 8 }}>
                              <div style={fieldLabel}>Tehniline jaotusviis</div>
                              <select value={lnBasis} onChange={(e) => {
                                const v = e.target.value;
                                if (v === "m2") updateLoan(ln.id, { allocationBasis: "m2", legalBasisBylaws: false, legalBasisSpecialAgreement: false, allocationBasisMuuKirjeldus: "" });
                                else if (v === "apartment") updateLoan(ln.id, { allocationBasis: "apartment", legalBasisSeadus: false });
                                else updateLoan(ln.id, { allocationBasis: v });
                              }} style={{ ...selectStyle, width: 260 }}>
                                <option value="m2">Kaasomandi osa / m² arvestus</option>
                                <option value="apartment">Korteri kohta (võrdsed osad)</option>
                                <option value="muu">Muu jaotus</option>
                              </select>
                              {lnBasis === "m2" && <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>Õiguslik alus: Seadus (KrtS § 40 lg 1).</div>}
                              {isLnErand && (
                                <div style={{ marginTop: 8, padding: 8, background: N.muted, borderRadius: 6 }}>
                                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Õiguslik alus</div>
                                  <label style={{ display: "flex", gap: 6, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={!!ln.legalBasisBylaws} onChange={(e) => updateLoan(ln.id, { legalBasisBylaws: e.target.checked })} />"Põhikiri"</label>
                                  <label style={{ display: "flex", gap: 6, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={!!ln.legalBasisSpecialAgreement} onChange={(e) => updateLoan(ln.id, { legalBasisSpecialAgreement: e.target.checked })} />"Kokkulepe"</label>
                                  <label style={{ display: "flex", gap: 6, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={!!ln.legalBasisMuu} onChange={(e) => updateLoan(ln.id, { legalBasisMuu: e.target.checked })} />Muu</label>
                                  {lnBasis === "muu" && <div style={{ marginTop: 4 }}><div style={fieldLabel}>Jaotuse kirjeldus</div><input value={ln.allocationBasisMuuKirjeldus || ""} onChange={(e) => updateLoan(ln.id, { allocationBasisMuuKirjeldus: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateLoan(ln.id, { allocationBasisMuuKirjeldus: next }))} placeholder="Kirjelda jaotusviisi" style={{ ...inputStyle, width: "100%" }} /></div>}
                                  <div style={{ marginTop: 4 }}><input value={ln.legalBasisTaepsustus || ""} onChange={(e) => updateLoan(ln.id, { legalBasisTaepsustus: e.target.value })} onBlur={(e) => normalizeIfChanged(e.target.value, (next) => updateLoan(ln.id, { legalBasisTaepsustus: next }))} placeholder={taepsustusPlaceholder} style={{ ...inputStyle, width: "100%" }} /></div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <button style={btnAdd} onClick={addExistingLoan}>+ Lisa olemasolev laen</button>
                  </div>
                  {planeeritudLoans.length > 0 && (
                    <div style={{ marginTop: 12, fontSize: 13, color: N.sub }}>
                      {planeeritudLoans.length} planeeritud uut laenu kajastatakse investeeringute tabis.
                    </div>
                  )}
                </div>

                {/* ── Kulud kokkuvõte ── */}
                <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 16, marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: N.sub, marginBottom: 8 }}>Kulud kokkuvõte</div>
                  <div style={{ fontSize: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace" }}>
                      <span style={{ color: N.sub }}>Haldus- ja hoolduskulud:</span>
                      <span>{euro(haldusSum)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace" }}>
                      <span style={{ color: N.sub }}>Muud majandamiskulud:</span>
                      <span>{euro(muudKuluSum)}</span>
                    </div>
                    {olemasolevadLaenudPeriood > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace" }}>
                        <span style={{ color: N.sub }}>Laenu teenindamine:</span>
                        <span>{euro(olemasolevadLaenudPeriood)}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${N.rule}`, paddingTop: 8, marginTop: 4, fontWeight: 600, fontFamily: "monospace" }}>
                      <span>Kulud kokku perioodis:</span>
                      <span>{euro(haldusSum + muudKuluSum + olemasolevadLaenudPeriood)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: N.sub, marginTop: 4 }}>
                      Kommunaalkulud kajastatakse eraldi Kommunaalid tabis.
                    </div>
                  </div>
                </div>
              </div>

            </div>
          );
        })()}

        {sec === 4 && (
          <div style={tabStack}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(4)}</div>

            {/* ── Pealkirja rida (ühtne teiste tabidega) ── */}
            <h1 style={H1_STYLE}>Reservkapitali ja remondifondi tehtavate maksete suurus</h1>

            {(() => {
              const ra = remondifondiArvutus;
              const rfBasis = plan.allocationPolicies?.remondifond?.defaultBasis;
              const rfSelectVal = rfBasis === "apartment" ? "apartment" : rfBasis === "muu" ? "muu" : "kaasomand";
              const isRfErand = rfSelectVal !== "kaasomand";
              const rfPolicy = plan.allocationPolicies?.remondifond || {};
              const aptCount = plan.building.apartments.length;
              const mEq = derived.period.monthEq || 12;
              const koguPind = derived.building.totAreaM2 || 0;
              const soovitudSaldo = parseFloat(String(remondifond.soovitudSaldoLopp || "").replace(",", ".")) || null;
              const hasSoovitud = soovitudSaldo != null && soovitudSaldo > 0;
              const diff = hasSoovitud ? ra.saldoLopp - soovitudSaldo : null;
              let soovituslikMaar = null;
              if (hasSoovitud && diff < 0) {
                const neededLaekumine = soovitudSaldo - ra.saldoAlgus - ra.fondiMuuTulu + ra.remondifondistKaetavadKokku;
                if (rfSelectVal === "kaasomand" && koguPind > 0) {
                  soovituslikMaar = neededLaekumine / (koguPind * mEq);
                } else if (rfSelectVal === "apartment" && aptCount > 0) {
                  soovituslikMaar = neededLaekumine / (aptCount * mEq);
                }
              }
              const rfCard = { background: N.surface, borderRadius: 8, padding: 16, marginBottom: 16, border: `1px solid ${N.border}` };
              return (
                <>
                  <div style={rfCard}>
                    <div style={{ ...H2_STYLE, marginTop: 0, marginBottom: 12 }}>Remondifond</div>

                    {/* ── Saldo perioodi alguses ── */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={fieldLabel}>Saldo perioodi alguses</div>
                      <div style={{ width: 160 }}>
                        <EuroInput
                          value={remondifond.saldoAlgus}
                          onChange={(v) => { setRemondifond(p => ({ ...p, saldoAlgus: v })); setRepairFundSaldo(v); }}
                          placeholder="Fondi jääk"
                          style={numStyle}
                        />
                      </div>
                    </div>

                    {/* ── Kulude jaotuse alus ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 8, paddingTop: 12, marginBottom: 12 }}>
                      <div style={H3_STYLE}>Kulude jaotuse alus</div>
                      <select
                        value={rfSelectVal}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "kaasomand") {
                            patchRfPolicy({ defaultBasis: "kaasomand", legalBasisBylaws: false, legalBasisSpecialAgreement: false, legalBasisMuu: false, legalBasisTaepsustus: "", allocationBasisMuuKirjeldus: "" });
                          } else {
                            patchRfPolicy({ defaultBasis: v });
                          }
                        }}
                        style={{ ...selectStyle, width: "100%", maxWidth: 320 }}
                      >
                        <option value="kaasomand">Kaasomandi osa suuruse alusel</option>
                        <option value="apartment">Korteri kohta (€/korter/kuu)</option>
                        <option value="muu">Muu jaotusviis</option>
                      </select>
                      {rfSelectVal === "kaasomand" && (
                        <div style={{ fontSize: 13, color: N.dim, marginTop: 6 }}>
                          Kulu jaotatakse KrtS § 40 lg 1 alusel kaasomandi osa suuruse järgi.
                        </div>
                      )}

                      {rfSelectVal === "kaasomand" && (
                        <div style={{ marginTop: 12 }}>
                          <div style={fieldLabel}>Remondifondi makse määr</div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <NumberInput
                              value={remondifond.maarOverride ?? ""}
                              onChange={(v) => setRemondifond(p => ({ ...p, maarOverride: v > 0 ? v : null }))}
                              style={{ ...numStyle, width: 100 }}
                              placeholder="0,00"
                            />
                            <span style={{ fontSize: 14, color: N.sub }}>€/m²/kuu</span>
                          </div>
                          {koguPind > 0 && ra.laekuminePerioodis > 0 && (
                            <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>
                              Arvutuslik määr: {ra.maarKuusM2.toFixed(4).replace(".", ",")} €/m²/kuu
                            </div>
                          )}
                          <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>
                            Perioodis koguneb: {euroEE(ra.laekuminePerioodis)}
                          </div>
                        </div>
                      )}

                      {rfSelectVal === "apartment" && (
                        <div style={{ marginTop: 12 }}>
                          <div style={fieldLabel}>Remondifondi makse määr (€/korter/kuu)</div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <NumberInput
                              value={remondifond.maarKorterKuu ?? ""}
                              onChange={(v) => setRemondifond(p => ({ ...p, maarKorterKuu: v > 0 ? v : null }))}
                              style={{ ...numStyle, width: 100 }}
                              placeholder="0,00"
                            />
                            <span style={{ fontSize: 14, color: N.sub }}>€/korter/kuu</span>
                          </div>
                          <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>
                            Perioodis koguneb: {euroEE(ra.laekuminePerioodis)}
                          </div>
                        </div>
                      )}

                      {rfSelectVal === "muu" && (
                        <div style={{ marginTop: 12 }}>
                          <div style={fieldLabel}>Planeeritud kogumine perioodis</div>
                          <EuroInput
                            value={remondifond.planeeritudKogumine}
                            onChange={(v) => setRemondifond(p => ({ ...p, planeeritudKogumine: v }))}
                            style={{ ...numStyle, width: 160 }}
                          />
                        </div>
                      )}

                      {isRfErand && (
                        <div style={{ marginTop: 12, padding: 12, background: N.muted, borderRadius: 6 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Erandi alus</div>
                          <label style={{ display: "flex", gap: 8, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={!!rfPolicy.legalBasisBylaws} onChange={(e) => patchRfPolicy({ "legalBasisBylaws": e.target.checked })} />Põhikiri</label>
                          <label style={{ display: "flex", gap: 8, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={!!rfPolicy.legalBasisSpecialAgreement} onChange={(e) => patchRfPolicy({ "legalBasisSpecialAgreement": e.target.checked })} />Erikokkulepe</label>
                          <label style={{ display: "flex", gap: 8, fontSize: 14, cursor: "pointer" }}><input type="checkbox" checked={!!rfPolicy.legalBasisMuu} onChange={(e) => patchRfPolicy({ "legalBasisMuu": e.target.checked })} />Muu alus</label>
                          <div style={{ marginTop: 4 }}>
                            <div style={fieldLabel}>Täpsustus</div>
                            <input value={rfPolicy.legalBasisTaepsustus || ""} onChange={(e) => patchRfPolicy({ legalBasisTaepsustus: e.target.value })} placeholder="Lisa täpsustus" style={{ ...inputStyle, width: "100%" }} />
                          </div>
                          {(rfSelectVal === "muu") && (
                            <div style={{ marginTop: 4 }}>
                              <div style={fieldLabel}>Jaotuse kirjeldus</div>
                              <input value={rfPolicy.allocationBasisMuuKirjeldus || ""} onChange={(e) => patchRfPolicy({ allocationBasisMuuKirjeldus: e.target.value })} placeholder="Kirjelda jaotusviisi" style={{ ...inputStyle, width: "100%" }} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Laenuga: panga soovituse info + koefitsiendi väljad */}
                    {ra.onLaen && (
                      <>
                        <div style={{ fontSize: 14, color: N.dim, background: N.muted, borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
                          Laenuga: panga soovituse info: remondifond ≥ {(remondifond.pangaKoefitsient || 1.15).toFixed(2).replace(".", ",")}× laenumakse.
                        </div>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                          <div style={{ width: 160 }}>
                            <div style={{ ...fieldLabel, fontSize: 14 }}>Pangakoefitsient</div>
                            <NumberInput
                              value={remondifond.pangaKoefitsient}
                              onChange={(v) => setRemondifond(p => ({ ...p, pangaKoefitsient: v || 1.15 }))}
                              style={{ ...numStyle, fontSize: 14 }}
                            />
                          </div>
                          <div style={{ width: 160 }}>
                            <div style={{ ...fieldLabel, fontSize: 14 }}>Käsitsi määr €/m²/a</div>
                            <NumberInput
                              value={remondifond.pangaMaarOverride ?? ""}
                              onChange={(v) => setRemondifond(p => ({ ...p, pangaMaarOverride: v > 0 ? v : null }))}
                              placeholder="Automaatne"
                              style={{ ...numStyle, fontSize: 14 }}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {/* ── Fondist rahastatavad tööd ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 16, paddingTop: 12 }}>
                      <div style={H3_STYLE}>Fondist rahastatavad tööd</div>
                      {seisukord.length === 0 ? (
                        <div style={{ fontSize: 14, color: N.sub, padding: "8px 0" }}>
                          Plaanitud töid ei ole lisatud. Mine{" "}
                          <button
                            onClick={() => setSec(1)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#6366f1", padding: 0 }}
                          >
                            Seisukord ja kavandatavad toimingud
                          </button>
                          {" "}tabisse, et lisada kavandatavad tööd.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {seisukord.map(s => {
                            const usageItem = (plan.funds.repairFund.usageItems || []).find(u => u.linkedAssetConditionId === s.id);
                            const itemAmt = parseFloat(String(usageItem?.remondifondistKaetavSumma || "0").replace(",", ".")) || 0;
                            const eeldatavKulu = parseFloat(String(s.eeldatavKulu || "0").replace(",", ".")) || 0;
                            const isOverBudget = eeldatavKulu > 0 && itemAmt > eeldatavKulu;
                            return (
                              <div key={s.id} style={{ padding: 12, background: N.muted, borderRadius: 6 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                  <div>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: N.text }}>{s.ese || "(nimeta töö)"}</div>
                                    {s.plannedYear && <div style={{ fontSize: 12, color: N.dim }}>{s.plannedYear}</div>}
                                  </div>
                                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
                                    <input
                                      type="checkbox"
                                      checked={!!usageItem}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          addRfUsageItem(mkRfUsageItem({ linkedAssetConditionId: s.id }));
                                        } else {
                                          removeRfUsageItem(usageItem.id);
                                        }
                                      }}
                                    />
                                    Rahastatakse remondifondist
                                  </label>
                                </div>
                                {usageItem && (
                                  <div style={{ marginTop: 8 }}>
                                    <div style={fieldLabel}>Remondifondist kaetav summa</div>
                                    <EuroInput
                                      value={usageItem.remondifondistKaetavSumma}
                                      onChange={(v) => setPlan(p => ({
                                        ...p,
                                        funds: { ...p.funds, repairFund: { ...p.funds.repairFund, usageItems: (p.funds.repairFund.usageItems || []).map(u => u.id === usageItem.id ? { ...u, remondifondistKaetavSumma: v } : u) } },
                                      }))}
                                      style={{ ...numStyle, width: 160 }}
                                    />
                                    {isOverBudget && (
                                      <div style={{ fontSize: 13, color: "#b45309", marginTop: 4 }}>
                                        Sisestatud summa ületab töö eeldatavat maksumust ({euroEE(eeldatavKulu)}).
                                      </div>
                                    )}
                                    {(() => {
                                      const isMarkusOpen = !!usageItem.markus || openRfMarkusId === usageItem.id;
                                      return isMarkusOpen ? (
                                        <div style={{ marginTop: 8 }}>
                                          <div style={fieldLabel}>Märkus (valikuline)</div>
                                          <input value={usageItem.markus || ""} onChange={(e) => setPlan(p => ({ ...p, funds: { ...p.funds, repairFund: { ...p.funds.repairFund, usageItems: (p.funds.repairFund.usageItems || []).map(u => u.id === usageItem.id ? { ...u, markus: e.target.value } : u) } } }))} style={inputStyle} />
                                        </div>
                                      ) : (
                                        <button onClick={() => setOpenRfMarkusId(usageItem.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6366f1", padding: "4px 0" }}>+ Lisa märkus</button>
                                      );
                                    })()}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* ── Fondi suunatud muu tulu ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 16, paddingTop: 12 }}>
                      <div style={fieldLabel}>Fondi suunatud muu tulu</div>
                      <div style={{ ...numStyle, lineHeight: "38px", background: N.muted, width: 160, fontWeight: 600 }}>{euroEE(fondiMuuTuluFromTab2)}</div>
                      <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>Muudetav Tab 2 tulu suunamise kaudu.</div>
                    </div>

                    {/* ── Investeeringud ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 16, paddingTop: 12 }}>
                      <div style={H3_STYLE}>Investeeringud</div>
                      {ra.invDetail.length > 0 ? (
                        <div style={{ marginBottom: 16 }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                            <thead>
                              <tr style={{ color: N.dim, borderBottom: `1px solid ${N.rule}` }}>
                                <th style={{ textAlign: "left", padding: "4px 8px 4px 0", fontWeight: 600 }}>Objekt</th>
                                <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>Aasta</th>
                                <th style={{ textAlign: "right", padding: "4px 0 4px 8px", fontWeight: 600 }}>RF summa</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ra.invDetail.map((d, i) => (
                                <tr key={i} style={{ color: N.sub }}>
                                  <td style={{ padding: "3px 8px 3px 0" }}>{d.nimetus}</td>
                                  <td style={{ textAlign: "right", padding: "3px 8px", fontFamily: "monospace" }}>{d.aasta}</td>
                                  <td style={{ textAlign: "right", padding: "3px 0 3px 8px", fontFamily: "monospace" }}>{euroEE(d.rfSumma)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div style={{ padding: 12, background: N.muted, borderRadius: 6, fontSize: 14, color: N.dim, marginBottom: 16 }}>
                          Investeeringuid pole lisatud.
                        </div>
                      )}
                    </div>

                    {/* ── Lõppsaldo valem ── */}
                    <div style={{ borderTop: `1px solid ${N.border}`, marginTop: 8, paddingTop: 12 }}>
                      <div style={H3_STYLE}>Prognoositav remondifondi saldo perioodi lõpus</div>
                      <div style={{ fontFamily: "monospace", fontSize: 14, color: N.sub, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>Remondifondi saldo perioodi alguses</span><span>{euro(ra.saldoAlgus)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>+ Perioodis koguneb</span><span>{euro(ra.laekuminePerioodis)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>+ Fondi suunatud muu tulu</span><span>{euro(ra.fondiMuuTulu)}</span>
                        </div>
                        {ra.rfUsageRemondifondist > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>− Remondifondist kaetavad summad</span><span>{euro(ra.rfUsageRemondifondist)}</span>
                          </div>
                        )}
                        {ra.investRemondifondist > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>− Investeeringud RF-st</span><span>{euro(ra.investRemondifondist)}</span>
                          </div>
                        )}
                        {ra.p2Remondifondist > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>− Tegevuskulud RF-st</span><span>{euro(ra.p2Remondifondist)}</span>
                          </div>
                        )}
                        <div style={{
                          display: "flex", justifyContent: "space-between",
                          borderTop: `1px solid ${N.border}`, paddingTop: 6, marginTop: 8,
                          fontWeight: 600, fontSize: 14,
                          color: ra.saldoLopp >= 0 ? N.text : "#c53030",
                        }}>
                          <span>= Prognoositav remondifondi saldo perioodi lõpus</span><span>{euro(ra.saldoLopp)}</span>
                        </div>
                      </div>

                      {!(hasSoovitud || isSihttaseOpen) && (
                        <button
                          onClick={() => setIsSihttaseOpen(true)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6366f1", padding: "8px 0", marginTop: 8 }}
                        >
                          Soovin määrata lõppsaldo sihttaseme
                        </button>
                      )}
                      {(hasSoovitud || isSihttaseOpen) && (
                        <div style={{ marginTop: 16 }}>
                          <div style={fieldLabel}>Soovitud minimaalne lõppsaldo perioodi lõpus</div>
                          <EuroInput
                            value={remondifond.soovitudSaldoLopp}
                            onChange={(v) => setRemondifond(p => ({ ...p, soovitudSaldoLopp: v }))}
                            style={{ ...numStyle, width: 160 }}
                          />
                          {hasSoovitud && diff !== null && (
                            <div style={{ marginTop: 8 }}>
                              {diff >= 0 ? (
                                <div style={{ fontSize: 14, color: "#16a34a" }}>
                                  Ülejääk soovitud saldost: {euroEE(diff)}
                                </div>
                              ) : (
                                <div style={{ fontSize: 14, color: "#c53030" }}>
                                  Puudujääk soovitud saldoni: {euroEE(Math.abs(diff))}
                                </div>
                              )}
                              {soovituslikMaar !== null && (
                                <div style={{ marginTop: 8, fontSize: 14, color: N.sub }}>
                                  Soovituslik uus makse määr:{" "}
                                  <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                                    {soovituslikMaar.toFixed(2).replace(".", ",")} {rfSelectVal === "apartment" ? "€/korter/kuu" : "€/m²/kuu"}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}

            {(() => {
              const rkSaldoAlgus = parseFloat(resKap.saldoAlgus) || 0;
              const rkKogumine = plan.funds.reserve.plannedEUR || 0; // funds.reserve, plannedEUR
              const rkKasutamine = resKap.usesReserveDuringPeriod ? (parseFloat(resKap.kasutamine) || 0) : 0;
              const rkSaldoLopp = rkSaldoAlgus + rkKogumine - rkKasutamine;
              const noutavMinimum = reserveMin.noutavMiinimum || 0;
              const vastab = rkSaldoLopp >= noutavMinimum;
              const puudu = Math.max(0, noutavMinimum - rkSaldoLopp);
              const soovituslikKogumine = Math.max(0, noutavMinimum + rkKasutamine - rkSaldoAlgus);
              const mEq = derived.period.monthEq || 12;
              const koguPind = derived.building.totAreaM2 || 0;
              const rkMaarKuusM2 = koguPind > 0 ? rkKogumine / mEq / koguPind : 0;
              const rkRow = { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", fontSize: 14 };
              return (
                <div style={card}>
                  <div style={{ ...H2_STYLE, marginTop: 0, marginBottom: 16 }}>Reservkapital</div>

                  {/* ── Algseis ── */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={H3_STYLE}>Algseis</div>
                    <div style={{ width: 200 }}>
                      <div style={fieldLabel}>Saldo perioodi alguses</div>
                      <EuroInput value={resKap.saldoAlgus} onChange={(v) => { setResKapManual(true); setResKap(p => ({ ...p, saldoAlgus: v })); }} style={numStyle} />
                    </div>
                  </div>

                  {/* ── Kogumine perioodis ── */}
                  <div style={{ borderTop: `1px solid ${N.border}`, paddingTop: 12, marginBottom: 16 }}>
                    <div style={H3_STYLE}>Kogumine perioodis</div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
                      <div style={{ width: 200 }}>
                        <div style={fieldLabel}>Planeeritud kogumine</div>
                        <EuroInput
                          value={rkKogumine}
                          onChange={(v) => {
                            setResKapManual(true);
                            setPlan(p => ({ ...p, funds: { ...p.funds, reserve: { ...p.funds.reserve, plannedEUR: v } } }));
                          }}
                          style={numStyle}
                        />
                        {resKapManual && (
                          <button
                            onClick={() => setResKapManual(false)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6366f1", padding: "4px 0", marginTop: 4 }}
                          >
                            ↻ Automaatne
                          </button>
                        )}
                      </div>
                      {koguPind > 0 && rkKogumine > 0 && (
                        <div style={{ fontSize: 14, color: N.sub, paddingBottom: 6 }}>
                          {rkMaarKuusM2.toFixed(2).replace(".", ",")} €/m²/kuu
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 14, color: N.dim, marginTop: 8 }}>
                      KrtS § 48 miinimumnõue: vähemalt 1/12 aastakuludest ({euro(reserveMin.noutavMiinimum)})
                    </div>
                    {(() => {
                      const desc = describeAllocationPolicy(plan.allocationPolicies?.reserve);
                      return (
                        <div style={{ fontSize: 12, color: N.dim, marginTop: 4 }}>
                          Jaotusalus: {desc.basisLabel}
                          {desc.hasOverride
                            ? ` · Õiguslik alus: ${desc.legalBasis}${desc.legalBasisNote ? " — " + desc.legalBasisNote : ""}`
                            : " · Kaasomandi osa suuruse alusel"}
                        </div>
                      );
                    })()}
                    {renderPolicyException("reserve")}
                  </div>

                  {/* ── Kasutamine perioodis (toggle) ── */}
                  <div style={{ borderTop: `1px solid ${N.border}`, paddingTop: 12, marginBottom: 16 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!resKap.usesReserveDuringPeriod}
                        onChange={(e) => setResKap(p => ({ ...p, usesReserveDuringPeriod: e.target.checked }))}
                      />
                      Kas reservkapitalist kasutatakse perioodis raha?
                    </label>
                    {resKap.usesReserveDuringPeriod && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ width: 200 }}>
                          <div style={fieldLabel}>Reservkapitalist kasutatav summa perioodis</div>
                          <EuroInput value={resKap.kasutamine} onChange={(v) => setResKap(p => ({ ...p, kasutamine: v }))} style={numStyle} />
                        </div>
                        {rkKasutamine > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <textarea
                              value={resKap.pohjendus}
                              onChange={(e) => setResKap(p => ({ ...p, pohjendus: e.target.value }))}
                              placeholder="Põhjendage erakorralised kulud"
                              rows={2}
                              style={{ ...inputStyle, width: "100%", fontSize: 14, padding: 8, border: `1px solid ${resKap.pohjendus ? N.border : N.sub}`, borderRadius: 6 }}
                            />
                            {!resKap.pohjendus && (
                              <div style={{ fontSize: 14, color: N.sub, marginTop: 8 }}>Põhjendus on soovitav</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Lõppseis ── */}
                  <div style={{ borderTop: `1px solid ${N.border}`, paddingTop: 12 }}>
                    <div style={H3_STYLE}>Reservi seis perioodi lõpus</div>

                    <div style={{ fontFamily: "monospace", fontSize: 14, color: N.sub, display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Saldo perioodi alguses</span><span>{euro(rkSaldoAlgus)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>+ Kogumine perioodis</span><span>{euro(rkKogumine)}</span>
                      </div>
                      {rkKasutamine > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>− Erakorraline kasutamine</span><span>{euro(rkKasutamine)}</span>
                        </div>
                      )}
                      <div style={{
                        display: "flex", justifyContent: "space-between",
                        borderTop: `1px solid ${N.border}`, paddingTop: 6, marginTop: 4,
                        fontWeight: 600, fontSize: 14,
                        color: rkSaldoLopp < 0 ? "#c53030" : N.text,
                      }}>
                        <span>Prognoositav lõppsaldo</span>
                        <span style={{ fontFamily: "monospace" }}>{euroEE(rkSaldoLopp)}</span>
                      </div>
                    </div>

                    {vastab ? (
                      <div style={{ fontSize: 14, color: "#16a34a", fontWeight: 500, marginBottom: 8 }}>
                        Nõutav miinimum on täidetud.
                      </div>
                    ) : (
                      <div style={{ padding: 12, background: "#fef3c7", borderRadius: 6, fontSize: 14, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, color: "#92400e" }}>
                          Hoiatus: prognoositav lõppsaldo jääb alla nõutava miinimumi
                        </div>
                        <div style={{ marginTop: 6, color: N.text }}>
                          Puudu nõutava miinimumini: {euroEE(puudu)}
                        </div>
                        <div style={{ marginTop: 4, color: N.sub }}>
                          Soovituslik minimaalne kogumine perioodis: {euroEE(soovituslikKogumine)}
                        </div>
                      </div>
                    )}

                    <div style={{ fontSize: 13, color: N.dim }}>
                      Nõutav miinimum (1/12 aastakuludest): {euro(noutavMinimum)}
                    </div>
                  </div>
                </div>
              );
            })()}


            {(plan.loans.length > 0 || plan.investments.items.some(inv => (inv.fundingPlan || []).some(fp => fp.source === "Laen"))) && (<>
            <div style={{ ...H2_STYLE, marginTop: 0, marginBottom: 8 }}>Rahastamine</div>

            {/* Laenu staatus */}
            {plan.investments.items.some(inv => (inv.fundingPlan || []).some(fp => fp.source === "Laen")) && (
              <div style={{ marginBottom: 16, padding: 16, background: N.surface, border: `1px solid ${N.border}`, borderRadius: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <div style={fieldLabel}>Laenu staatus</div>
                  <select
                    value={loanStatus}
                    onChange={(e) => setLoanStatus(e.target.value)}
                    style={{ ...selectStyle, padding: "8px 12px", fontSize: 14, minWidth: 180 }}
                  >
                    <option value="APPLIED">Taotlusel (tingimuslik)</option>
                    <option value="APPROVED">Kinnitatud</option>
                  </select>
                </div>
                <div style={{ fontSize: 14, marginTop: 8, color: N.sub }}>
                  {loanStatus === "APPLIED"
                    ? "Laen ei ole kinnitatud. Kohustuslikud kuumaksed arvutatakse ilma laenuta."
                    : "Laen on kinnitatud. Kuumaksed sisaldavad laenumakseid."}
                </div>
              </div>
            )}

            {plan.loans.length > 0 && (
              <div style={{ fontSize: 14, color: N.dim, marginBottom: 16 }}>Indikatiivsed arvutused. Täpsed tingimused sõltuvad laenuandjast.</div>
            )}
            {plan.loans.length === 0 && (
              <div style={{ padding: 16, background: N.muted, borderRadius: 8, fontSize: 14, color: N.sub }}>
                Laenud tekivad investeeringute rahastusplaanist. Praegu ühtegi laenu planeeritud ei ole.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {plan.loans.map(ln => (
                <div key={ln.id} id={`laen-${ln.id}`} style={{
                  ...card,
                  ...(ln.sepiiriostudInvId && loanStatus === "APPLIED"
                    ? { borderLeft: `3px solid ${N.sub}` }
                    : {})
                }}>

                  {/* 1. Laenusumma */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...fieldLabel, display: "flex", alignItems: "center" }}>
                      Laenusumma
                      <span title="Investeeringu rahastusplaanist või käsitsi sisestatud" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: `1px solid ${N.border}`, fontSize: 14, color: N.dim, cursor: "help", marginLeft: 6 }}>?</span>
                    </div>
                    {ln.sepiiriostudInvId ? (
                      <>
                        <EuroInput value={ln.principalEUR} onChange={() => {}} style={{ ...numStyle, background: N.muted, color: N.sub, pointerEvents: "none" }} />
                        {(() => {
                          const inv = plan.investments.items.find(i =>
                            i.sourceRefId === ln.sepiiriostudInvId || i.id === ln.sepiiriostudInvId
                          );
                          const nimi = inv?.name || "Investeering";
                          return (
                            <button
                              onClick={() => {
                            setSec(1);
                            requestAnimationFrame(() => {
                              document.getElementById(`inv-${ln.sepiiriostudInvId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                            });
                          }}
                              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#6366f1", marginTop: 8, padding: 0 }}
                            >
                              {"\u2197"} {nimi} {"\u00B7"} rahastusplaanist
                            </button>
                          );
                        })()}
                      </>
                    ) : (
                      <EuroInput value={ln.principalEUR} onChange={(v) => updateLoan(ln.id, { principalEUR: v })} style={numStyle} />
                    )}
                  </div>

                  {/* 2. Periood */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...fieldLabel, display: "flex", alignItems: "center" }}>
                      Periood
                      <span title="Laenu tagasimaksmise periood" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: `1px solid ${N.border}`, fontSize: 14, color: N.dim, cursor: "help", marginLeft: 6 }}>?</span>
                    </div>
                    {(() => {
                      const total = parseInt(ln.termMonths) || 0;
                      const yy = Math.floor(total / 12);
                      const mm = total % 12;
                      return (
                        <div style={{ display: "flex", gap: 8 }}>
                          <select value={yy} onChange={(e) => { const v = parseInt(e.target.value); updateLoan(ln.id, { termMonths: v * 12 + mm }); }} style={{ ...selectStyle, flex: 2, padding: "10px 12px", fontSize: 14 }}>
                            {Array.from({ length: 31 }, (_, i) => <option key={i} value={i}>{i} {i === 1 ? "aasta" : "aastat"}</option>)}
                          </select>
                          <select value={mm} onChange={(e) => updateLoan(ln.id, { termMonths: yy * 12 + parseInt(e.target.value) })} style={{ ...selectStyle, flex: 1, padding: "10px 12px", fontSize: 14 }}>
                            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{i} {i === 1 ? "kuu" : "kuud"}</option>)}
                          </select>
                        </div>
                      );
                    })()}
                  </div>

                  {/* 3. Intress */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...fieldLabel, display: "flex", alignItems: "center" }}>
                      Intress
                      <span title="Aastane intressimäär" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: `1px solid ${N.border}`, fontSize: 14, color: N.dim, cursor: "help", marginLeft: 6 }}>?</span>
                    </div>
                    <div style={{ position: "relative" }}>
                      <NumberInput value={ln.annualRatePct} onChange={(v) => updateLoan(ln.id, { annualRatePct: v })} style={{ ...numStyle, paddingRight: 32 }} />
                      <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: N.dim, pointerEvents: "none" }}>%</span>
                    </div>
                  </div>

                  {/* 4. Laenumakse perioodis — readonly, arvutatud */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={fieldLabel}>Laenumakse perioodis</div>
                    <div style={{ ...numStyle, lineHeight: "38px", background: N.muted, color: N.text, fontWeight: 600 }}>
                      {euroEE(arvutaKuumakse(ln.principalEUR, ln.annualRatePct, parseInt(ln.termMonths) || 0) * (derived.period.monthEq || 12))}
                    </div>
                  </div>

                  {/* 5. Eemalda */}
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                    <button style={btnRemove} onClick={() => removeLoan(ln.id)}>Eemalda laen</button>
                  </div>
                </div>
              ))}
            </div>
            </>)}
          </div>
        )}

        {sec === 3 && (() => {
          const allKommunaalRead = plan.budget.costRows.filter(r => KOMMUNAALTEENUSED.includes(r.category));
          const kommunaalRead = allKommunaalRead;
          const defaultRows = allKommunaalRead.filter(r => r.isDefault === true);
          const extraRows = allKommunaalRead.filter(r => !r.isDefault);
          const p5Sum = allKommunaalRead.filter(r => P5_KOMMUNAALTEENUSED.includes(r.category)).reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          return (
            <div style={tabStack}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button style={btnRemove} onClick={clearKommunaalid}>Tühjenda</button>
              </div>
              <h1 style={H1_STYLE}>Kütuse, soojuse, vee- ja kanalisatsiooniteenuse ning elektri prognoositav kogus ja maksumus</h1>
              <div style={card}>
                <div style={{ ...H2_STYLE, marginTop: 0 }}>Kommunaalteenused</div>
                {allKommunaalRead.length === 0 && (
                  <div style={{ fontSize: 14, color: N.sub, padding: "8px 0" }}>Kommunaalteenuste ridu pole lisatud.</div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {defaultRows.map(r => (
                    <Fragment key={r.id}>
                      {kuluRidaEditor(r, ["kommunaal"], P5_KOMMUNAALTEENUSED, true)}
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: "4px 0 4px 0" }}>
                        <label style={{ fontSize: 14, color: N.sub, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={!!r.settledPostHoc}
                            onChange={(e) => setPlan(p => ({ ...p, budget: { ...p.budget, costRows: p.budget.costRows.map(x => x.id === r.id ? { ...x, settledPostHoc: e.target.checked } : x) } }))}
                          />
                          Tasumine pärast kulude suuruse selgumist
                        </label>
                        {r.settledPostHoc && (<>
                          <label style={{ fontSize: 14, color: N.sub, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={!!r.legalBasisBylaws}
                              onChange={(e) => setPlan(p => ({ ...p, budget: { ...p.budget, costRows: p.budget.costRows.map(x => x.id === r.id ? { ...x, legalBasisBylaws: e.target.checked } : x) } }))}
                            />
                            Põhikirjajärgne alus
                          </label>
                          <label style={{ fontSize: 14, color: N.sub, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={!!r.legalBasisSpecialAgreement}
                              onChange={(e) => setPlan(p => ({ ...p, budget: { ...p.budget, costRows: p.budget.costRows.map(x => x.id === r.id ? { ...x, legalBasisSpecialAgreement: e.target.checked } : x) } }))}
                            />
                            Erikokkuleppe alusel
                          </label>
                        </>)}
                        <div style={{ marginLeft: "auto" }}>
                          <button
                            style={btnRemove}
                            onClick={() => setPlan(p => ({
                              ...p,
                              budget: { ...p.budget, costRows: p.budget.costRows.filter(x => x.id !== r.id) },
                              removedDefaultKommunaalCategories: [...new Set([...(p.removedDefaultKommunaalCategories || []), r.category])],
                            }))}
                          >Eemalda rida</button>
                        </div>
                      </div>
                    </Fragment>
                  ))}
                  {extraRows.map(r => <Fragment key={r.id}>{kuluRidaEditor(r, ["kommunaal"], P5_KOMMUNAALTEENUSED)}</Fragment>)}
                </div>
                <div style={{ marginTop: 8 }}>
                  <button style={btnAdd} onClick={() => addRow("COST", { category: "Muu kommunaalteenus" })}>+ Lisa muu kommunaalteenus</button>
                </div>
                {allKommunaalRead.length > 0 && (
                  <div style={{ borderTop: `1px solid ${N.rule}`, marginTop: 16, paddingTop: 10, fontSize: 14, fontWeight: 600, color: N.text }}>
                    Kommunaalid kokku perioodis: {euro(p5Sum)}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {sec === 5 && (
          <div style={tabStack}>
            <h1 style={H1_STYLE}>Korteriomanike kohustuste jaotus majandamiskulude kandmisel</h1>
            <div style={{ fontSize: 13, color: N.sub, marginBottom: 8 }}>Kontrollvaade: jaotus arvutatakse teistes tabides sisestatud andmete põhjal. Majanduskava kohustuslik jaotus kuvatakse lõppvaates.</div>
            <div style={card}>
              {/* Pealkiri */}
              <div style={{ ...H2_STYLE, marginTop: 0 }}>Kuumaksed</div>
              <div style={{ fontSize: 14, color: N.sub, marginBottom: 16 }}>Jaotamine kaasomandi osa suuruse järgi</div>

              {/* Arvutusalused */}
              {derived.building.totAreaM2 > 0 && (() => {
                const ra = remondifondiArvutus;
                const mEq = derived.period.monthEq || 12;
                const rfAasta = Math.round(ra.maarAastasM2 * ra.koguPind);
                const reservAasta = Math.round(plan.funds.reserve.plannedEUR || 0);
                const olemasolevLaenuAasta = Math.round(plan.loans.filter(l => !l.sepiiriostudInvId).reduce((s, l) => s + arvutaKuumakse(l.principalEUR, l.annualRatePct, parseInt(l.termMonths) || 0), 0) * mEq);
                const planeeritudLaenuAasta = Math.round(plan.loans.filter(l => l.sepiiriostudInvId).reduce((s, l) => s + arvutaKuumakse(l.principalEUR, l.annualRatePct, parseInt(l.termMonths) || 0), 0) * mEq);
                const onPlaneeritudLaen = ra.onLaen;
                const kokku = kopiiriondvaade.kommunaalPeriood + kopiiriondvaade.haldusPeriood + rfAasta + reservAasta + olemasolevLaenuAasta + (onPlaneeritudLaen ? planeeritudLaenuAasta : 0);
                const aRow = { display: "flex", justifyContent: "space-between", padding: "3px 0" };
                const aMono = { fontFamily: "monospace" };
                return (
                  <div style={{ marginBottom: 16, padding: 16, background: N.muted, borderRadius: 8, fontSize: 14, color: N.sub }}>
                    <div style={{ fontWeight: 600, color: N.text, marginBottom: 8 }}>Kuumakse komponendid</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={aRow}>
                        <span>Jooksvad majandamiskulud</span>
                        <span style={aMono}>{euro(kopiiriondvaade.kommunaalPeriood)}</span>
                      </div>
                      <div style={aRow}>
                        <span>Halduskulud</span>
                        <span style={aMono}>{euro(kopiiriondvaade.haldusPeriood)}</span>
                      </div>
                      <div style={aRow}>
                        <span>Remondifondi kogumine</span>
                        <span style={aMono}>{euro(rfAasta)}</span>
                      </div>
                      <div style={aRow}>
                        <span>Reservkapitali kogumine</span>
                        <span style={aMono}>{euro(reservAasta)}</span>
                      </div>
                      {olemasolevLaenuAasta > 0 && (
                        <div style={aRow}>
                          <span>Laenumakse</span>
                          <span style={aMono}>{euro(olemasolevLaenuAasta)}</span>
                        </div>
                      )}
                      {onPlaneeritudLaen && (
                        <div style={aRow}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            Planeeritud laenumakse
                            <span style={{ fontSize: 14, padding: "1px 6px", borderRadius: 4,
                              background: N.muted, color: N.sub
                            }}>
                              {loanStatus === "APPROVED" ? "Kinnitatud" : "Tingimuslik"}
                            </span>
                          </span>
                          <span style={aMono}>{euro(planeeritudLaenuAasta)}</span>
                        </div>
                      )}
                      <div style={{ ...aRow, borderTop: `1px solid ${N.border}`, paddingTop: 4, marginTop: 8, fontWeight: 600, color: N.text }}>
                        <span>Kokku</span>
                        <span style={aMono}>{euro(kokku)}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {derived.building.totAreaM2 === 0 ? (
                <div style={{ padding: 16, background: N.muted, borderRadius: 8, fontSize: 14, color: N.sub }}>
                  Sisesta korterite m² (Tab "Üldandmed"), et arvutada makseid.
                </div>
              ) : (
                <>
                  {(() => {
                    const showLaen = remondifondiArvutus.onLaen;
                    const showReserv = (plan.funds.reserve.plannedEUR || 0) > 0;
                    const rr = { textAlign: "right", fontFamily: "monospace" };
                    const showLoanCol = loanStatus === "APPLIED" && remondifondiArvutus.loanScenario.onLaen;
                    const colCount = 6 + (showLaen ? 1 : 0) + (showReserv ? 1 : 0) + (showLoanCol ? 1 : 0);
                    return (
                      <div style={tableWrap}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                        <thead>
                          <tr style={thRow}>
                            <th style={{ padding: "8px 12px 8px 0" }}>Korter</th>
                            <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Korteri pindala (m²)</th>
                            <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Kommunaal</th>
                            <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Haldus</th>
                            <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Remondifond</th>
                            {showReserv && <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Reservkapital</th>}
                            {showLaen && <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Laenumakse</th>}
                            <th style={{ ...rr, padding: "8px 0", fontWeight: 600 }}>Kuumakse ilma laenuta</th>
                            {showLoanCol && (
                              <th style={{ ...rr, padding: "8px 0", fontWeight: 600, color: N.sub }}>Kuumakse koos laenuga</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {korteriteKuumaksed.map(km => {
                            const isOpen = avaKorterDetail[km.id];
                            return (
                              <Fragment key={km.id}>
                                <tr style={{ ...tdSep, cursor: "pointer" }} onClick={() => setAvaKorterDetail(p => ({ ...p, [km.id]: !p[km.id] }))}>
                                  <td style={{ padding: "8px 12px 8px 0" }}>
                                    <b>{km.tahis}</b>{" "}
                                    <span style={{ fontSize: 14, color: N.dim }}>{isOpen ? "\u25B2" : "\u25BC"}</span>
                                  </td>
                                  <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{km.pind.toFixed(2)} m²</td>
                                  <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.kommunaal)}</td>
                                  <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.haldus)}</td>
                                  <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.remondifond)}</td>
                                  {showReserv && <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.reserv)}</td>}
                                  {showLaen && <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.laenumakse)}</td>}
                                  <td style={{ ...rr, padding: "8px 0", fontWeight: 600 }}>{euro(km.kokku)}</td>
                                  {showLoanCol && (
                                    <td style={{ ...rr, padding: "8px 0", fontWeight: 600, color: N.sub }}>{euro(km.kokkuLoan)}</td>
                                  )}
                                </tr>
                                {isOpen && (
                                  <tr>
                                    <td colSpan={colCount} style={{ padding: "4px 0 8px 24px", fontSize: 14, color: N.dim }}>
                                      Kommunaal: {euro(km.kommunaal)}
                                      {" · "}
                                      Haldus: {euro(km.haldus)}
                                      {" · "}
                                      Remondifond: {euro(km.remondifond)}
                                      {showReserv && <>
                                        {" · "}
                                        Reservkapital: {euro(km.reserv)}
                                      </>}
                                      {showLaen && <>
                                        {" · "}
                                        Laenumakse: {euro(km.laenumakse)}
                                      </>}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ ...thRow, fontWeight: 600 }}>
                            <td style={{ padding: "8px 12px 8px 0" }}>Kokku</td>
                            <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{korteriteKuumaksed.reduce((s, k) => s + k.pind, 0).toFixed(2)} m²</td>
                            <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.kommunaal, 0))}</td>
                            <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.haldus, 0))}</td>
                            <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.remondifond, 0))}</td>
                            {showReserv && <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.reserv, 0))}</td>}
                            {showLaen && <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.laenumakse, 0))}</td>}
                            <td style={{ ...rr, padding: "8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.kokku, 0))}</td>
                            {showLoanCol && (
                              <td style={{ ...rr, padding: "8px 0", color: N.sub }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.kokkuLoan, 0))}</td>
                            )}
                          </tr>
                        </tfoot>
                      </table>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        )}

        {sec === 6 && (
          <div style={tabStack}>
            <h1 style={H1_STYLE}>Majanduskava</h1>

            {/* ── Päis: KÜ + periood + koostamise kuupäev ── */}
            <div style={{ ...card, padding: 24 }}>
              {kyData.nimi && <div style={{ padding: "4px 0" }}>{kyData.nimi}</div>}
              {kyData.registrikood && <div style={{ padding: "4px 0", color: N.sub }}>{kyData.registrikood}</div>}
              {kyData.aadress && <div style={{ padding: "4px 0", color: N.sub }}>{kyData.aadress}</div>}
              <div style={{ padding: "4px 0" }}>
                <span style={{ color: N.sub }}>Periood: </span>
                {formatDateEE(plan.period.start)} – {formatDateEE(plan.period.end)}
              </div>
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ ...fieldLabel, marginBottom: 0, minWidth: 160 }}>Koostamise kuupäev</div>
                <input
                  type="date"
                  value={plan.preparedAt || ""}
                  onChange={(e) => setPlan(p => ({ ...p, preparedAt: e.target.value }))}
                  style={{ ...inputStyle, width: 180 }}
                />
              </div>
            </div>

            {/* ── Plokk 3: Kaasomandi eseme seisukord ja kavandatavad toimingud ── */}
            <div style={{ ...card, padding: 24 }}>
              <div style={H3_STYLE}>Kaasomandi eseme seisukord ja kavandatavad toimingud</div>
              {seisukord.length > 0 && seisukord.some(r => r.ese) ? (() => {
                const p1sy = plan.period.start ? Number(plan.period.start.slice(0, 4)) : null;
                const p1ey = plan.period.end ? Number(plan.period.end.slice(0, 4)) : null;
                const p1multi = Boolean(p1sy && p1ey && p1ey > p1sy);
                return (
                  <div style={tableWrap}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead>
                        <tr style={thRow}>
                          <th style={{ padding: "8px 12px 8px 0", textAlign: "left" }}>Ese</th>
                          <th style={{ padding: "8px 12px 8px 0", textAlign: "left" }}>Seisukord</th>
                          <th style={{ padding: "8px 12px 8px 0", textAlign: "left" }}>Prioriteet</th>
                          <th style={{ padding: "8px 12px 8px 0", textAlign: "left" }}>Puudused</th>
                          <th style={{ padding: "8px 12px 8px 0", textAlign: "left" }}>Kavandatav toiming</th>
                          <th style={{ padding: "8px 12px 8px 0", textAlign: "right" }}>Eeldatav maksumus</th>
                          {p1multi && <th style={{ padding: "8px 0", textAlign: "left" }}>Aasta</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {seisukord.filter(r => r.ese).map(s => (
                          <tr key={s.id} style={tdSep}>
                            <td style={{ padding: "8px 12px 8px 0" }}>{s.ese}</td>
                            <td style={{ padding: "8px 12px 8px 0" }}>{s.seisukordVal || ""}</td>
                            <td style={{ padding: "8px 12px 8px 0" }}>{s.prioriteet || ""}</td>
                            <td style={{ padding: "8px 12px 8px 0" }}>{s.puudused || ""}</td>
                            <td style={{ padding: "8px 12px 8px 0" }}>{s.tegevus || ""}</td>
                            <td style={{ padding: "8px 12px 8px 0", textAlign: "right", fontFamily: "monospace" }}>{s.eeldatavKulu ? euroEE(s.eeldatavKulu) : ""}</td>
                            {p1multi && <td style={{ padding: "8px 0" }}>{s.tegevusAasta || ""}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })() : (
                <div style={{ fontSize: 14, color: N.sub }}>Kaasomandi eseme seisukorra andmed on sisestamata.</div>
              )}
            </div>

            {/* ── Plokk 4: Kavandatavad tulud ── */}
            {(() => {
              const kvRow = { display: "flex", justifyContent: "space-between", fontSize: 14, color: N.sub, padding: "4px 0" };
              const kvBold = { display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600, color: N.text, padding: "6px 0", borderTop: `1px solid ${N.border}`, marginTop: 8 };
              const mono = { fontFamily: "monospace" };
              const mEq = derived.period.monthEq || 12;
              const kommunaalPeriood = kopiiriondvaade.kommunaalPeriood || Math.round(kopiiriondvaade.kommunaalKokku * mEq);
              const haldusPeriood = kopiiriondvaade.haldusPeriood || Math.round(kopiiriondvaade.haldusKokku * mEq);
              const kommunaalTuluPeriood = kommunaalPeriood;
              const haldustasuPeriood = haldusPeriood;
              const muudTuludPeriood = Math.round(kopiiriondvaade.muudTuludKokku * mEq);
              const tuludPeriood = kommunaalTuluPeriood + haldustasuPeriood + muudTuludPeriood;
              if (tuludPeriood <= 0) return null;
              return (
                <div style={{ ...card, padding: 24 }}>
                  <div style={H3_STYLE}>Kavandatavad tulud</div>
                  <div style={{ ...kvRow, paddingLeft: 16 }}>
                    <span><span style={{ color: N.dim }}>Arvutatud kulude põhjal · </span>Kommunaalmaksed</span>
                    <span style={mono}>{euroEE(kommunaalTuluPeriood)}</span>
                  </div>
                  <div style={{ ...kvRow, paddingLeft: 16 }}>
                    <span><span style={{ color: N.dim }}>Arvutatud kulude põhjal · </span>Haldustasu</span>
                    <span style={mono}>{euroEE(haldustasuPeriood)}</span>
                  </div>
                  <div style={{ ...kvRow, paddingLeft: 16 }}>
                    <span>Muu tulu</span>
                    <span style={mono}>{euroEE(muudTuludPeriood)}</span>
                  </div>
                  <div style={{ ...kvBold, paddingLeft: 16 }}>
                    <span>Kokku</span>
                    <span style={mono}>{euroEE(tuludPeriood)}</span>
                  </div>
                </div>
              );
            })()}

            {/* ── Plokk 5: Kavandatavad kulud ── */}
            {(() => {
              const kvRow = { display: "flex", justifyContent: "space-between", fontSize: 14, color: N.sub, padding: "4px 0" };
              const kvBold = { display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600, color: N.text, padding: "6px 0", borderTop: `1px solid ${N.border}`, marginTop: 8 };
              const mono = { fontFamily: "monospace" };
              const mEq = derived.period.monthEq || 12;
              const kommunaalPeriood = kopiiriondvaade.kommunaalPeriood || Math.round(kopiiriondvaade.kommunaalKokku * mEq);
              const haldusPeriood = kopiiriondvaade.haldusPeriood || Math.round(kopiiriondvaade.haldusKokku * mEq);
              const laenumaksedPeriood = Math.round(kopiiriondvaade.laenumaksedKokku * mEq);
              const kuludPeriood = kommunaalPeriood + haldusPeriood;
              const valjaminekudPeriood = kuludPeriood + laenumaksedPeriood;
              if (valjaminekudPeriood <= 0) return null;
              return (
                <div style={{ ...card, padding: 24 }}>
                  <div style={H3_STYLE}>Kavandatavad kulud</div>
                  {derived.investments.thisYearCount > 0 && (
                    <div style={{ fontSize: 13, color: N.sub, marginBottom: 12 }}>
                      Kavandatud investeeringud perioodis: {derived.investments.thisYearCount} · Kokku {euroEE(derived.investments.costThisYearEUR)}
                    </div>
                  )}
                  <div style={{ ...kvRow, paddingLeft: 16 }}>
                    <span>Kommunaalkulud</span>
                    <span style={mono}>{euroEE(kommunaalPeriood)}</span>
                  </div>
                  <div style={{ ...kvRow, paddingLeft: 16 }}>
                    <span>Halduskulud</span>
                    <span style={mono}>{euroEE(haldusPeriood)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: N.dim, paddingLeft: 16, marginTop: -2, marginBottom: 4 }}>
                    {summarizeAllocationPolicy(plan.allocationPolicies?.maintenance)}
                  </div>
                  {laenumaksedPeriood > 0 && (
                    <div style={{ ...kvRow, paddingLeft: 16 }}>
                      <span>Laenu teenindamine</span>
                      <span style={mono}>{euroEE(laenumaksedPeriood)}</span>
                    </div>
                  )}
                  <div style={{ ...kvBold, paddingLeft: 16 }}>
                    <span>Kokku</span>
                    <span style={mono}>{euroEE(valjaminekudPeriood)}</span>
                  </div>
                </div>
              );
            })()}

            {/* ── Laenukohustused ja rahastamisallikad ── */}
            {plan.loans.length > 0 && (() => {
              const olemasolevad = plan.loans.filter(l => !l.sepiiriostudInvId);
              const planeeritud  = plan.loans.filter(l => !!l.sepiiriostudInvId);
              const grpLabel = { fontSize: 12, fontWeight: 600, color: N.sub, textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 0 0", marginTop: 8 };
              const thR = { textAlign: "right", padding: "4px 8px", fontWeight: 600 };
              const tdR = { textAlign: "right", padding: "3px 8px", fontFamily: "monospace" };
              const loanRow = (l, showInv) => {
                const inv = showInv ? plan.investments.items.find(i => i.id === l.sepiiriostudInvId) : null;
                return (
                  <tr key={l.id} style={{ color: N.sub }}>
                    <td style={{ padding: "3px 8px 3px 0" }}>{l.name || "—"}</td>
                    <td style={tdR}>{euroEE(l.principalEUR)}</td>
                    <td style={tdR}>{l.annualRatePct ? `${l.annualRatePct} %` : "—"}</td>
                    <td style={tdR}>{l.termMonths || "—"}</td>
                    <td style={tdR}>{l.startYM || "—"}</td>
                    {showInv && <td style={tdR}>{inv?.name || "—"}</td>}
                  </tr>
                );
              };
              const loanTable = (items, showInv) => (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 8 }}>
                  <thead>
                    <tr style={{ color: N.dim, borderBottom: `1px solid ${N.rule}` }}>
                      <th style={{ textAlign: "left", padding: "4px 8px 4px 0", fontWeight: 600 }}>Nimetus</th>
                      <th style={thR}>Põhikohustus</th>
                      <th style={thR}>Intress %</th>
                      <th style={thR}>Tähtaeg (kuu)</th>
                      <th style={thR}>Alguskuu</th>
                      {showInv && <th style={thR}>Investeering</th>}
                    </tr>
                  </thead>
                  <tbody>{items.map(l => loanRow(l, showInv))}</tbody>
                </table>
              );
              return (
                <div style={{ ...card, padding: 24 }}>
                  <div style={H3_STYLE}>Laenukohustused ja rahastamisallikad</div>
                  <div style={{ fontSize: 13, color: N.sub, marginBottom: 12 }}>
                    Laenusumma ei ole tavatulu. Laenu teenindamise mõju kajastub kuludes ja kohustuste jaotuses.
                  </div>
                  {olemasolevad.length > 0 && (<><div style={grpLabel}>Olemasolevad laenukohustused</div>{loanTable(olemasolevad, false)}</>)}
                  {planeeritud.length > 0 && (<><div style={grpLabel}>Planeeritud uued laenud</div>{loanTable(planeeritud, true)}</>)}
                  {derived.loans.servicePeriodEUR > 0 && (
                    <div style={{ fontSize: 14, fontWeight: 600, color: N.text, marginTop: 16, fontFamily: "monospace" }}>
                      <div>Laenu teenindamine kuus: {euroEE(derived.loans.serviceMonthlyEUR)}</div>
                      <div>Laenu teenindamine perioodis: {euroEE(derived.loans.servicePeriodEUR)}</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Plokk 6: Remondifondi ja reservkapitali maksed ── */}
            {(() => {
              const kvRow = { display: "flex", justifyContent: "space-between", fontSize: 14, color: N.sub, padding: "4px 0" };
              const kvBold = { display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600, color: N.text, padding: "6px 0", borderTop: `1px solid ${N.border}`, marginTop: 8 };
              const mono = { fontFamily: "monospace" };
              const rf = remondifondiArvutus;
              const reservPeriood = plan.funds.reserve.plannedEUR || 0;
              const hasRf = (rf.saldoAlgus || rf.laekuminePerioodis || rf.remondifondistKaetavadKokku || rf.saldoLopp) !== 0;
              return (
                <div style={{ ...card, padding: 24 }}>
                  <div style={H3_STYLE}>Remondifondi ja reservkapitali maksed</div>
                  {!hasRf && reservPeriood <= 0 && (
                    <p style={{ fontSize: 14, color: N.sub }}>Andmed on sisestamata.</p>
                  )}
                  {hasRf && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, color: N.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Remondifond</div>
                      <div style={{ fontSize: 12, color: N.dim, marginBottom: 6 }}>
                        {summarizeAllocationPolicy(plan.allocationPolicies?.remondifond)}
                      </div>
                      <div style={kvRow}><span>Saldo perioodi alguses</span><span style={mono}>{euroEE(rf.saldoAlgus)}</span></div>
                      <div style={kvRow}><span>Laekumine perioodis</span><span style={mono}>{euroEE(rf.laekuminePerioodis)}</span></div>
                      <div style={kvRow}><span>Investeeringud perioodis</span><span style={mono}>{rf.investRemondifondist > 0 ? "−" : ""}{euroEE(rf.investRemondifondist)}</span></div>
                      {rf.p2Remondifondist > 0 && (
                        <div style={kvRow}><span>Tegevuskulud RF-st</span><span style={mono}>−{euroEE(rf.p2Remondifondist)}</span></div>
                      )}
                      <div style={{ ...kvBold, color: rf.saldoLopp < 0 ? "#c53030" : N.text }}>
                        <span>Saldo perioodi lõpus</span>
                        <span style={mono}>{euroEE(rf.saldoLopp)}</span>
                      </div>
                    </>
                  )}
                  {reservPeriood > 0 && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, color: N.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: hasRf ? 16 : 0, marginBottom: 8 }}>Reservkapital</div>
                      <div style={{ fontSize: 12, color: N.dim, marginBottom: 6 }}>
                        {summarizeAllocationPolicy(plan.allocationPolicies?.reserve)}
                      </div>
                      <div style={kvRow}><span>Kavandatud reserv</span><span style={mono}>{euroEE(reservPeriood)}</span></div>
                      <div style={kvRow}><span>Kuumakse</span><span style={mono}>{euro(Math.round(reservPeriood / 12))}/kuu</span></div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── Plokk 7: Korteriomanike kohustuste jaotus majandamiskulude kandmisel ── */}
            <div style={{ ...card, padding: 24 }}>
              <div style={H3_STYLE}>Korteriomanike kohustuste jaotus majandamiskulude kandmisel</div>
              <div style={tableWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={thRow}>
                      <th style={{ padding: "8px 12px 8px 0", textAlign: "left" }}>Kululiik</th>
                      <th style={{ padding: "8px 12px 8px 0", textAlign: "right" }}>Makse perioodis</th>
                      <th style={{ padding: "8px 0", textAlign: "left" }}>Jaotamise alus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.budget.costRows.filter(r => (parseFloat(r.summaInput) || 0) > 0).map(r => {
                      const effectiveBasis = HALDUSTEENUSED.includes(r.category)
                        ? getEffectiveAllocationBasis(plan.allocationPolicies?.maintenance)
                        : getEffectiveRowAllocationBasis(r);
                      const selectedBasis = r.allocationBasis || "m2";
                      const alus = p3AlusSilt(effectiveBasis);
                      const showSelectedNote = !HALDUSTEENUSED.includes(r.category) && selectedBasis !== effectiveBasis;
                      return (
                        <tr key={r.id} style={tdSep}>
                          <td style={{ padding: "8px 12px 8px 0" }}>
                            {r.category ? <span style={{ color: N.sub }}>{r.category}{r.name ? " · " : ""}</span> : null}
                            {r.name || (!r.category ? "—" : "")}
                          </td>
                          <td style={{ padding: "8px 12px 8px 0", textAlign: "right", fontFamily: "monospace" }}>
                            {euroEE(r.calc?.params?.amountEUR || 0)}
                          </td>
                          <td style={{ padding: "8px 0" }}>
                            {alus}
                            {showSelectedNote && <div style={{ fontSize: 12, color: "#b45309" }}>Valitud: {p3AlusSilt(selectedBasis)} (õiguslik alus puudub)</div>}
                            {r.legalBasisBylaws && <div style={{ fontSize: 12, color: N.dim }}>Õiguslik alus: põhikiri</div>}
                            {r.legalBasisSpecialAgreement && <div style={{ fontSize: 12, color: N.dim }}>Õiguslik alus: erikokkulepe</div>}
                            {r.settledPostHoc && <div style={{ fontSize: 12, color: N.dim }}>Tasutakse pärast kulude suuruse selgumist</div>}
                            {r.selgitus && <div style={{ fontSize: 12, color: N.dim }}>{r.selgitus}</div>}
                          </td>
                        </tr>
                      );
                    })}
                    {remondifondiArvutus.laekuminePerioodis > 0 && (() => {
                      const basis = getEffectiveAllocationBasis(plan.allocationPolicies?.remondifond);
                      const alus = p3AlusSilt(basis);
                      return (
                        <tr style={tdSep}>
                          <td style={{ padding: "8px 12px 8px 0" }}>Remondifondi makse</td>
                          <td style={{ padding: "8px 12px 8px 0", textAlign: "right", fontFamily: "monospace" }}>{euroEE(remondifondiArvutus.laekuminePerioodis)}</td>
                          <td style={{ padding: "8px 0" }}>
                            {alus}
                            {plan.allocationPolicies?.remondifond?.legalBasisType === "BYLAWS_EXCEPTION" && (
                              <div style={{ fontSize: 12, color: N.dim }}>{plan.allocationPolicies.remondifond.legalBasisText?.trim() || "Erand põhikirja järgi"}</div>
                            )}
                          </td>
                        </tr>
                      );
                    })()}
                    {(plan.funds.reserve.plannedEUR || 0) > 0 && (() => {
                      const basis = getEffectiveAllocationBasis(plan.allocationPolicies?.reserve);
                      const alus = p3AlusSilt(basis);
                      return (
                        <tr style={tdSep}>
                          <td style={{ padding: "8px 12px 8px 0" }}>Reservkapitali makse</td>
                          <td style={{ padding: "8px 12px 8px 0", textAlign: "right", fontFamily: "monospace" }}>{euroEE(plan.funds.reserve.plannedEUR)}</td>
                          <td style={{ padding: "8px 0" }}>
                            {alus}
                            {plan.allocationPolicies?.reserve?.legalBasisType === "BYLAWS_EXCEPTION" && (
                              <div style={{ fontSize: 12, color: N.dim }}>{plan.allocationPolicies.reserve.legalBasisText?.trim() || "Erand põhikirja järgi"}</div>
                            )}
                          </td>
                        </tr>
                      );
                    })()}
                    {kopiiriondvaade.laenumaksedKokku > 0 && (() => {
                      const laenPeriood = Math.round(kopiiriondvaade.laenumaksedKokku * (derived.period.monthEq || 12));
                      return (
                        <tr style={tdSep}>
                          <td style={{ padding: "8px 12px 8px 0" }}>
                            Laenumaksed
                            {remondifondiArvutus.onLaen && loanStatus !== "APPROVED" && (
                              <div style={{ fontSize: 12, color: N.dim }}>Planeeritud laen: tingimuslik (ei sisaldu)</div>
                            )}
                            {remondifondiArvutus.onLaen && loanStatus === "APPROVED" && (
                              <div style={{ fontSize: 12, color: N.dim }}>Sisaldab kinnitatud planeeritud laenu</div>
                            )}
                          </td>
                          <td style={{ padding: "8px 12px 8px 0", textAlign: "right", fontFamily: "monospace" }}>{euroEE(laenPeriood)}</td>
                          <td style={{ padding: "8px 0" }}>{p3AlusSilt("m2")}</td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Plokk 8: Kütus / soojus / vesi ja kanalisatsioon / elekter ── */}
            {(() => {
              const utilityRows = plan.budget.costRows.filter(r => P5_KOMMUNAALTEENUSED.includes(r.category) && (parseFloat(r.summaInput) || 0) > 0);
              return (
                <div style={{ ...card, padding: 24 }}>
                  <div style={H3_STYLE}>Kütus / soojus / vesi ja kanalisatsioon / elekter</div>
                  {utilityRows.length === 0 ? (
                    <p style={{ fontSize: 14, color: N.sub }}>Andmed on sisestamata.</p>
                  ) : (
                  <div style={tableWrap}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead>
                        <tr style={thRow}>
                          <th style={{ padding: "8px 12px 8px 0", textAlign: "left" }}>Liik</th>
                          <th style={{ padding: "8px 12px 8px 0", textAlign: "right" }}>Prognoositav kogus</th>
                          <th style={{ padding: "8px 12px 8px 0", textAlign: "left" }}>Ühik</th>
                          <th style={{ padding: "8px 0", textAlign: "right" }}>Maksumus</th>
                        </tr>
                      </thead>
                      <tbody>
                        {utilityRows.map(r => (
                          <tr key={r.id} style={tdSep}>
                            <td style={{ padding: "8px 12px 8px 0" }}>
                              {r.category}{r.name ? <> · <span style={{ color: N.sub }}>{r.name}</span></> : null}
                              {r.settledPostHoc && <div style={{ fontSize: 12, color: N.dim }}>Tasutakse pärast kulude suuruse selgumist</div>}
                            </td>
                            <td style={{ padding: "8px 12px 8px 0", textAlign: "right", fontFamily: "monospace" }}>{r.kogus || <span style={{ color: "#999", fontStyle: "italic" }}>kogus määramata</span>}</td>
                            <td style={{ padding: "8px 12px 8px 0" }}>{r.uhik || ""}</td>
                            <td style={{ padding: "8px 0", textAlign: "right", fontFamily: "monospace" }}>{euroEE(r.calc?.params?.amountEUR || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
              );
            })()}

            {showTechnicalInfo && (
              <>
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

                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <button
                      onClick={onSolveAll}
                      disabled={isSolving || !allActions.length}
                      style={{ ...btnPrimary, opacity: (isSolving || !allActions.length) ? 0.5 : 1 }}
                    >
                      {isSolving ? "Rakendan…" : "Rakenda soovitused"}
                    </button>
                    {solveStatus ? (
                      <span style={{ fontSize: 14, opacity: 0.75 }}>{solveStatus}</span>
                    ) : null}
                  </div>
                  {/* ── Jääkprobleemide kokkuvõte pärast autoResolve'i ── */}
                  {solveAllResult && solveAllResult.stoppedBecause !== "NO_ACTIONS" && (() => {
                    const remainingErrors = (evaluation?.findings ?? []).filter(f => f.severity === "error");
                    const remainingWarnings = (evaluation?.findings ?? []).filter(f => f.severity === "warning");
                    const hasProblems = remainingErrors.length > 0 || remainingWarnings.length > 0;
                    return (
                      <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 8, background: hasProblems ? (remainingErrors.length > 0 ? "#fef2f2" : "#fffbeb") : "#f3f4f6", border: `1px solid ${hasProblems ? (remainingErrors.length > 0 ? "#fecaca" : "#fde68a") : "#d1d5db"}` }}>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: hasProblems ? 4 : 0, color: hasProblems ? (remainingErrors.length > 0 ? "#991b1b" : "#92400e") : "#6b7280" }}>
                          {hasProblems
                            ? `Jäi lahendamata (${solveAllResult.stop.stepsTaken} sammu tehtud)`
                            : `Automaatne lahendamine lõppes (${solveAllResult.stop.stepsTaken} sammu tehtud). Konkreetseid jääkprobleeme ei tuvastatud — kontrolli kava käsitsi.`}
                        </div>
                        {hasProblems && (
                          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "#374151" }}>
                            {remainingErrors.map((f, i) => (
                              <li key={"e" + i} style={{ color: "#991b1b" }}>{f.title || f.message}</li>
                            ))}
                            {remainingWarnings.map((f, i) => (
                              <li key={"w" + i} style={{ color: "#92400e" }}>{f.title || f.message}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* ── Riskitase (band + reason only) ── */}
                {evaluation?.risk && (
                  <div style={{ ...card, padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={sectionTitle}>Riskitase</div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: N.sub }}>
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
                  <div style={{ border: `1px solid ${N.border}`, borderRadius: 8, padding: 20, background: N.muted }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div style={{ ...sectionTitle, color: N.sub }}>Viga</div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: N.sub }}>ERROR</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: N.sub }}>Ei saanud muudatust rakendada</div>
                    <div style={{ marginTop: 8, fontSize: 14, color: N.sub }}>{uiError}</div>
                    <button
                      style={{ marginTop: 8, fontSize: 14, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: N.sub }}
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
              </>
            )}

            {/* ── Üldandmete puuduste kontroll lõppdokumendi koostamisel ── */}
            {(() => {
              const missing = [];
              if (!plan.period.start || !plan.period.end) missing.push("Majanduskava periood");
              if (!kyData.nimi?.trim()) missing.push("KÜ nimi");
              if (!kyData.registrikood?.trim()) missing.push("Registrikood");
              if (!kyData.aadress?.trim()) missing.push("Hoone aadress");
              if (!(parseFloat(kyData.suletudNetopind) > 0)) missing.push("Kaasomandi osad kokku");
              if (missing.length === 0) return null;
              return (
                <div style={{ fontSize: 14, color: "#c53030", background: "#fff5f5", border: "1px solid #fc8181", borderRadius: 6, padding: "10px 14px", marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Puuduvad kohustuslikud andmed lõppdokumendi koostamiseks (Üldandmed):</div>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {missing.map(m => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              );
            })()}

            {/* ── Prindi + Ekspordi nupud (always visible) ── */}
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <button
                style={{ ...btnSecondary, padding: "10px 16px", opacity: derived.controls.hasErrors ? 0.5 : 1 }}
                disabled={derived.controls.hasErrors}
                onClick={() => onPrint("full")}
                title={derived.controls.hasErrors ? "Paranda vead enne printimist" : "Prindi majanduskava"}
              >
                Prindi majanduskava
              </button>
              <button
                style={{ ...btnSecondary, padding: "10px 16px", opacity: derived.controls.hasErrors ? 0.5 : 1 }}
                disabled={derived.controls.hasErrors}
                onClick={() => onPrint("apartments")}
                title={derived.controls.hasErrors ? "Paranda vead enne printimist" : "Prindi korteripõhine maksete lisa"}
              >
                Prindi korteripõhine maksete lisa
              </button>
              {(() => {
                const puudulikud = plan.budget.costRows.filter(r => {
                  const s = utilityRowStatus(r);
                  return s.isUtility && !s.complete && (parseFloat(r.summaInput) || 0) > 0;
                });
                return puudulikud.length > 0 ? (
                  <span style={{ fontSize: 13, color: "#c53030" }}>
                    {puudulikud.length} kommunaalrea{puudulikud.length > 1 ? "l" : "l"} puudub kogus/ühik
                  </span>
                ) : null;
              })()}
            </div>

            {/* ── Technical details (single conditional container) ── */}
            {showTechnicalInfo && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, borderTop: `2px dashed ${N.border}`, paddingTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: N.dim }}>
                  Technical details
                </div>

                {/* Risk score */}
                {evaluation?.risk && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 14, color: N.sub }}>Riskiskoor:</span>
                    <span style={{ fontSize: 24, fontWeight: 600 }}>{evaluation.risk.score}</span>
                  </div>
                )}

                {/* TracePanel */}
                <TracePanel evaluation={evaluation} steps={solveAllResult?.steps} stop={solveAllResult?.stop} />

                {/* Vastavuse kokkuvõte */}
                <div style={{ border: `1px solid ${N.border}`, borderRadius: 8, padding: 20, background: N.surface }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: N.sub }}>
                      Vastavuse kokkuvõte
                    </div>
                    {(() => {
                      const candidates = evaluation?.actionCandidates ?? [];
                      const eligible = candidates.filter(c => c.isEligible).length;
                      const guardOk = eligible > 0 || candidates.length === 0;
                      const reportOk = !solveAllResult?.report || solveAllResult.report.stop.reason === "NO_ACTIONS" || solveAllResult.report.final.riskScore === 0;
                      const allOk = guardOk && reportOk;
                      return (
                        <span style={{ fontSize: 14, fontWeight: 600, color: N.sub }}>
                          {allOk ? "OK" : "Kontrollida"}
                        </span>
                      );
                    })()}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <span style={{ fontSize: 14, color: N.sub, minWidth: 90 }}>loopGuard</span>
                    {(() => {
                      const candidates = evaluation?.actionCandidates ?? [];
                      const eligible = candidates.filter(c => c.isEligible).length;
                      const ok = eligible > 0 || candidates.length === 0;
                      return (
                        <span style={{ fontSize: 14, fontWeight: 600, color: N.sub }}>
                          {ok ? "OK" : "BLOCKED"}
                        </span>
                      );
                    })()}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, color: N.sub, minWidth: 90 }}>RunReport</span>
                    {(() => {
                      if (!solveAllResult?.report) {
                        return <span style={{ fontSize: 14, color: N.dim }}>Andmed puuduvad (Solve tegemata)</span>;
                      }
                      const r = solveAllResult.report;
                      const ok = r.stop.reason === "NO_ACTIONS" || r.final.riskScore === 0;
                      return (
                        <span style={{ fontSize: 14, fontWeight: 600, color: N.sub }}>
                          {ok ? "OK" : "Tähelepanu vajab"}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Süsteemi info */}
                <div style={{ border: `1px solid ${N.border}`, borderRadius: 8, padding: 20, background: N.muted }}>
                  <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: N.dim, marginBottom: 16 }}>
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
                      <span style={{ fontSize: 14, color: N.sub }}>{label}</span>
                      <span style={{ fontSize: 14, fontFamily: "monospace", color: value ? N.sub : N.dim }}>
                        {value || "—"}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Pilot checklist */}
                <div style={{ border: `1px solid ${N.border}`, borderRadius: 8, padding: 20, background: N.surface }}>
                  <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: N.sub, marginBottom: 16 }}>
                    Käivituse kontrollnimekiri
                  </div>
                  {[
                    "Print vaade kontrollitud (Prindi kokkuvõte)",
                    "Versioonitõend on printis nähtav",
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
                      style={{ fontSize: 14, color: "#2563eb", cursor: "pointer", textDecoration: "underline" }}
                    >
                      {pilotFeedbackOpen ? "Peida juhis" : "Piloodi tagasiside — mida täpselt kirja panna"}
                    </span>
                    {pilotFeedbackOpen && (
                      <div style={{ marginTop: 8, fontSize: 14, color: N.sub, lineHeight: 1.6 }}>
                        <b>Kirjuta üles:</b>
                        <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                          <li>Mis andmed sisestasid (korterite arv, pind, kulud, tulud, laenud)</li>
                          <li>Kas "Rakenda soovitused" töötas ootuspäraselt — mitu sammu tehti, mis muutus</li>
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
                    "Lisainfo:",
                  ].join("\n");

                  return (
                    <div style={{ border: `1px solid ${N.border}`, borderRadius: 8, padding: 20, background: N.muted }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: N.dim }}>
                          Kasutustest — tagasiside mall
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: N.bg, color: N.dim }}>DEV</span>
                      </div>
                      <pre style={{
                        background: N.surface,
                        border: `1px solid ${N.border}`,
                        borderRadius: 8,
                        padding: 16,
                        fontSize: 14,
                        fontFamily: "monospace",
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.7,
                        color: N.text,
                        margin: 0,
                      }}>
                        {template}
                      </pre>
                      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 16 }}>
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
                        <span style={{ fontSize: 14, color: N.dim }}>
                          Kui kopeerimine ei tööta, märgista tekst ja kopeeri käsitsi.
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

          </div>
        )}

        {/* ── Print-only: all sections rendered for print ── */}
      {isPrinting && (
        <div className="print-content">
          {(kyData.nimi || kyData.registrikood || kyData.aadress) && (
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              {kyData.nimi && <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{kyData.nimi}</h1>}
              {kyData.registrikood && (
                <div style={{ fontSize: 14, color: N.sub, marginTop: 4 }}>{kyData.registrikood}</div>
              )}
              {kyData.aadress && (
                <div style={{ fontSize: 14, color: N.sub, marginTop: kyData.registrikood ? 2 : 4 }}>{kyData.aadress}</div>
              )}
            </div>
          )}
          <div style={{ textAlign: "center", fontSize: 14, color: N.sub, marginBottom: 16 }}>
            {(plan.period.start || plan.period.end) && (
              <div>Periood: {formatDateEE(plan.period.start)} – {formatDateEE(plan.period.end)}</div>
            )}
            {plan.preparedAt && (
              <div style={{ marginTop: 2 }}>Koostatud: {formatDateEE(plan.preparedAt)}</div>
            )}
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>{printMode === "apartments" ? "Korteripõhine maksete lisa" : "Majanduskava eelnõu"}</h1>

          {printMode === "full" && (<>
          {/* Kaasomandi ese */}
          <div className="print-section">
            <h2 className="print-section-title">Ülevaade kaasomandi eseme seisukorrast ja kavandatavatest toimingutest</h2>
            {seisukord.length > 0 && seisukord.some(r => r.ese) ? (() => {
              const p1sy = plan.period.start ? Number(plan.period.start.slice(0, 4)) : null;
              const p1ey = plan.period.end ? Number(plan.period.end.slice(0, 4)) : null;
              const p1multi = Boolean(p1sy && p1ey && p1ey > p1sy);
              return (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", fontSize: 14, borderBottom: "2px solid #000" }}>
                      <th style={{ padding: "4px 8px" }}>Ese</th>
                      <th style={{ padding: "4px 8px" }}>Seisukord</th>
                      <th style={{ padding: "4px 8px" }}>Prioriteet</th>
                      <th style={{ padding: "4px 8px" }}>Puudused</th>
                      <th style={{ padding: "4px 8px" }}>Kavandatav toiming</th>
                      <th style={{ padding: "4px 8px", textAlign: "right" }}>Eeldatav maksumus</th>
                      {p1multi && <th style={{ padding: "4px 8px" }}>Aasta</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {seisukord.filter(r => r.ese).map((s) => (
                      <tr key={s.id} style={{ borderBottom: "1px solid #ccc" }}>
                        <td style={{ padding: "4px 8px" }}>{s.ese}</td>
                        <td style={{ padding: "4px 8px" }}>{s.seisukordVal || ""}</td>
                        <td style={{ padding: "4px 8px" }}>{s.prioriteet || ""}</td>
                        <td style={{ padding: "4px 8px" }}>{s.puudused || ""}</td>
                        <td style={{ padding: "4px 8px" }}>{s.tegevus || ""}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{s.eeldatavKulu ? euroEE(s.eeldatavKulu) : ""}</td>
                        {p1multi && <td style={{ padding: "4px 8px" }}>{s.tegevusAasta || ""}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })() : (
              <p style={{ fontSize: 14, color: "#666" }}>Andmeid ei ole sisestatud.</p>
            )}
          </div>

          {/* p2: Korteriühistu kavandatavad tulud ja kulud */}
          <div className="print-section">
            <h2 className="print-section-title">Korteriühistu kavandatavad tulud ja kulud</h2>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Kavandatavad tulud</div>
              {(() => {
              const mEq = derived.period.monthEq || 12;

              const haldusSum = plan.budget.costRows
                .filter(r => HALDUSTEENUSED.includes(r.category))
                .reduce((s, r) => {
                  const v = parseFloat(r.summaInput) || 0;
                  if (r.arvutus === "aastas") return s + Math.round(v / 12 * mEq);
                  if (r.arvutus === "perioodis") return s + Math.round(v);
                  return s + Math.round(v * mEq);
                }, 0);

              const muudSum = plan.budget.incomeRows
                .reduce((s, r) => {
                  const v = parseFloat(r.summaInput) || 0;
                  if (r.arvutus === "aastas") return s + Math.round(v / 12 * mEq);
                  if (r.arvutus === "perioodis") return s + Math.round(v);
                  return s + Math.round(v * mEq);
                }, 0);

              const kokku = haldusSum + muudSum;
              if (haldusSum === 0 && muudSum === 0) return <p style={{ fontSize: 14, color: "#666" }}>Tulude andmed on sisestamata.</p>;
              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                    <span><span style={{ color: "#666" }}>Arvutatud kulude põhjal · </span>Haldustasu</span>
                    <span style={{ fontFamily: "monospace" }}>{euroEE(haldusSum)}</span>
                  </div>
                  {plan.budget.incomeRows.filter(r => (parseFloat(r.summaInput) || 0) > 0).map(r => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                      <span>{r.category ? <span style={{ color: "#666" }}>{r.category} · </span> : ""}{r.name || "—"}</span>
                      <span style={{ fontFamily: "monospace" }}>
                        {euroEE(r.calc?.params?.amountEUR || 0)}
                      </span>
                    </div>
                  ))}
                  <div style={{ marginTop: 8, fontWeight: 600, fontFamily: "monospace" }}>
                    Kokku: {euroEE(kokku)} · {euroEE(kokku / mEq)}/kuu
                  </div>
                </>
              );
            })()}
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Kavandatavad kulud</div>
              {(() => {
              const rows = plan.budget.costRows.filter(r => (parseFloat(r.summaInput) || 0) > 0);
              if (rows.length === 0) return <div>Kulude andmed on sisestamata.</div>;
              const p5Sum = rows
                .filter(r => P5_KOMMUNAALTEENUSED.includes(r.category))
                .reduce((s, r) => s + (r.calc?.params?.amountEUR || 0), 0);
              let p5Rendered = false;
              return (
                <>
                  {rows.map(r => {
                    if (P5_KOMMUNAALTEENUSED.includes(r.category)) {
                      if (p5Rendered) return null;
                      p5Rendered = true;
                      return (
                        <div key="kommunaalid-kokku" style={{ padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>
                              <span style={{ color: "#666" }}>Kommunaalteenused kokku</span>
                              <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>Detailne kogus ja maksumus on esitatud kommunaalteenuste prognoosi plokis.</div>
                            </span>
                            <span style={{ fontFamily: "monospace" }}>{euroEE(p5Sum)}</span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={r.id} style={{ padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>
                            {r.category ? <span style={{ color: "#666" }}>{r.category}</span> : null}
                            {r.category && r.name ? " · " : ""}
                            {r.name || (!r.category ? "—" : "")}
                            {" "}<span style={{ fontSize: 12, color: "#999" }}>({jaotusalusSilt(
                              HALDUSTEENUSED.includes(r.category)
                                ? getEffectiveAllocationBasis(plan.allocationPolicies?.maintenance)
                                : getEffectiveRowAllocationBasis(r)
                            )})</span>
                          </span>
                          <span style={{ fontFamily: "monospace" }}>
                            {euroEE(r.calc.params.amountEUR)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 8, fontWeight: 600, fontFamily: "monospace" }}>
                    Kokku: {euroEE(derived.totals.costPeriodEUR)} · {euroEE(derived.totals.costMonthlyEUR)}/kuu
                  </div>
                </>
              );
            })()}
            </div>
          </div>

          {/* Laenukohustused ja rahastamisallikad */}
          {plan.loans.length > 0 && (() => {
            const olemasolevad = plan.loans.filter(l => !l.sepiiriostudInvId);
            const planeeritud  = plan.loans.filter(l => !!l.sepiiriostudInvId);
            const loanRows = (items, showInv) => items.map(l => {
              const inv = showInv ? plan.investments.items.find(i => i.id === l.sepiiriostudInvId) : null;
              return (
                <tr key={l.id} style={{ borderBottom: "1px solid #ccc" }}>
                  <td style={{ padding: "4px 8px" }}>{l.name || "—"}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(l.principalEUR)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{l.annualRatePct ? `${l.annualRatePct} %` : "—"}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{l.termMonths || "—"}</td>
                  <td style={{ padding: "4px 8px" }}>{l.startYM || "—"}</td>
                  {showInv && <td style={{ padding: "4px 8px" }}>{inv?.name || "—"}</td>}
                </tr>
              );
            });
            const loanTable = (items, showInv) => (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: 13, borderBottom: "2px solid #000" }}>
                    <th style={{ padding: "4px 8px" }}>Nimetus</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Põhikohustus</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Intress %</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Tähtaeg (kuu)</th>
                    <th style={{ padding: "4px 8px" }}>Alguskuu</th>
                    {showInv && <th style={{ padding: "4px 8px" }}>Investeering</th>}
                  </tr>
                </thead>
                <tbody>{loanRows(items, showInv)}</tbody>
              </table>
            );
            return (
              <div className="print-section">
                <h2 className="print-section-title">Laenukohustused ja rahastamisallikad</h2>
                <p style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
                  Laenusumma ei ole tavatulu. Laenu teenindamise mõju kajastub kuludes ja kohustuste jaotuses.
                </p>
                {olemasolevad.length > 0 && (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Olemasolevad laenukohustused</div>
                    {loanTable(olemasolevad, false)}
                  </>
                )}
                {planeeritud.length > 0 && (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 13, marginTop: 12, marginBottom: 4 }}>Planeeritud uued laenud</div>
                    {loanTable(planeeritud, true)}
                  </>
                )}
                {derived.loans.servicePeriodEUR > 0 && (
                  <div style={{ marginTop: 12, fontWeight: 600, fontFamily: "monospace", fontSize: 13 }}>
                    <div>Laenu teenindamine kuus: {euroEE(derived.loans.serviceMonthlyEUR)}</div>
                    <div>Laenu teenindamine perioodis: {euroEE(derived.loans.servicePeriodEUR)}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Plokk 6: Korteriomanike kohustuste jaotus majandamiskulude kandmisel */}
          <div className="print-section">
            <h2 className="print-section-title">Korteriomanike kohustuste jaotus majandamiskulude kandmisel</h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 14, borderBottom: "2px solid #000" }}>
                  <th style={{ padding: "4px 8px" }}>Kululiik</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Makse perioodis</th>
                  <th style={{ padding: "4px 8px" }}>Jaotamise alus</th>
                </tr>
              </thead>
              <tbody>
                {plan.budget.costRows.filter(r => (parseFloat(r.summaInput) || 0) > 0).map(r => {
                  const effectiveBasis = HALDUSTEENUSED.includes(r.category)
                    ? getEffectiveAllocationBasis(plan.allocationPolicies?.maintenance)
                    : getEffectiveRowAllocationBasis(r);
                  const selectedBasis = r.allocationBasis || "m2";
                  const alus = p3AlusSilt(effectiveBasis);
                  const showSelectedNote = !HALDUSTEENUSED.includes(r.category) && selectedBasis !== effectiveBasis;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px" }}>
                        {r.category ? <span style={{ color: "#666" }}>{r.category}{r.name ? " · " : ""}</span> : null}
                        {r.name || (!r.category ? "—" : "")}
                      </td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(r.calc?.params?.amountEUR || 0)}</td>
                      <td style={{ padding: "4px 8px" }}>
                        {alus}
                        {showSelectedNote && <div style={{ fontSize: 12, color: "#666" }}>Valitud: {p3AlusSilt(selectedBasis)} (õiguslik alus puudub)</div>}
                        {r.legalBasisBylaws && <div style={{ fontSize: 12, color: "#666" }}>Õiguslik alus: põhikiri</div>}
                        {r.legalBasisSpecialAgreement && <div style={{ fontSize: 12, color: "#666" }}>Õiguslik alus: erikokkulepe</div>}
                        {r.settledPostHoc && <div style={{ fontSize: 12, color: "#666" }}>Tasutakse pärast kulude suuruse selgumist</div>}
                        {r.selgitus && <div style={{ fontSize: 12, color: "#666" }}>{r.selgitus}</div>}
                      </td>
                    </tr>
                  );
                })}
                {remondifondiArvutus.laekuminePerioodis > 0 && (() => {
                  const basis = getEffectiveAllocationBasis(plan.allocationPolicies?.remondifond);
                  const alus = p3AlusSilt(basis);
                  return (
                    <tr style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px" }}>Remondifondi makse</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(remondifondiArvutus.laekuminePerioodis)}</td>
                      <td style={{ padding: "4px 8px" }}>
                        {alus}
                        {plan.allocationPolicies?.remondifond?.legalBasisType === "BYLAWS_EXCEPTION" && (
                          <div style={{ fontSize: 12, color: "#666" }}>{plan.allocationPolicies.remondifond.legalBasisText?.trim() || "Erand põhikirja järgi"}</div>
                        )}
                      </td>
                    </tr>
                  );
                })()}
                {(plan.funds.reserve.plannedEUR || 0) > 0 && (() => {
                  const basis = getEffectiveAllocationBasis(plan.allocationPolicies?.reserve);
                  const alus = p3AlusSilt(basis);
                  return (
                    <tr style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px" }}>Reservkapitali makse</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(plan.funds.reserve.plannedEUR)}</td>
                      <td style={{ padding: "4px 8px" }}>
                        {alus}
                        {plan.allocationPolicies?.reserve?.legalBasisType === "BYLAWS_EXCEPTION" && (
                          <div style={{ fontSize: 12, color: "#666" }}>{plan.allocationPolicies.reserve.legalBasisText?.trim() || "Erand põhikirja järgi"}</div>
                        )}
                      </td>
                    </tr>
                  );
                })()}
                {kopiiriondvaade.laenumaksedKokku > 0 && (() => {
                  const laenPeriood = Math.round(kopiiriondvaade.laenumaksedKokku * (derived.period.monthEq || 12));
                  return (
                    <tr style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px" }}>
                        Laenumaksed
                        {remondifondiArvutus.onLaen && loanStatus !== "APPROVED" && (
                          <div style={{ fontSize: 12, color: "#666" }}>Planeeritud laen: tingimuslik (ei sisaldu)</div>
                        )}
                        {remondifondiArvutus.onLaen && loanStatus === "APPROVED" && (
                          <div style={{ fontSize: 12, color: "#666" }}>Sisaldab kinnitatud planeeritud laenu</div>
                        )}
                      </td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(laenPeriood)}</td>
                      <td style={{ padding: "4px 8px" }}>{p3AlusSilt("m2")}</td>
                    </tr>
                  );
                })()}
                {plan.budget.costRows.filter(r => (parseFloat(r.summaInput) || 0) > 0).length === 0
                  && remondifondiArvutus.laekuminePerioodis <= 0
                  && (plan.funds.reserve.plannedEUR || 0) <= 0
                  && kopiiriondvaade.laenumaksedKokku <= 0 && (
                  <tr><td colSpan={3} style={{ padding: "8px 8px", color: "#666" }}>Kohustuste jaotuse andmed on sisestamata.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Plokk 7: Remondifondi ja reservkapitali maksed */}
          {(() => {
            const rf = remondifondiArvutus;
            const reservPeriood = plan.funds.reserve.plannedEUR || 0;
            return (
              <div className="print-section">
                <h2 className="print-section-title">Reservkapitali ja remondifondi tehtavate maksete suurus</h2>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Remondifond</div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>{summarizeAllocationPolicy(plan.allocationPolicies?.remondifond)}</div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                  <span>Saldo perioodi alguses</span><span style={{ fontFamily: "monospace" }}>{euroEE(rf.saldoAlgus)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                  <span>Laekumine perioodis</span><span style={{ fontFamily: "monospace" }}>{euroEE(rf.laekuminePerioodis)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                  <span>Investeeringud perioodis</span><span style={{ fontFamily: "monospace" }}>{rf.investRemondifondist > 0 ? "−" : ""}{euroEE(rf.investRemondifondist)}</span>
                </div>
                {rf.p2Remondifondist > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                    <span>Tegevuskulud RF-st</span><span style={{ fontFamily: "monospace" }}>−{euroEE(rf.p2Remondifondist)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontWeight: 600, color: rf.saldoLopp < 0 ? "#c53030" : "inherit" }}>
                  <span>Saldo perioodi lõpus</span><span style={{ fontFamily: "monospace" }}>{euroEE(rf.saldoLopp)}</span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 12, marginBottom: 4 }}>Reservkapital</div>
                {reservPeriood > 0 ? (
                  <>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>{summarizeAllocationPolicy(plan.allocationPolicies?.reserve)}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                      <span>Kavandatud reserv</span><span style={{ fontFamily: "monospace" }}>{euroEE(reservPeriood)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                      <span>Kuumakse</span><span style={{ fontFamily: "monospace" }}>{euro(Math.round(reservPeriood / 12))}/kuu</span>
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: 14, color: "#666", margin: "4px 0 0" }}>Ei ole kavandatud.</p>
                )}
              </div>
            );
          })()}

          {/* Plokk 8: Kütus / soojus / vesi ja kanalisatsioon / elekter */}
          {(() => {
            const utilityRows = plan.budget.costRows.filter(r => P5_KOMMUNAALTEENUSED.includes(r.category) && (parseFloat(r.summaInput) || 0) > 0);
            return (
              <div className="print-section">
                <h2 className="print-section-title">Kütuse, soojuse, vee- ja kanalisatsiooniteenuse ning elektri prognoositav kogus ja maksumus</h2>
                {utilityRows.length === 0 ? (
                  <p style={{ fontSize: 14, color: "#666" }}>Andmed on sisestamata.</p>
                ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", fontSize: 14, borderBottom: "2px solid #000" }}>
                      <th style={{ padding: "4px 8px" }}>Liik</th>
                      <th style={{ padding: "4px 8px", textAlign: "right" }}>Prognoositav kogus</th>
                      <th style={{ padding: "4px 8px" }}>Ühik</th>
                      <th style={{ padding: "4px 8px", textAlign: "right" }}>Maksumus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {utilityRows.map(r => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #ccc" }}>
                        <td style={{ padding: "4px 8px" }}>
                          {r.category}{r.name ? <> · <span style={{ color: "#666" }}>{r.name}</span></> : null}
                          {r.settledPostHoc && <div style={{ fontSize: 12, color: "#666" }}>Tasutakse pärast kulude suuruse selgumist</div>}
                        </td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{r.kogus || <span style={{ color: "#999", fontStyle: "italic" }}>kogus määramata</span>}</td>
                        <td style={{ padding: "4px 8px" }}>{r.uhik || ""}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{euroEE(r.calc?.params?.amountEUR || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>
            );
          })()}

          {/* Jaluse viited / lühiselgitused */}
          {(() => {
            const notes = [];
            const rows = plan.budget.costRows.filter(r => (parseFloat(r.summaInput) || 0) > 0);
            const paymentRows = rows.filter(r => !r.settledPostHoc);
            if (paymentRows.some(r => r.legalBasisBylaws)) notes.push("Jaotatakse põhikirja alusel.");
            if (paymentRows.some(r => r.legalBasisSpecialAgreement)) notes.push("Jaotatakse erikokkuleppe alusel.");
            const rowEffectiveBasis = (r) => HALDUSTEENUSED.includes(r.category)
              ? getEffectiveAllocationBasis(plan.allocationPolicies?.maintenance)
              : getEffectiveRowAllocationBasis(r);
            if (paymentRows.some(r => rowEffectiveBasis(r) === "m2")) notes.push("Makse on arvutatud üldpinna alusel.");
            if (paymentRows.some(r => rowEffectiveBasis(r) === "apartment" || rowEffectiveBasis(r) === "korter")) notes.push("Makse on arvutatud korterite arvu alusel.");
            if (loanStatus === "APPLIED" && plan.loans.some(l => l.sepiiriostudInvId)) notes.push("Laenumakse rakendub laenu võtmisel.");
            if (remondifondiArvutus.laekuminePerioodis > 0) notes.push("Remondifondi makse kogutakse kavandatud tööde katteks.");
            if ((plan.funds.reserve.plannedEUR || 0) > 0) notes.push("Reservkapital on määratud ettenägematute kulude katteks.");
            if (rows.some(r => r.forecastAdjustmentEnabled)) notes.push("Sisaldab prognoosivaru.");
            if ((plan.investments?.items || []).some(i => i.contingencyEnabled)) notes.push("Sisaldab ettenägematute kulude varu.");
            if (notes.length === 0) return null;
            return (
              <div className="print-section">
                <h2 className="print-section-title">Jaluse viited</h2>
                <ol style={{ margin: 0, paddingLeft: 24, fontSize: 13, lineHeight: 1.6 }}>
                  {notes.map((n, i) => <li key={i}>{n}</li>)}
                </ol>
              </div>
            );
          })()}

          </>)}

          {printMode === "apartments" && (
          <div className="print-section">
            <h2 className="print-section-title">Korteriomanike kuumaksed</h2>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              Haldus / hooldus · {summarizeAllocationPolicy(plan.allocationPolicies?.maintenance)}
            </div>
            {(() => {
              const showLaen = remondifondiArvutus.onLaen;
              const showReserv = (plan.funds.reserve.plannedEUR || 0) > 0;
              const rr = { textAlign: "right", fontFamily: "monospace" };
              return (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: 14, borderBottom: "2px solid #000" }}>
                    <th style={{ padding: "4px 8px" }}>Korter</th>
                    <th style={{ padding: "4px 8px", ...rr }}>Korteri pindala (m²)</th>
                    <th style={{ padding: "4px 8px", ...rr }}>Kommunaal</th>
                    <th style={{ padding: "4px 8px", ...rr }}>Haldus</th>
                    <th style={{ padding: "4px 8px", ...rr }}>Remondifond</th>
                    {showReserv && <th style={{ padding: "4px 8px", ...rr }}>Reservkapital</th>}
                    {showLaen && <th style={{ padding: "4px 8px", ...rr }}>Laenumakse</th>}
                    <th style={{ padding: "4px 8px", ...rr }}>Kuumakse ilma laenuta</th>
                  </tr>
                </thead>
                <tbody>
                  {korteriteKuumaksed.map(km => (
                    <tr key={km.id} style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px", fontWeight: 600 }}>{km.tahis}</td>
                      <td style={{ padding: "4px 8px", ...rr }}>{km.pind.toFixed(2)}</td>
                      <td style={{ padding: "4px 8px", ...rr }}>{euroEE(km.kommunaal)}</td>
                      <td style={{ padding: "4px 8px", ...rr }}>{euroEE(km.haldus)}</td>
                      <td style={{ padding: "4px 8px", ...rr }}>{euroEE(km.remondifond)}</td>
                      {showReserv && <td style={{ padding: "4px 8px", ...rr }}>{euroEE(km.reserv)}</td>}
                      {showLaen && <td style={{ padding: "4px 8px", ...rr }}>{euroEE(km.laenumakse)}</td>}
                      <td style={{ padding: "4px 8px", ...rr, fontWeight: 600 }}>{euroEE(km.kokku)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              );
            })()}
          </div>
          )}

        </div>
      )}
      </main>
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          cancelLabel={confirmModal.cancelLabel}
          onConfirm={() => { const fn = confirmModal.onConfirm; setConfirmModal(null); fn(); }}
          onCancel={() => { const fn = confirmModal.onCancel; setConfirmModal(null); if (fn) fn(); }}
        />
      )}
    </div>
  );
}
