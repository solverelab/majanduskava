// src/App.jsx
import { Fragment, useEffect, useMemo, useState } from "react";
import { defaultPlan, mkApartment, mkCashflowRow, mkInvestmentItem, mkLoan } from "./domain/planSchema";
import { computePlan, euro } from "./engine/computePlan";
import { runPlan, applyActionAndRun, applyOnly, setPreset as setHostPreset, runAutoResolve, SOLVERE_CORE_CONTRACT_VERSION } from "./solvereBridge/majanduskavaHost";
import { buildStateSignature } from "../packages/solvere-core/src/moduleHost.ts";
import { TracePanel } from "./components/TracePanel";
import { AddressSearch } from "./components/AddressSearch";

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

// ── INPUTS ──
const inputBase  = { padding: "8px 10px", border: `1px solid ${N.border}`, borderRadius: 6, fontSize: 15, background: N.surface, color: N.text, outline: "none" };
const inputStyle = { ...inputBase, width: "100%" };
const numStyle   = { ...inputStyle, fontFamily: "monospace", textAlign: "right" };
const selectStyle = { ...inputBase, padding: "6px 10px" };
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
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
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
const _btnBase    = { padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 15, border: "none", lineHeight: 1.4 };
const btnPrimary  = { ..._btnBase, background: N.accent, color: "#fff", fontWeight: 700 };
const btnSecondary = { ..._btnBase, background: N.surface, color: N.text, fontWeight: 600, border: `1px solid ${N.border}` };
const btnAdd      = { ..._btnBase, background: N.muted, color: N.sub, fontWeight: 600, border: `1px solid ${N.border}` };
const btnRemove   = { ..._btnBase, background: "transparent", color: N.dim, fontWeight: 500, padding: "6px 10px", fontSize: 14 };
const btn         = btnSecondary; // legacy alias

// ── CATEGORIES & ENUMS ──
const KOMMUNAALTEENUSED = ["Soojus", "Vesi ja kanalisatsioon", "Elekter", "Kütus", "Muu kommunaalteenus"];

const HALDUSTEENUSED = ["Haldus", "Raamatupidamine", "Koristus", "Kindlustus", "Hooldus", "Prügivedu", "Muu haldusteenus"];

const LAENUMAKSED = ["Laenumakse"];

const KULU_KATEGOORIAD = [...KOMMUNAALTEENUSED, ...HALDUSTEENUSED, ...LAENUMAKSED];

const TULU_KATEGOORIAD = ["Renditulu", "Muu tulu"];

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
  const [repairFundSaldo, setRepairFundSaldo] = useState(""); // tagasiühilduvus
  const [remondifond, setRemondifond] = useState({
    saldoAlgus: "",
    kogumisViis: "eraldi",      // "eraldi" | "uhine"
    pangaKoefitsient: 1.15,     // vaikimisi 1.15
    pangaMaarOverride: null,    // null = auto, number = käsitsi €/m²/a
  });


  const derived = useMemo(() => computePlan(plan), [plan]);

  const reserveMin = useMemo(() => {
    const aastaKulud = plan.budget.costRows.reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
    const noutavMiinimum = Math.round(aastaKulud / 12);
    return { aastaKulud, noutavMiinimum };
  }, [plan.budget.costRows]);

  // Auto-täida reserv miinimumiga ainult siis, kui kasutaja pole midagi sisestanud (null/undefined/0).
  useEffect(() => {
    const min = reserveMin.noutavMiinimum;
    setPlan(p => {
      const cur = p?.funds?.reserve?.plannedEUR;
      if (cur == null || cur === 0) {
        return { ...p, funds: { ...p.funds, reserve: { ...p.funds.reserve, plannedEUR: min } } };
      }
      return p;
    });
  }, [reserveMin.noutavMiinimum]);

  const kopiiriondvaade = useMemo(() => {
    // Map actual field names → Estonian aliases
    const mEq = derived.period.monthEq || 12;
    const kulud = plan.budget.costRows.map(r => ({
      kategooria: r.category,
      kogus: r.kogus,
      summaKuus: KOMMUNAALTEENUSED.includes(r.category)
               ? (parseFloat(r.summaInput) || 0) / mEq
               : r.arvutus === "aastas" ? (parseFloat(r.summaInput) || 0) / 12
               : r.arvutus === "perioodis" ? (parseFloat(r.summaInput) || 0) / mEq
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
    const kommunaalKokku = Math.round(kulud
      .filter(k => KOMMUNAALTEENUSED.some(kt => kt === k.kategooria))
      .reduce((sum, k) => sum + (parseFloat(k.summaKuus) || 0), 0));

    // Halduskulud kokku (€/kuu)
    const haldusKokku = Math.round(kulud
      .filter(k => HALDUSTEENUSED.some(ht => ht === k.kategooria))
      .reduce((sum, k) => sum + (parseFloat(k.summaKuus) || 0), 0));

    // Perioodi kogusummad (täpsed, otse summaInput-ist — kuvamiseks jaotamise alustes)
    const kommunaalPeriood = plan.budget.costRows
      .filter(r => KOMMUNAALTEENUSED.includes(r.category))
      .reduce((sum, r) => sum + (Math.round(parseFloat(r.summaInput) || 0)), 0);

    const haldusPeriood = plan.budget.costRows
      .filter(r => HALDUSTEENUSED.includes(r.category))
      .reduce((sum, r) => sum + (Math.round(parseFloat(r.summaInput) || 0)), 0);

    const kuludKokku = kommunaalKokku + haldusKokku;

    // Muu tulu kokku (€/kuu) — ainult incomeRows (ilma haldustasu ja laenumakseta)
    const muudTuludKokku = Math.round(tulud
      .reduce((sum, t) => sum + (parseFloat(t.summaKuus) || 0), 0));

    // Planeeritud laenumaksed kokku (€/kuu)
    const planeeritudLaenudKokku = laenud.reduce((sum, l) => {
      return sum + arvutaKuumakse(l.summa, l.intpiiri, l.tahtaeg);
    }, 0);

    const laenumaksedKokku = planeeritudLaenudKokku;

    // Tulud kokku = haldustasu + laenumaksed + muu tulu
    const tuludKokku = haldusKokku + laenumaksedKokku + muudTuludKokku;

    const valjaminekudKokku = kuludKokku + laenumaksedKokku;
    const vahe = tuludKokku - valjaminekudKokku;
    const vaheHaldus = tuludKokku - haldusKokku - laenumaksedKokku;

    return {
      kommunaalKokku,
      haldusKokku,
      kommunaalPeriood,
      haldusPeriood,
      kuludKokku,
      muudTuludKokku,
      tuludKokku,
      planeeritudLaenudKokku,
      laenumaksedKokku,
      valjaminekudKokku,
      vahe,
      vaheHaldus,
    };
  }, [plan.budget.costRows, plan.budget.incomeRows, plan.loans, derived.period.monthEq]);

  const remondifondiArvutus = useMemo(() => {
    const saldoAlgus = Math.round(parseFloat(String(remondifond.saldoAlgus).replace(",", ".")) || 0);
    const koguPind = derived.building.totAreaM2;
    const periodiAasta = plan.period.year || new Date().getFullYear();

    // Kõik investeeringud
    const koikInv = [
      ...seisukord.filter(e => e.investeering),
      ...muudInvesteeringud,
    ];

    // Kas rahastusplaanis on laenu?
    const sumLaen = koikInv.reduce((sum, inv) =>
      sum + (inv.rahpiiri || [])
        .filter(r => r.allikas === "Laen")
        .reduce((s, r) => s + (Math.round(parseFloat(String(r.summa).replace(",", ".")) || 0)), 0),
    0);
    const onLaen = sumLaen > 0;

    // Investeeringutest remondifondist planeeritud (kokku)
    const investRemondifondist = koikInv.reduce((sum, inv) =>
      sum + (inv.rahpiiri || [])
        .filter(r => r.allikas === "Remondifond")
        .reduce((s, r) => s + (Math.round(parseFloat(String(r.summa).replace(",", ".")) || 0)), 0),
    0);

    // ── Iga investeeringu detail (kronoloogiline järjekord) ──
    const invDetail = koikInv
      .map(inv => {
        const rfSumma = (inv.rahpiiri || [])
          .filter(r => r.allikas === "Remondifond")
          .reduce((s, r) => s + (Math.round(parseFloat(String(r.summa).replace(",", ".")) || 0)), 0);
        if (rfSumma <= 0) return null;
        const nimetus = inv.nimetus || inv.invNimetus || inv.ese || "Investeering";
        const aasta = parseInt(inv.tegevusAasta || inv.aasta) || periodiAasta;
        const kogumisaastad = Math.max(1, aasta - periodiAasta);
        return { nimetus, rfSumma, aasta, kogumisaastad };
      })
      .filter(Boolean)
      .sort((a, b) => a.aasta - b.aasta);

    // ── Kronoloogiline saldo jaotus ──
    // Saldo katab kõigepealt lähima investeeringu, ülejääk edasi
    let jääkSaldo = saldoAlgus;
    const invArvutusread = invDetail.map(d => {
      const saldost = Math.min(jääkSaldo, d.rfSumma);
      jääkSaldo = Math.max(0, jääkSaldo - d.rfSumma);
      const koguda = Math.max(0, d.rfSumma - saldost);
      const aastasKoguda = d.kogumisaastad > 0 ? koguda / d.kogumisaastad : koguda;
      return { ...d, saldost, koguda, aastasKoguda };
    });

    // ── ILMA LAENUTA: fond katab investeeringud, kogumisperioodiga ──
    let maarIlmaLaenuta = 0;

    if (koguPind > 0 && investRemondifondist > 0) {
      if (remondifond.kogumisViis === "eraldi" || invDetail.length <= 1) {
        // Eraldi (vaikimisi): iga investeeringu vajadus / selle kogumisaastad
        const totalAastaVajadus = invArvutusread.reduce((sum, d) => sum + d.aastasKoguda, 0);
        maarIlmaLaenuta = totalAastaVajadus / koguPind;
      } else {
        // Ühine: kronoloogiline saldo + pikima perioodi järgi
        const totalKoguda = invArvutusread.reduce((s, d) => s + d.koguda, 0);
        const maxKogumisaastad = invDetail.length > 0
          ? Math.max(...invDetail.map(d => d.kogumisaastad))
          : 1;
        maarIlmaLaenuta = totalKoguda / maxKogumisaastad / koguPind;
      }
    }

    // ── LAENUGA: panga nõue ──
    const laenumaksedKuus = plan.loans.reduce((sum, l) =>
      sum + arvutaKuumakse(l.principalEUR, l.annualRatePct, parseInt(l.termMonths) || 0),
    0);
    const laenumakseM2Kuus = koguPind > 0 ? laenumaksedKuus / koguPind : 0;
    const pangaKoef = remondifond.pangaKoefitsient || 1.15;
    const soovitusMaarAastasM2 = laenumakseM2Kuus * pangaKoef * 12;
    const maarLaenuga = remondifond.pangaMaarOverride != null
      ? remondifond.pangaMaarOverride
      : soovitusMaarAastasM2;

    // ── Aktiivne määr ──
    const maarAastasM2 = onLaen ? maarLaenuga : maarIlmaLaenuta;

    const laekuminePerioodis = Math.round(maarAastasM2 * koguPind);
    const saldoLopp = saldoAlgus + laekuminePerioodis - investRemondifondist;

    // ── Mõistlikkuse tase (ainult ilma-laenuta kontekstis) ──
    const maarKuusM2 = maarAastasM2 / 12;
    const tase = !onLaen
      ? (maarKuusM2 <= 0 ? "puudub"
        : maarKuusM2 <= 1.5 ? "normaalne"
        : maarKuusM2 <= 3.0 ? "korgendatud"
        : "kriitiline")
      : "normaalne"; // laenuga = pank valideerib

    return {
      saldoAlgus,
      maarAastasM2,
      maarIlmaLaenuta,
      maarLaenuga,
      soovitusMaarAastasM2,
      koguPind,
      laekuminePerioodis,
      investRemondifondist,
      saldoLopp,
      onLaen,
      invDetail,
      invArvutusread,
      laenumaksedKuus,
      laenumakseM2Kuus,
      maarKuusM2,
      tase,
    };
  }, [
    remondifond.saldoAlgus, remondifond.kogumisViis,
    remondifond.pangaKoefitsient, remondifond.pangaMaarOverride,
    derived.building.totAreaM2, plan.period.year,
    plan.loans, seisukord, muudInvesteeringud,
  ]);

  const korteriteKuumaksed = useMemo(() => {
    const apts = plan.building.apartments;
    const koguPind = derived.building.totAreaM2;
    const ra = remondifondiArvutus;

    const rfKuuKokku = ra.maarAastasM2 * koguPind / 12;
    const laenKuuKokku = ra.onLaen ? ra.laenumaksedKuus : 0;
    const reservKuuKokku = (plan.funds.reserve.plannedEUR || 0) / 12;

    return apts.map(k => {
      const pind = parseFloat(k.areaM2) || 0;
      const osa = koguPind > 0 ? pind / koguPind : 0;

      const kommunaal = Math.round(kopiiriondvaade.kommunaalKokku * osa);
      const haldus = Math.round(kopiiriondvaade.haldusKokku * osa);
      const rf = Math.round(rfKuuKokku * osa);
      const laen = Math.round(laenKuuKokku * osa);
      const reserv = Math.round(reservKuuKokku * osa);
      const kokku = kommunaal + haldus + rf + laen + reserv;

      return { id: k.id, tahis: k.label, pind, osa, kommunaal, haldus, remondifond: rf, laenumakse: laen, reserv, kokku };
    });
  }, [plan.building.apartments, derived.building.totAreaM2, remondifondiArvutus, kopiiriondvaade, plan.funds.reserve.plannedEUR]);

  // Sünkrooni arvutatud remondifondi määr engine'iga
  useEffect(() => {
    const kuuMaar = remondifondiArvutus.maarAastasM2 / 12;
    if (plan.funds.repairFund.monthlyRateEurPerM2 !== kuuMaar) {
      setPlan(p => ({ ...p, funds: { ...p.funds, repairFund: { monthlyRateEurPerM2: kuuMaar } } }));
    }
  }, [remondifondiArvutus.maarAastasM2]);

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

  const [avaKorterDetail, setAvaKorterDetail] = useState({});

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
      repairFundSaldo,
      remondifond,
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
        // Strip investment quarters from old data
        if (candidateState.investmentsPipeline?.items) {
          candidateState.investmentsPipeline.items = candidateState.investmentsPipeline.items.map(({ quarter: _ignored, ...rest }) => rest);
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
              ? { kogus: "", uhik: KOMMUNAAL_VAIKE_UHIK[r.category] || "", uhikuHind: "", ...r }
              : { arvutus: "perioodis", summaInput: r.calc?.params?.amountEUR || 0, ...r };
          });
        }
        // Migrate loan → algusAasta
        if (candidateState.loans) {
          const fallbackY = String(plan.period.year || new Date().getFullYear());
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
        setPlan(candidateState);
        // Sync KÜ data
        if (data.kyData) setKyData(data.kyData);
        setRepairFundSaldo(data.repairFundSaldo ?? "");
        if (data.remondifond) {
          setRemondifond({
            saldoAlgus: data.remondifond.saldoAlgus || "",
            kogumisViis: data.remondifond.kogumisViis || "eraldi",
            pangaKoefitsient: data.remondifond.pangaKoefitsient ?? 1.15,
            pangaMaarOverride: data.remondifond.pangaMaarOverride ?? null,
          });
        } else if (data.repairFundSaldo) {
          setRemondifond({
            saldoAlgus: data.repairFundSaldo,
            kogumisViis: "eraldi",
            pangaKoefitsient: 1.15,
            pangaMaarOverride: null,
          });
        }
        // Migrate seisukord + old investments → eseme-based
        let importedSeisukord = [];
        if (data.seisukord) {
          if (typeof data.seisukord === "string") importedSeisukord = [];
          else importedSeisukord = data.seisukord.map(r => {
            const { tegevusKvartal: _ignored, ...rest } = r;
            return { tegevusAasta: "", investeering: false, invNimetus: "", invMaksumus: 0, rahpiiri: [], id: crypto.randomUUID(), ...rest };
          });
        }
        // Migrate old separate investments into seisukord items or muudInvesteeringud
        const oldItems = candidateState.investmentsPipeline?.items || [];
        const importedMuudInv = [];
        if (oldItems.length > 0 && !importedSeisukord.some(r => r.investeering)) {
          oldItems.forEach(inv => {
            const seotud = inv.seisukordId ? importedSeisukord.find(e => e.id === inv.seisukordId) : null;
            const rahpiiri = (inv.fundingPlan || []).map(fp => ({ allikas: ({ REPAIR_FUND: "Remondifond", RESERVE: "Remondifond", LOAN: "Laen", GRANT: "Toetus", ONE_OFF: "Sihtmakse" })[fp.source] || fp.source, summa: fp.amountEUR || 0 }));
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
              maksumus: r.invMaksumus || 0,
              rahpiiri: r.rahpiiri || [],
            });
            return false;
          }
          return r.ese !== "Muu"; // drop non-investment "Muu" items too
        });
        // Migreeri vanad rahastusallika nimed
        const migreeriAllikas = (a) => a === "Erakorraline makse" ? "Sihtmakse" : a === "Reservkapital" ? "Remondifond" : a;
        importedSeisukord.forEach(e => { if (e.rahpiiri) e.rahpiiri = e.rahpiiri.map(rp => ({ ...rp, allikas: migreeriAllikas(rp.allikas) })); });
        importedMuudInv.forEach(e => { if (e.rahpiiri) e.rahpiiri = e.rahpiiri.map(rp => ({ ...rp, allikas: migreeriAllikas(rp.allikas) })); });
        setSeisukord(importedSeisukord);
        // Merge: new-format muudInvesteeringud + migrated old items
        const newFormatMuud = Array.isArray(data.muudInvesteeringud) ? data.muudInvesteeringud : [];
        newFormatMuud.forEach(e => { if (e.rahpiiri) e.rahpiiri = e.rahpiiri.map(rp => ({ ...rp, allikas: migreeriAllikas(rp.allikas) })); });
        setMuudInvesteeringud([...newFormatMuud, ...importedMuudInv]);
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

  const handleApartmentsLoaded = (apartmentsFromEHR) => {
    setPlan(p => {
      const existing = p.building.apartments;
      const hasReal = existing.some(a => a.areaM2 > 0 || (a.label && a.label !== "1"));
      if (hasReal && existing.length > 0) {
        const ok = window.confirm(
          `Hoones leiti ${apartmentsFromEHR.length} korterit. Kas asendada olemasolevad ${existing.length} korterit?`
        );
        if (!ok) return p;
      }
      const newApts = apartmentsFromEHR.map(a =>
        mkApartment({ label: a.number, areaM2: a.area })
      );
      return { ...p, building: { ...p.building, apartments: newApts } };
    });
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
        ? { category: "", kogus: "", uhik: "", uhikuHind: "", arvutus: "aastas", summaInput: 0 }
        : { category: "Muu tulu", arvutus: "aastas", summaInput: "" }),
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
      investeering: false,
      invNimetus: "",
      invMaksumus: 0,
      rahpiiri: [],
    }]);
  };

  const uuendaSeisukord = (id, field, value) => {
    setSeisukord(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      // Kui eeldatavKulu muutub ja investeering on aktiivne, sünkroniseeri maksumus
      if (field === "eeldatavKulu" && r.investeering) {
        updated.invMaksumus = value || 0;
      }
      if (field === "invMaksumus") {
        updated.eeldatavKulu = value || 0;
      }
      return updated;
    }));
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
      ...r, rahpiiri: [...r.rahpiiri, { allikas: "", summa: 0 }],
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
      i === idx ? { ...inv, rahpiiri: [...inv.rahpiiri, { allikas: "", summa: "" }] } : inv
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
        algusAasta: y,
        sepiiriostudInvId: investeeringId,
        principalEUR: laenSumma,
        termMonths: 12,
      }]};
    });
  };

  const eemaldaSeostudLaen = (investeeringId) => {
    const seotud = plan.loans.find(l => l.sepiiriostudInvId === investeeringId);
    if (!seotud) return;
    if (seotud.annualRatePct || seotud.termMonths) {
      if (!window.confirm("Eemaldada ka seotud laenurida Fondid & laen sektsioonist?")) {
        setPlan(p => ({ ...p, loans: p.loans.map(l =>
          l.sepiiriostudInvId === investeeringId ? { ...l, sepiiriostudInvId: null } : l
        )}));
        return;
      }
    }
    setPlan(p => ({ ...p, loans: p.loans.filter(l => l.sepiiriostudInvId !== investeeringId) }));
  };

  const addLoan = () => {
    const y = String(plan.period.year || new Date().getFullYear());
    setPlan(p => ({ ...p, loans: [...p.loans, { ...mkLoan({ startYM: `${y}-01` }), liik: "Remondilaen", algusAasta: y, sepiiriostudInvId: null, termMonths: 12 }] }));
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

  const removeLoan = (id) => {
    const ln = plan.loans.find(l => l.id === id);
    if (ln?.sepiiriostudInvId) {
      if (!window.confirm("See laen on seotud investeeringuga. Eemaldada?")) return;
    }
    setPlan(p => ({ ...p, loans: p.loans.filter(l => l.id !== id) }));
  };

  // Auto-add one empty row when section is empty (setPlan, not addX — idempotent even if effect fires twice)
  useEffect(() => { if (plan.building.apartments.length === 0) setPlan(p => ({ ...p, building: { ...p.building, apartments: [mkApartment({ label: "1" })] } })); }, [plan.building.apartments.length]);
  // Investeeringud algavad tühjana — luuakse ainult "Loo investeering" või "+ Lisa investeering" kaudu
  useEffect(() => { if (plan.budget.costRows.length === 0) setPlan(p => ({ ...p, budget: { ...p.budget, costRows: [{ ...mkCashflowRow({ side: "COST" }), category: "", kogus: "", uhik: "", uhikuHind: "", arvutus: "aastas", summaInput: 0 }] } })); }, [plan.budget.costRows.length]);
  useEffect(() => { if (plan.budget.incomeRows.length === 0) setPlan(p => ({ ...p, budget: { ...p.budget, incomeRows: [{ ...mkCashflowRow({ side: "INCOME" }), category: "Muu tulu", arvutus: "aastas", summaInput: "" }] } })); }, [plan.budget.incomeRows.length]);

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
      // Kõik ülejäänud tundmatud → "Muu tulu"
      if (r.category && r.category !== "Muu tulu") {
        changed = true;
        return { ...r, category: "Muu tulu" };
      }
      return r;
    }).filter(Boolean);
    if (changed) setPlan(p => ({ ...p, budget: { ...p.budget, incomeRows: filtered } }));
  }, []);

  // Kulude summa sünkroonimine engine'ile (→ calc.params.amountEUR)
  useEffect(() => {
    let changed = false;
    const updated = plan.budget.costRows.map(r => {
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
      maksumus: e.invMaksumus,
      rahpiiri: e.rahpiiri || [],
      _src: "ese",
    })),
    ...muudInvesteeringud.map(inv => ({
      id: inv.id,
      nimetus: inv.nimetus,
      aasta: inv.aasta,
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
        totalCostEUR: inv.maksumus || 0,
      }),
      id: inv.id + (inv._src === "ese" ? "::inv" : "::muuInv"),
      seisukordId: inv._src === "ese" ? inv.id : null,
      fundingPlan: inv.rahpiiri.map(rp => ({ source: rp.allikas, amountEUR: rp.summa || 0 })),
    }));
    const prev = plan.investmentsPipeline.items;
    const same = prev.length === items.length && items.every((it, i) =>
      prev[i]?.id === it.id && prev[i]?.name === it.name && prev[i]?.totalCostEUR === it.totalCostEUR
      && prev[i]?.plannedYear === it.plannedYear
      && JSON.stringify(prev[i]?.fundingPlan) === JSON.stringify(it.fundingPlan)
    );
    if (!same) setPlan(p => ({ ...p, investmentsPipeline: { ...p.investmentsPipeline, items } }));
  }, [seisukord, muudInvesteeringud]);

  // Laenud algavad tühjana — luuakse ainult "+ Lisa laen" kaudu või rahastusplaanist automaatselt
  useEffect(() => { if (seisukord.length === 0) { const y = String(plan.period.year || new Date().getFullYear()); setSeisukord([{ id: crypto.randomUUID(), ese: "", seisukordVal: "", puudused: "", prioriteet: "", eeldatavKulu: 0, tegevus: "", tegevusAasta: y, investeering: false, invNimetus: "", invMaksumus: 0, rahpiiri: [] }]); } }, [seisukord.length]);

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
    setPlan(p => {
      const updated = p.loans.map(l => (!l.algusAasta || l.algusAasta === "") ? { ...l, algusAasta: ys } : l);
      return updated.some((l, i) => l !== p.loans[i]) ? { ...p, loans: updated } : p;
    });
  }, [plan.period.year]);

  const SECS = ["Periood & korterid", "Esemed ja investeeringud", "Kulud", "Tulud", "Fondid & laen", "Korterite maksed", "Kontroll & kokkuvõte"];

  const clearSection = (tabIdx) => {
    if (!window.confirm("Kas soovid selle jaotise andmed kustutada? Seda ei saa tagasi võtta.")) return;
    if (tabIdx === 0) { setKyData({ nimi: "", registrikood: "", aadress: "" }); }
    setPlan(p => {
      if (tabIdx === 0) return { ...p, period: { ...p.period, start: "", end: "" }, building: { ...p.building, apartments: [] } };
      if (tabIdx === 1) { setSeisukord([]); setMuudInvesteeringud([]); return { ...p, investmentsPipeline: { ...p.investmentsPipeline, items: [] } }; }
      if (tabIdx === 2) return { ...p, budget: { ...p.budget, costRows: [] } };
      if (tabIdx === 3) return { ...p, budget: { ...p.budget, incomeRows: [] } };
      if (tabIdx === 4) { setRepairFundSaldo(""); setRemondifond({ saldoAlgus: "" }); return { ...p, funds: { repairFund: { monthlyRateEurPerM2: 0 }, reserve: { plannedEUR: 0 } }, loans: [] }; }
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

        {/* ── Koondvaade — nähtav alates Tab 2 ── */}
        {sec === 4 && (() => {
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
          const kvNum = { fontFamily: "monospace", fontWeight: 700, fontSize: 15 };
          const kvLabel = { fontSize: 12, color: N.dim, minWidth: 110 };
          const kvSep = { color: N.border, margin: "0 6px", fontSize: 13 };
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

            {/* KÜ andmed */}
            <div style={card}>
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Korteriühistu andmed</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 240px" }}>
                  <AddressSearch
                    value={kyData.aadress}
                    onChange={(addr) => setKyData(prev => ({ ...prev, aadress: addr }))}
                    onApartmentsLoaded={handleApartmentsLoaded}
                    onAddressSelected={(addr) => {
                      setKyData(prev => {
                        const street = addr.split(",")[0].trim();
                        if (!street) return prev;
                        const uusNimi = `KÜ ${street}`;
                        if (!prev.nimi || prev.nimi.startsWith("KÜ ")) {
                          return { ...prev, nimi: uusNimi };
                        }
                        return prev;
                      });
                    }}
                  />
                </div>
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
              </div>
            </div>

            <div style={card}>
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Periood</div>
              <div style={{ marginBottom: 12 }}>
                <div style={fieldLabel}>Majandusaasta</div>
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
              <div style={{ ...helperText, marginBottom: 8 }}>Vajadusel muuda kuupäevi käsitsi</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ width: 200 }}>
                  <div style={fieldLabel}>Algus</div>
                  <DateInput
                    value={plan.period.start || ""}
                    onChange={(iso) => {
                      const y = iso ? Number(iso.slice(0,4)) : plan.period.year;
                      setPlan(p => ({ ...p, period: { ...p.period, start: iso, year: y || p.period.year } }));
                    }}
                    style={inputStyle}
                  />
                </div>
                <div style={{ width: 200 }}>
                  <div style={fieldLabel}>Lõpp</div>
                  <DateInput
                    value={plan.period.end || ""}
                    onChange={(iso) => {
                      setPlan(p => ({ ...p, period: { ...p.period, end: iso } }));
                    }}
                    style={inputStyle}
                  />
                </div>
              </div>
              {plan.period.start && plan.period.end && (
                <div style={{ ...helperText, marginTop: 8 }}>
                  {formatDateEE(plan.period.start)} – {formatDateEE(plan.period.end)}
                </div>
              )}
              {plan.period.start && plan.period.end &&
                plan.period.start > plan.period.end && (
                <div style={{ marginTop: 6, fontSize: 13, color: "#dc2626" }}>
                  Alguskuupäev on hilisem kui lõppkuupäev
                </div>
              )}
            </div>

            <div style={card}>
              <div style={{ marginBottom: 12 }}>
                <div style={sectionTitle}>Korterid</div>
              </div>
              <div style={tableWrap}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={thRow}>
                    <th style={{ padding: "6px 8px" }}>Nr</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>m²</th>
                    <th style={{ padding: "6px 8px", width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {apts.map((a) => (
                    <tr key={a.id} style={tdSep}>
                      <td style={{ padding: "6px 8px" }}><input value={a.label} onChange={(e) => updateApartment(a.id, { label: e.target.value })} style={inputStyle} /></td>
                      <td style={{ padding: "6px 8px" }}><NumberInput value={a.areaM2} onChange={(v) => updateApartment(a.id, { areaM2: v })} style={numStyle} /></td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        <button style={btnRemove} onClick={() => removeApartment(a.id)}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div style={{ marginTop: 12, fontSize: 14, color: N.sub }}>
                Kortereid: {derived.building.apartmentsCount} | Kogupind: {derived.building.totAreaM2.toFixed(1)} m²
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
                      <div style={fieldLabel}>Nimetus</div>
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
                    <div style={{ flex: 2, minWidth: 180 }}>
                      <div style={fieldLabel}>Planeeritud tegevus</div>
                      <input type="text" placeholder={TEGEVUS_PLACEHOLDERS[rida.ese] || "Kirjelda planeeritud tegevus"} value={rida.tegevus} onChange={(e) => uuendaSeisukord(rida.id, "tegevus", e.target.value)} style={inputStyle} />
                    </div>
                    <div style={{ width: 160 }}>
                      <div style={fieldLabel}>Eeldatav kulu €</div>
                      <EuroInput value={rida.eeldatavKulu} onChange={(v) => uuendaSeisukord(rida.id, "eeldatavKulu", v)} style={numStyle} />
                    </div>
                    <div style={{ width: 90 }}>
                      <div style={fieldLabel}>Aasta</div>
                      <select value={rida.tegevusAasta || String(plan.period.year || new Date().getFullYear())} onChange={(e) => uuendaSeisukord(rida.id, "tegevusAasta", e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                        {(() => { const y = plan.period.year || new Date().getFullYear(); return [y, y + 1, y + 2, y + 3].map(v => <option key={v} value={String(v)}>{v}</option>); })()}
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
                      <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 14, color: N.text }}>{rida.invNimetus || "\u2014"}</span>
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600 }}>
                          {euroEE(rida.invMaksumus)}
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
                              <option value="" disabled>Vali allikas…</option>
                              {["Remondifond", "Laen", "Toetus", "Sihtmakse"].map(a => {
                                const juba = rida.rahpiiri.some((r2, i2) => i2 !== ri && r2.allikas === a);
                                return <option key={a} value={a} disabled={juba}>{a}{juba ? " (juba lisatud)" : ""}</option>;
                              })}
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
                        {rida.rahpiiri.length < 4 && (
                          <button onClick={() => lisaRahpiiriRida(rida.id)} style={{ ...btnAdd, fontSize: 13, padding: "4px 10px", marginTop: 4 }}>+ Lisa rahastusrida</button>
                        )}
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
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4, color: N.sub }}>Rahastusplaan</div>
                    {inv.rahpiiri.length === 0 && (
                      <p style={{ color: N.dim, fontSize: 13 }}>Rahastusridu pole lisatud.</p>
                    )}
                    {inv.rahpiiri.map((rp, ri) => (
                      <div key={ri} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                        <select value={rp.allikas} onChange={(e) => handleMuuRahpiiriChange(idx, ri, "allikas", e.target.value)} style={{ ...selectStyle, width: 150 }}>
                          <option value="" disabled>Vali allikas…</option>
                          {["Remondifond", "Laen", "Toetus", "Sihtmakse"].map(a => {
                            const juba = inv.rahpiiri.some((r2, i2) => i2 !== ri && r2.allikas === a);
                            return <option key={a} value={a} disabled={juba}>{a}{juba ? " (juba lisatud)" : ""}</option>;
                          })}
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
                    {inv.rahpiiri.length < 4 && (
                      <button onClick={() => lisaMuuRahpiiriRida(idx)} style={{ ...btnAdd, fontSize: 13, padding: "4px 10px", marginTop: 4 }}>+ Lisa rahastusrida</button>
                    )}
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

        {sec === 2 && (() => {
          const rows = plan.budget.costRows;
          const renderRow = (r) => (
            <div key={r.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ width: 180 }}>
                  <div style={fieldLabel}>Kategooria</div>
                  <select value={r.category || ""} onChange={(e) => handleKuluKategooriaChange(r.id, e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                    <option value="" disabled>Vali...</option>
                    <optgroup label="Kommunaalteenused">
                      {KOMMUNAALTEENUSED.map(k => <option key={k} value={k}>{k}</option>)}
                    </optgroup>
                    <optgroup label="Haldusteenused">
                      {HALDUSTEENUSED.map(k => <option key={k} value={k}>{k}</option>)}
                    </optgroup>
                    <optgroup label="Laenumaksed">
                      {LAENUMAKSED.map(k => <option key={k} value={k}>{k}</option>)}
                    </optgroup>
                  </select>
                </div>
                {(r.category === "Muu haldusteenus" || r.category === "Muu kommunaalteenus") && (
                  <div style={{ flex: 2 }}>
                    <div style={fieldLabel}>Nimetus</div>
                    <input value={r.name} onChange={(e) => updateRow("COST", r.id, { name: e.target.value })} placeholder={KULU_NIMETUS_PLACEHOLDERS[r.category] || "Kirjelda kulu"} style={inputStyle} />
                  </div>
                )}

                {KOMMUNAALTEENUSED.includes(r.category) && r.category !== "Muu kommunaalteenus" ? (
                  <>
                    <div style={{ width: 100 }}>
                      <div style={fieldLabel}>Kogus</div>
                      <NumberInput value={r.kogus} onChange={(v) => updateRow("COST", r.id, { kogus: v })} placeholder="0" style={numStyle} />
                    </div>
                    <div style={{ width: 100 }}>
                      <div style={fieldLabel}>Ühik</div>
                      <select value={r.uhik || ""} onChange={(e) => updateRow("COST", r.id, { uhik: e.target.value })} style={{ ...selectStyle, width: "100%" }}>
                        {(KOMMUNAAL_UHIKUD[r.category] || []).map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ width: 140 }}>
                      <div style={fieldLabel}>Maksumus €/periood</div>
                      <EuroInput value={r.summaInput || 0} onChange={(v) => updateRow("COST", r.id, { summaInput: v })} style={numStyle} />
                    </div>
                  </>
                ) : r.category === "Muu kommunaalteenus" ? (
                  <>
                    <div style={{ width: 140 }}>
                      <div style={fieldLabel}>€/periood</div>
                      <EuroInput value={r.summaInput || 0} onChange={(v) => updateRow("COST", r.id, { summaInput: v })} style={numStyle} />
                    </div>
                  </>
                ) : r.category ? (
                  <>
                    <div style={{ width: 140 }}>
                      <div style={fieldLabel}>Maksumus €/periood</div>
                      <EuroInput value={r.summaInput} onChange={(v) => updateRow("COST", r.id, { summaInput: v, arvutus: "aastas" })} style={numStyle} />
                    </div>
                  </>
                ) : (
                  <div style={{ width: 140 }}>
                    <div style={fieldLabel}>Maksumus €/periood</div>
                    <EuroInput value={r.summaInput || 0} onChange={(v) => updateRow("COST", r.id, { summaInput: v, arvutus: "perioodis" })} style={numStyle} />
                  </div>
                )}

                <div style={{ width: 120, alignSelf: "end" }}>
                  <button style={btnRemove} onClick={() => removeRow("COST", r.id)}>Eemalda</button>
                </div>
              </div>
              {r.category === "Kindlustus" && remondifondiArvutus.onLaen && (
                <div style={{ fontSize: 12, color: N.dim, marginTop: 4 }}>
                  Pangalaenu korral nõuab pank tavaliselt koguriskikindlustust — arvestage kindlustuskulusse ca 20% lisaks.
                </div>
              )}
            </div>
          );

          const kommunaalRead = rows.filter(r => KOMMUNAALTEENUSED.includes(r.category));
          const haldusRead = rows.filter(r => HALDUSTEENUSED.includes(r.category));
          const laenuRead = rows.filter(r => LAENUMAKSED.includes(r.category));
          const maaramataRead = rows.filter(r => !r.category || (!KOMMUNAALTEENUSED.includes(r.category) && !HALDUSTEENUSED.includes(r.category) && !LAENUMAKSED.includes(r.category)));
          const groupLabel = { fontSize: 12, fontWeight: 600, color: N.dim, textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 0 0", marginTop: 4 };

          return (
            <div style={tabStack}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(2)}</div>
              <div style={card}>
                <div style={{ marginBottom: 12 }}>
                  <div style={sectionTitle}>Kulud</div>
                </div>

                <div style={{ padding: 12, background: N.muted, borderRadius: 8, fontSize: 13, color: N.sub, marginBottom: 12 }}>
                  💡 Soovitus: Eesti tarbijahinnaindeks on viimastel aastatel tõusnud 4–10% aastas. Arvestage kulude sisestamisel võimaliku hinnatõusuga.
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {kommunaalRead.length > 0 && (
                    <>
                      <div style={groupLabel}>Kommunaalteenused</div>
                      {kommunaalRead.map(renderRow)}
                    </>
                  )}
                  {haldusRead.length > 0 && (
                    <>
                      <div style={groupLabel}>Haldusteenused</div>
                      {haldusRead.map(renderRow)}
                    </>
                  )}
                  {laenuRead.length > 0 && (
                    <>
                      <div style={groupLabel}>Laenumaksed</div>
                      {laenuRead.map(renderRow)}
                    </>
                  )}
                  {maaramataRead.length > 0 && maaramataRead.map(renderRow)}
                </div>

                <div style={{ marginTop: 8 }}>
                  <button style={btnAdd} onClick={() => addRow("COST")}>+ Lisa rida</button>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: N.text, marginTop: 12, fontFamily: "monospace" }}>
                  {(() => {
                    const komSum = plan.budget.costRows
                      .filter(r => KOMMUNAALTEENUSED.includes(r.category))
                      .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
                    const halSum = plan.budget.costRows
                      .filter(r => HALDUSTEENUSED.includes(r.category))
                      .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
                    const laenuSum = plan.budget.costRows
                      .filter(r => LAENUMAKSED.includes(r.category))
                      .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
                    const kokku = komSum + halSum + laenuSum;
                    return (
                      <>
                        <div>Kommunaalteenused perioodis: {euro(komSum)}</div>
                        <div>Haldusteenused perioodis: {euro(halSum)}</div>
                        <div>Laenumaksed perioodis: {euro(laenuSum)}</div>
                        <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 4, marginTop: 4 }}>Kulud kokku perioodis: {euro(kokku)}</div>
                      </>
                    );
                  })()}
                </div>

              </div>
            </div>
          );
        })()}

        {sec === 3 && (() => {
          const haldusSum = plan.budget.costRows
            .filter(r => HALDUSTEENUSED.includes(r.category))
            .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const laenuSum = plan.budget.costRows
            .filter(r => LAENUMAKSED.includes(r.category))
            .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const muudTulud = plan.budget.incomeRows;
          const muudTuludSum = muudTulud.reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
          const tuludKokku = haldusSum + laenuSum + muudTuludSum;
          const koguPind = derived.building.totAreaM2;
          const haldusM2 = koguPind > 0 ? (haldusSum / koguPind).toFixed(2).replace(".", ",") : "\u2014";
          const laenuM2 = koguPind > 0 ? (laenuSum / koguPind).toFixed(2).replace(".", ",") : "\u2014";

          const readonlyRow = (label, value) => (
            <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <div style={{ width: 220 }}>
                  <div style={fieldLabel}>Kategooria</div>
                  <div style={{ ...inputBase, width: "100%", background: N.muted, color: N.text, fontWeight: 600 }}>
                    {label}
                  </div>
                </div>
                <div style={{ width: 140 }}>
                  <div style={fieldLabel}>Maksumus €/periood</div>
                  <div style={{ ...numStyle, background: N.muted, fontWeight: 600 }}>
                    {fmtEur(value)}
                  </div>
                </div>
              </div>
            </div>
          );

          return (
            <div style={tabStack}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(3)}</div>
              <div style={card}>
                <div style={{ marginBottom: 12 }}>
                  <div style={sectionTitle}>Tulud</div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Haldustasu — readonly */}
                  {readonlyRow("Haldustasu", haldusSum)}

                  {/* Laenumakse — readonly, ainult kui > 0 */}
                  {laenuSum > 0 && readonlyRow("Laenumakse", laenuSum)}

                  {/* Muu tulu read — muudetav nimetus + summa */}
                  {muudTulud.map(r => (
                    <div key={r.id} style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 12 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ width: 220 }}>
                          <div style={fieldLabel}>Kategooria</div>
                          <div style={{ ...inputBase, width: "100%", background: N.muted, color: N.text, fontWeight: 600 }}>
                            Muu tulu
                          </div>
                        </div>
                        <div style={{ flex: 2 }}>
                          <div style={fieldLabel}>Nimetus</div>
                          <input value={r.name} onChange={(e) => updateRow("INCOME", r.id, { name: e.target.value })} placeholder="nt Renditulu, reklaamitulu, toetused" style={inputStyle} />
                        </div>
                        <div style={{ width: 140 }}>
                          <div style={fieldLabel}>Maksumus €/periood</div>
                          <EuroInput value={r.summaInput} onChange={(v) => updateRow("INCOME", r.id, { summaInput: v, arvutus: "aastas" })} style={numStyle} />
                        </div>
                        <div style={{ width: 120, alignSelf: "end" }}>
                          <button style={btnRemove} onClick={() => removeRow("INCOME", r.id)}>Eemalda</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 8 }}>
                  <button style={btnAdd} onClick={() => addRow("INCOME")}>+ Lisa tulu</button>
                </div>

                {/* Kokkuvõte */}
                <div style={{ fontSize: 14, fontWeight: 600, color: N.text, marginTop: 12, fontFamily: "monospace" }}>
                  <div>Haldustasu perioodis: {euro(haldusSum)} → {haldusM2} €/m²</div>
                  {laenuSum > 0 && <div>Laenumakse perioodis: {euro(laenuSum)} → {laenuM2} €/m²</div>}
                  {muudTuludSum > 0 && <div>Muu tulu perioodis: {euro(muudTuludSum)}</div>}
                  <div style={{ borderTop: `1px solid ${N.rule}`, paddingTop: 4, marginTop: 4 }}>Tulud kokku perioodis: {euro(tuludKokku)}</div>
                </div>

              </div>
            </div>
          );
        })()}

        {sec === 4 && (
          <div style={tabStack}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{clearBtn(4)}</div>
            {(() => {
              const ra = remondifondiArvutus;
              const rfCard = { background: N.surface, borderRadius: 8, padding: 16, marginBottom: 12, border: `1px solid ${N.border}` };
              const rfRow = { display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 };
              return (
                <>
                  {/* ══ A-KAART: ALGSEIS ══ */}
                  <div style={rfCard}>
                    <div style={{ ...sectionTitle, marginBottom: 8 }}>Algseis</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: N.sub, fontSize: 14 }}>Saldo perioodi alguses</span>
                      <div style={{ width: 160 }}>
                        <EuroInput
                          value={remondifond.saldoAlgus}
                          onChange={(v) => { setRemondifond(p => ({ ...p, saldoAlgus: v })); setRepairFundSaldo(v); }}
                          placeholder="Fondi jääk"
                          style={numStyle}
                        />
                      </div>
                    </div>
                  </div>

                  {/* ══ B-KAART: INVESTEERINGUD + MÄÄR + STAATUS ══ */}
                  <div style={rfCard}>
                    <div style={{ ...sectionTitle, marginBottom: 8 }}>Perioodi investeeringud</div>

                    {/* Investeeringute tabel */}
                    {ra.invArvutusread.length > 0 ? (
                      <div style={{ marginBottom: 12 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                          <thead>
                            <tr style={{ color: N.dim, borderBottom: `1px solid ${N.rule}` }}>
                              <th style={{ textAlign: "left", padding: "4px 8px 4px 0", fontWeight: 600 }}>Objekt</th>
                              <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>Aasta</th>
                              <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600 }}>Summa</th>
                              <th style={{ textAlign: "right", padding: "4px 0 4px 8px", fontWeight: 600 }}>Koguda</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ra.invArvutusread.map((d, i) => (
                              <tr key={i} style={{ color: N.sub }}>
                                <td style={{ padding: "3px 8px 3px 0" }}>{d.nimetus}</td>
                                <td style={{ textAlign: "right", padding: "3px 8px", fontFamily: "monospace" }}>{d.aasta}</td>
                                <td style={{ textAlign: "right", padding: "3px 8px", fontFamily: "monospace" }}>{euroEE(d.rfSumma)}</td>
                                <td style={{ textAlign: "right", padding: "3px 0 3px 8px", fontFamily: "monospace" }}>
                                  {d.koguda === 0
                                    ? <span style={{ background: STATE.OK.bg, color: STATE.OK.color, padding: "1px 6px", borderRadius: 3, fontSize: 12, fontWeight: 600 }}>kaetud</span>
                                    : <span>{euroEE(d.aastasKoguda)} / {d.kogumisaastad}a</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {ra.invArvutusread.length > 1 && (
                            <tfoot>
                              <tr style={{ fontWeight: 600, color: N.text, borderTop: `1px solid ${N.rule}` }}>
                                <td colSpan={3} style={{ padding: "4px 8px 4px 0" }}>Kokku</td>
                                <td style={{ textAlign: "right", padding: "4px 0 4px 8px", fontFamily: "monospace" }}>{euroEE(ra.invArvutusread.reduce((s, d) => s + d.aastasKoguda, 0))}/a</td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: 12, background: N.muted, borderRadius: 6, fontSize: 13, color: N.dim, marginBottom: 12 }}>
                        Investeeringuid pole lisatud.
                      </div>
                    )}

                    {/* Kogumisvajadus */}
                    {ra.invArvutusread.length > 0 && (
                      <div style={{ ...rfRow, color: N.sub, marginBottom: 4 }}>
                        <span>Kogumisvajadus</span>
                        <span style={{ fontFamily: "monospace" }}>{euroEE(ra.invArvutusread.reduce((s, d) => s + d.aastasKoguda, 0))} /a</span>
                      </div>
                    )}

                    {/* ── REMONDIFONDI MÄÄR (tugevaim element) ── */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0 8px" }}>
                      <span style={{ fontSize: 14, color: N.sub }}>Remondifondi määr</span>
                      <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 22, color: N.text }}>
                        {ra.maarKuusM2.toFixed(2).replace(".", ",")} €/m²/kuu
                      </span>
                    </div>

                    {/* Staatus badge */}
                    {(() => {
                      const cfg = ra.tase === "normaalne"
                        ? { bg: STATE.OK.bg, border: STATE.OK.border, color: STATE.OK.color, text: "Normaalne" }
                        : ra.tase === "korgendatud"
                        ? { bg: STATE.WARN.bg, border: STATE.WARN.border, color: STATE.WARN.color, text: "Tavapärasest kõrgem — põhjendage üldkoosolekul." }
                        : ra.tase === "kriitiline"
                        ? { bg: STATE.ERROR.bg, border: STATE.ERROR.border, color: STATE.ERROR.color, text: "Kaaluge laenurahastust investeeringu katmiseks." }
                        : { bg: N.muted, border: N.border, color: N.dim, text: "Määramata" };
                      return (
                        <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                          {cfg.text}
                        </div>
                      );
                    })()}

                    {/* Kogumisviisi toggle (ainult ilma laenuta + >1 investeering) */}
                    {!ra.onLaen && ra.invDetail.length > 1 && (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                          <span style={{ color: N.sub, fontSize: 13 }}>Kogumisviis</span>
                          <div style={{ display: "flex", gap: 0, border: `1px solid ${N.border}`, borderRadius: 6, overflow: "hidden" }}>
                            {[
                              { value: "eraldi", label: "Eraldi" },
                              { value: "uhine", label: "Ühine periood" },
                            ].map(opt => (
                              <button
                                key={opt.value}
                                onClick={() => setRemondifond(p => ({ ...p, kogumisViis: opt.value }))}
                                style={{
                                  padding: "4px 12px", fontSize: 13, border: "none", cursor: "pointer",
                                  background: remondifond.kogumisViis === opt.value ? N.accent : N.surface,
                                  color: remondifond.kogumisViis === opt.value ? "#fff" : N.sub,
                                  fontWeight: remondifond.kogumisViis === opt.value ? 600 : 400,
                                }}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: N.dim, marginBottom: 4 }}>
                          {remondifond.kogumisViis === "eraldi"
                            ? "Eraldi: iga investeering kogub oma perioodi järgi."
                            : "Ühine: kogutakse pikima investeeringu perioodi järgi."}
                        </div>
                      </>
                    )}

                    {/* Laenuga: panga soovituse info + koefitsiendi väljad */}
                    {ra.onLaen && (
                      <>
                        <div style={{ fontSize: 13, color: N.dim, background: N.muted, borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
                          Panga nõue: remondifond ≥ {(remondifond.pangaKoefitsient || 1.15).toFixed(2).replace(".", ",")}× laenumakse. Lõplik kinnitamine pärast laenu heakskiitu.
                        </div>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ width: 160 }}>
                            <div style={{ ...fieldLabel, fontSize: 12 }}>Pangakoefitsient</div>
                            <NumberInput
                              value={remondifond.pangaKoefitsient}
                              onChange={(v) => setRemondifond(p => ({ ...p, pangaKoefitsient: v || 1.15 }))}
                              style={{ ...numStyle, fontSize: 14 }}
                            />
                            <div style={{ fontSize: 11, color: N.dim, marginTop: 2 }}>Tavaline: 1,10–1,30</div>
                          </div>
                          <div style={{ width: 160 }}>
                            <div style={{ ...fieldLabel, fontSize: 12 }}>Käsitsi määr €/m²/a</div>
                            <NumberInput
                              value={remondifond.pangaMaarOverride ?? ""}
                              onChange={(v) => setRemondifond(p => ({ ...p, pangaMaarOverride: v > 0 ? v : null }))}
                              placeholder="Automaatne"
                              style={{ ...numStyle, fontSize: 14 }}
                            />
                            <div style={{ fontSize: 11, color: N.dim, marginTop: 2 }}>Tühi = automaatne</div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* ══ C-KAART: LÕPPSALDO KUJUNEMINE ══ */}
                  <div style={rfCard}>
                    <div style={{ ...sectionTitle, marginBottom: 8 }}>Lõppsaldo kujunemine</div>
                    <div style={{ fontFamily: "monospace", fontSize: 14, color: N.sub, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Algseis</span><span>{euro(ra.saldoAlgus)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>+ Laekumine</span><span>{euro(ra.laekuminePerioodis)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>− Investeeringud</span><span>{euro(ra.investRemondifondist)}</span>
                      </div>
                      <div style={{
                        display: "flex", justifyContent: "space-between",
                        borderTop: `1px solid ${N.border}`, paddingTop: 6, marginTop: 4,
                        fontWeight: 700, fontSize: 15,
                        color: ra.saldoLopp >= 0 ? N.text : "#dc2626",
                      }}>
                        <span>= Lõppseis</span><span>{euro(ra.saldoLopp)}</span>
                      </div>
                    </div>

                    {/* Kokkuvolditav lisainfo */}
                    <details style={{ marginTop: 16 }}>
                      <summary style={{ cursor: "pointer", fontSize: 13, color: N.dim, userSelect: "none" }}>
                        Arvutuse detail
                      </summary>
                      <div style={{ marginTop: 8, padding: 12, background: N.muted, borderRadius: 8, fontSize: 12, color: N.sub }}>
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Arvutusvalem</div>
                          <div style={{ fontFamily: "monospace" }}>
                            <div>Kogupind: {ra.koguPind.toFixed(2).replace(".", ",")} m²</div>
                            <div>Määr: {ra.maarKuusM2.toFixed(4).replace(".", ",")} €/m²/kuu ({ra.maarAastasM2.toFixed(4).replace(".", ",")} €/m²/a)</div>
                            <div>Laekumine: {ra.maarAastasM2.toFixed(2).replace(".", ",")} × {ra.koguPind.toFixed(1).replace(".", ",")} = {euro(ra.laekuminePerioodis)}</div>
                          </div>
                        </div>
                        {ra.invArvutusread.length > 0 && (
                          <div>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>Kronoloogiline saldo jaotus</div>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}>
                              <thead>
                                <tr style={{ borderBottom: `1px solid ${N.border}`, color: N.dim }}>
                                  <th style={{ textAlign: "left", padding: "2px 6px 2px 0" }}>Objekt</th>
                                  <th style={{ textAlign: "right", padding: "2px 6px" }}>RF summa</th>
                                  <th style={{ textAlign: "right", padding: "2px 6px" }}>Saldost</th>
                                  <th style={{ textAlign: "right", padding: "2px 6px" }}>Koguda</th>
                                  <th style={{ textAlign: "right", padding: "2px 6px" }}>Per</th>
                                  <th style={{ textAlign: "right", padding: "2px 0 2px 6px" }}>€/a</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ra.invArvutusread.map((d, i) => (
                                  <tr key={i}>
                                    <td style={{ padding: "2px 6px 2px 0" }}>{d.nimetus} ({d.aasta})</td>
                                    <td style={{ textAlign: "right", padding: "2px 6px" }}>{euroEE(d.rfSumma)}</td>
                                    <td style={{ textAlign: "right", padding: "2px 6px" }}>{euroEE(d.saldost)}</td>
                                    <td style={{ textAlign: "right", padding: "2px 6px" }}>{euroEE(d.koguda)}</td>
                                    <td style={{ textAlign: "right", padding: "2px 6px" }}>{d.kogumisaastad}a</td>
                                    <td style={{ textAlign: "right", padding: "2px 0 2px 6px" }}>{euroEE(d.aastasKoguda)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                </>
              );
            })()}

            <div style={card}>
              <div style={{ ...sectionTitle, marginBottom: 4 }}>Reservkapital</div>
              <div style={{ fontSize: 14, color: STATE.OK.color, marginBottom: 8 }}>
                Minimaalselt 1/12 aastakuludest:{" "}
                <span style={{ fontFamily: "monospace", fontWeight: 800 }}>
                  {euro(reserveMin.noutavMiinimum)}
                </span>
              </div>

              <div style={{ width: 260 }}>
                <div style={fieldLabel}>Kavandatud reserv €</div>
                <EuroInput
                  value={plan.funds.reserve.plannedEUR}
                  onChange={(v) => setPlan(p => ({ ...p, funds: { ...p.funds, reserve: { ...p.funds.reserve, plannedEUR: v } } }))}
                  style={numStyle}
                />
                <div style={{ fontSize: 12, color: N.dim, marginTop: 4, fontFamily: "monospace" }}>
                  {euro(reserveMin.aastaKulud)} × 1/12
                </div>

                {plan.funds.reserve.plannedEUR > 0 && plan.funds.reserve.plannedEUR < reserveMin.noutavMiinimum && (
                  <div style={{ fontSize: 13, color: STATE.WARN.color, marginTop: 6 }}>
                    ⚠ Kavandatud reservkapital on alla nõutava miinimumi ({euro(reserveMin.noutavMiinimum)}).
                  </div>
                )}
              </div>
            </div>

            <div style={{ ...sectionTitle, marginBottom: 4 }}>Laenud</div>
            <div style={{ fontSize: 13, color: N.dim, marginBottom: 12 }}>Indikatiivsed arvutused. Täpsed tingimused sõltuvad laenuandjast.</div>
            {plan.loans.length === 0 && (
              <div style={{ padding: 16, background: N.muted, borderRadius: 8, fontSize: 14, color: N.sub }}>
                Laenud tekivad investeeringute rahastusplaanist. Praegu ühtegi laenu planeeritud ei ole.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {plan.loans.map(ln => (
                <div key={ln.id} id={`laen-${ln.id}`} style={card}>

                  {/* 1. Laenusumma */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...fieldLabel, display: "flex", alignItems: "center" }}>
                      Laenusumma
                      <span title="Investeeringu rahastusplaanist või käsitsi sisestatud" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: `1px solid ${N.border}`, fontSize: 11, color: N.dim, cursor: "help", marginLeft: 6 }}>?</span>
                    </div>
                    {ln.sepiiriostudInvId ? (
                      <>
                        <EuroInput value={ln.principalEUR} onChange={() => {}} style={{ ...numStyle, background: N.muted, color: N.sub, pointerEvents: "none" }} />
                        {(() => {
                          const inv = [...seisukord, ...muudInvesteeringud].find(e => e.id === ln.sepiiriostudInvId);
                          const nimi = inv?.nimetus || inv?.invNimetus || inv?.ese || "Investeering";
                          return (
                            <button
                              onClick={() => { setSec(1); setTimeout(() => document.getElementById(`inv-${ln.sepiiriostudInvId}`)?.scrollIntoView({ behavior: "smooth" }), 100); }}
                              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#6366f1", marginTop: 4, padding: 0 }}
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
                      <span title="Laenu tagasimaksmise periood" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: `1px solid ${N.border}`, fontSize: 11, color: N.dim, cursor: "help", marginLeft: 6 }}>?</span>
                    </div>
                    {(() => {
                      const total = parseInt(ln.termMonths) || 0;
                      const yy = Math.floor(total / 12);
                      const mm = total % 12;
                      return (
                        <div style={{ display: "flex", gap: 8 }}>
                          <select value={yy} onChange={(e) => { const v = parseInt(e.target.value); updateLoan(ln.id, { termMonths: v * 12 + mm }); }} style={{ ...selectStyle, flex: 2, padding: "10px 12px", fontSize: 15 }}>
                            {Array.from({ length: 31 }, (_, i) => <option key={i} value={i}>{i} {i === 1 ? "aasta" : "aastat"}</option>)}
                          </select>
                          <select value={mm} onChange={(e) => updateLoan(ln.id, { termMonths: yy * 12 + parseInt(e.target.value) })} style={{ ...selectStyle, flex: 1, padding: "10px 12px", fontSize: 15 }}>
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
                      <span title="Aastane intressimäär" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: `1px solid ${N.border}`, fontSize: 11, color: N.dim, cursor: "help", marginLeft: 6 }}>?</span>
                    </div>
                    <div style={{ position: "relative" }}>
                      <NumberInput value={ln.annualRatePct} onChange={(v) => updateLoan(ln.id, { annualRatePct: v })} style={{ ...numStyle, paddingRight: 32 }} />
                      <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, color: N.dim, pointerEvents: "none" }}>%</span>
                    </div>
                  </div>

                  {/* 4. Laenumakse perioodis — readonly, arvutatud */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={fieldLabel}>Laenumakse perioodis</div>
                    <div style={{ ...numStyle, padding: "10px 12px", background: N.muted, color: N.text, fontWeight: 700 }}>
                      {euroEE(arvutaKuumakse(ln.principalEUR, ln.annualRatePct, parseInt(ln.termMonths) || 0) * (derived.period.monthEq || 12))}
                    </div>
                  </div>

                  {/* 5. Eemalda */}
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                    <button style={btnRemove} onClick={() => removeLoan(ln.id)}>Eemalda</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sec === 5 && (
          <div style={tabStack}>
            <div style={card}>
              {/* Pealkiri */}
              <div style={{ ...sectionTitle, marginBottom: 12 }}>Korterite kuumaksed (m² järgi)</div>

              {/* Arvutusalused */}
              {derived.building.totAreaM2 > 0 && (
                <div style={{ marginBottom: 16, padding: 14, background: N.muted, borderRadius: 8, fontSize: 13, color: N.sub }}>
                  <div style={{ fontWeight: 600, color: N.text, marginBottom: 8 }}>Jaotamise alused</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Kommunaalkulud perioodis</span>
                      <span style={{ fontFamily: "monospace" }}>{euroEE(kopiiriondvaade.kommunaalPeriood)} → {euro(kopiiriondvaade.kommunaalKokku)}/kuu</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Halduskulud perioodis</span>
                      <span style={{ fontFamily: "monospace" }}>{euroEE(kopiiriondvaade.haldusPeriood)} → {euro(kopiiriondvaade.haldusKokku)}/kuu</span>
                    </div>
                    {plan.funds.reserve.plannedEUR > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Reservkapital</span>
                        <span style={{ fontFamily: "monospace" }}>{euroEE(plan.funds.reserve.plannedEUR)} → {euro(Math.round(plan.funds.reserve.plannedEUR / 12))}/kuu</span>
                      </div>
                    )}
                    {(() => {
                      const ra = remondifondiArvutus;
                      const rfAastas = Math.round(ra.maarAastasM2 * ra.koguPind);
                      const label = ra.onLaen
                        ? "Remondifond (panga soovitus)"
                        : "Remondifond (kogumisperiood)";
                      const badgeCfg = !ra.onLaen && ra.maarKuusM2 > 0
                        ? (ra.tase === "normaalne"
                          ? { bg: STATE.OK.bg, color: STATE.OK.color }
                          : ra.tase === "korgendatud"
                          ? { bg: STATE.WARN.bg, color: STATE.WARN.color }
                          : { bg: STATE.ERROR.bg, color: STATE.ERROR.color })
                        : null;
                      return (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {label}
                            {badgeCfg && (
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "0 6px", borderRadius: 3, background: badgeCfg.bg, color: badgeCfg.color }}>
                                {ra.maarKuusM2.toFixed(2).replace(".", ",")} €/m²/kuu
                              </span>
                            )}
                          </span>
                          <span style={{ fontFamily: "monospace" }}>{euroEE(rfAastas)} → {euro(Math.round(rfAastas / 12))}/kuu</span>
                        </div>
                      );
                    })()}
                    {remondifondiArvutus.onLaen && kopiiriondvaade.laenumaksedKokku > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Laenumaksed</span>
                        <span style={{ fontFamily: "monospace" }}>{euro(kopiiriondvaade.laenumaksedKokku)}/kuu</span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${N.border}`, paddingTop: 4, marginTop: 4, fontWeight: 600, color: N.text }}>
                      <span>Kogupind</span>
                      <span style={{ fontFamily: "monospace" }}>{derived.building.totAreaM2.toFixed(2)} m²</span>
                    </div>
                  </div>
                </div>
              )}

              {derived.building.totAreaM2 === 0 ? (
                <div style={{ padding: 16, background: N.muted, borderRadius: 8, fontSize: 14, color: N.sub }}>
                  Sisesta korterite m² (Tab "Periood & korterid"), et arvutada makseid.
                </div>
              ) : (
                <>
                  {(() => {
                    const showLaen = remondifondiArvutus.onLaen;
                    const showReserv = (plan.funds.reserve.plannedEUR || 0) > 0;
                    const rr = { textAlign: "right", fontFamily: "monospace" };
                    const colCount = 6 + (showLaen ? 1 : 0) + (showReserv ? 1 : 0);
                    return (
                      <div style={tableWrap}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                        <thead>
                          <tr style={thRow}>
                            <th style={{ padding: "8px 12px 8px 0" }}>Korter</th>
                            <th style={{ ...rr, padding: "8px 12px 8px 0" }}>m²</th>
                            <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Kommunaal</th>
                            <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Haldus</th>
                            <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Remondifond</th>
                            {showReserv && <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Reservkapital</th>}
                            {showLaen && <th style={{ ...rr, padding: "8px 12px 8px 0" }}>Laenumakse</th>}
                            <th style={{ ...rr, padding: "8px 0", fontWeight: 700 }}>Kokku €/kuu</th>
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
                                    <span style={{ fontSize: 11, color: N.dim }}>{isOpen ? "\u25B2" : "\u25BC"}</span>
                                  </td>
                                  <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{km.pind.toFixed(2)} m²</td>
                                  <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.kommunaal)}</td>
                                  <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.haldus)}</td>
                                  <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.remondifond)}</td>
                                  {showReserv && <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.reserv)}</td>}
                                  {showLaen && <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(km.laenumakse)}</td>}
                                  <td style={{ ...rr, padding: "8px 0", fontWeight: 700 }}>{euro(km.kokku)}</td>
                                </tr>
                                {isOpen && (
                                  <tr>
                                    <td colSpan={colCount} style={{ padding: "4px 0 8px 24px", fontSize: 12, color: N.dim }}>
                                      Kommunaal: {euro(kopiiriondvaade.kommunaalKokku)} × {(km.osa * 100).toFixed(1)}% = {euro(km.kommunaal)}
                                      {" · "}
                                      Haldus: {euro(kopiiriondvaade.haldusKokku)} × {(km.osa * 100).toFixed(1)}% = {euro(km.haldus)}
                                      {" · "}
                                      Remondifond: m² osa fondimaksest
                                      {showReserv && <>
                                        {" · "}
                                        Reservkapital: {euro(Math.round(plan.funds.reserve.plannedEUR / 12))} × {(km.osa * 100).toFixed(1)}% = {euro(km.reserv)}
                                      </>}
                                      {showLaen && <>
                                        {" · "}
                                        Laenumakse: {euro(kopiiriondvaade.laenumaksedKokku)} × {(km.osa * 100).toFixed(1)}% = {euro(km.laenumakse)}
                                      </>}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ ...thRow, fontWeight: 700 }}>
                            <td style={{ padding: "8px 12px 8px 0" }}>Kokku</td>
                            <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{korteriteKuumaksed.reduce((s, k) => s + k.pind, 0).toFixed(2)} m²</td>
                            <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.kommunaal, 0))}</td>
                            <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.haldus, 0))}</td>
                            <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.remondifond, 0))}</td>
                            {showReserv && <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.reserv, 0))}</td>}
                            {showLaen && <td style={{ ...rr, padding: "8px 12px 8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.laenumakse, 0))}</td>}
                            <td style={{ ...rr, padding: "8px 0" }}>{euro(korteriteKuumaksed.reduce((s, k) => s + k.kokku, 0))}</td>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── Koondvaade ── */}
            <div style={{ ...card, padding: 24 }}>
              <div style={{ ...sectionTitle, marginBottom: 16 }}>Koondvaade</div>
              {(() => {
                const kvRow = { display: "flex", justifyContent: "space-between", fontSize: 14, color: N.sub, padding: "4px 0" };
                const kvBold = { display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600, color: N.text, padding: "6px 0", borderTop: `1px solid ${N.border}`, marginTop: 4 };
                const kvHr = { display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, padding: "8px 0", borderTop: `2px solid ${N.border}`, marginTop: 8 };
                const mono = { fontFamily: "monospace" };
                const mEq = derived.period.monthEq || 12;

                // Perioodi summad otse sisendist (täpsed, mitte ümardatud kuumakse × mEq)
                const kommunaalPeriood = kopiiriondvaade.kommunaalPeriood || Math.round(kopiiriondvaade.kommunaalKokku * mEq);
                const haldusPeriood = kopiiriondvaade.haldusPeriood || Math.round(kopiiriondvaade.haldusKokku * mEq);
                const laenumaksedPeriood = Math.round(kopiiriondvaade.laenumaksedKokku * mEq);
                const reservPeriood = plan.funds.reserve.plannedEUR || 0;

                const kuludPeriood = kommunaalPeriood + haldusPeriood;
                const valjaminekudPeriood = kuludPeriood + laenumaksedPeriood;

                // Tulud lahti
                const haldustasuPeriood = haldusPeriood;
                const laenumakseTuluPeriood = laenumaksedPeriood;
                const muudTuludPeriood = Math.round(kopiiriondvaade.muudTuludKokku * mEq);
                const tuludPeriood = haldustasuPeriood + laenumakseTuluPeriood + muudTuludPeriood;

                const vahePeriood = tuludPeriood - valjaminekudPeriood;

                // Remondifond
                const rf = remondifondiArvutus;

                return (
                  <div style={{ display: "flex", flexDirection: "column" }}>

                    {/* ── KULUD ── */}
                    <div style={{ fontSize: 12, fontWeight: 600, color: N.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Kulud</div>
                    <div style={kvRow}>
                      <span>Kommunaalkulud</span>
                      <span style={mono}>{euroEE(kommunaalPeriood)}<span style={{ color: N.dim }}> · {euro(kopiiriondvaade.kommunaalKokku)}/kuu</span></span>
                    </div>
                    <div style={kvRow}>
                      <span>Halduskulud</span>
                      <span style={mono}>{euroEE(haldusPeriood)}<span style={{ color: N.dim }}> · {euro(kopiiriondvaade.haldusKokku)}/kuu</span></span>
                    </div>
                    {laenumaksedPeriood > 0 && (
                      <div style={kvRow}>
                        <span>Laenumaksed</span>
                        <span style={mono}>{euroEE(laenumaksedPeriood)}<span style={{ color: N.dim }}> · {euro(kopiiriondvaade.laenumaksedKokku)}/kuu</span></span>
                      </div>
                    )}
                    <div style={kvBold}>
                      <span>Väljaminekud kokku</span>
                      <span style={mono}>{euroEE(valjaminekudPeriood)}<span style={{ color: N.dim }}> · {euro(Math.round(valjaminekudPeriood / mEq))}/kuu</span></span>
                    </div>

                    {/* ── TULUD ── */}
                    <div style={{ fontSize: 12, fontWeight: 600, color: N.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 16, marginBottom: 4 }}>Tulud</div>
                    <div style={kvRow}>
                      <span>Haldustasu</span>
                      <span style={mono}>{euroEE(haldustasuPeriood)}<span style={{ color: N.dim }}> · {euro(kopiiriondvaade.haldusKokku)}/kuu</span></span>
                    </div>
                    {laenumakseTuluPeriood > 0 && (
                      <div style={kvRow}>
                        <span>Laenumakse</span>
                        <span style={mono}>{euroEE(laenumakseTuluPeriood)}<span style={{ color: N.dim }}> · {euro(kopiiriondvaade.laenumaksedKokku)}/kuu</span></span>
                      </div>
                    )}
                    {muudTuludPeriood > 0 && (
                      <div style={kvRow}>
                        <span>Muu tulu</span>
                        <span style={mono}>{euroEE(muudTuludPeriood)}<span style={{ color: N.dim }}> · {euro(kopiiriondvaade.muudTuludKokku)}/kuu</span></span>
                      </div>
                    )}
                    <div style={kvBold}>
                      <span>Tulud kokku</span>
                      <span style={mono}>{euroEE(tuludPeriood)}<span style={{ color: N.dim }}> · {euro(Math.round(tuludPeriood / mEq))}/kuu</span></span>
                    </div>

                    {/* ── VAHE ── */}
                    <div style={{ ...kvHr, color: vahePeriood >= 0 ? "#15803d" : "#dc2626" }}>
                      <span>{vahePeriood >= 0 ? "Ülejääk" : "Puudujääk"}</span>
                      <span style={mono}>
                        {vahePeriood >= 0 ? "+" : ""}{euroEE(vahePeriood)}
                        <span style={{ fontSize: 13 }}> · {vahePeriood >= 0 ? "+" : ""}{euro(Math.round(vahePeriood / mEq))}/kuu</span>
                        {vahePeriood >= 0 ? " ✓" : " ⚠"}
                      </span>
                    </div>

                    {vahePeriood < 0 && (
                      <div style={{ marginTop: 8, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>
                        Tulud ei kata väljaminekuid. Puudujääk {euroEE(Math.abs(vahePeriood))} perioodis.
                      </div>
                    )}

                    {/* ── REMONDIFOND ── */}
                    <div style={{ fontSize: 12, fontWeight: 600, color: N.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 16, marginBottom: 4 }}>Remondifond</div>
                    <div style={kvRow}><span>Saldo perioodi alguses</span><span style={mono}>{euroEE(rf.saldoAlgus)}</span></div>
                    <div style={kvRow}><span>Laekumine perioodis</span><span style={mono}>{euroEE(rf.laekuminePerioodis)}</span></div>
                    <div style={kvRow}><span>Investeeringud perioodis</span><span style={mono}>{rf.investRemondifondist > 0 ? "−" : ""}{euroEE(rf.investRemondifondist)}</span></div>
                    <div style={{ ...kvBold, color: rf.saldoLopp < 0 ? "#dc2626" : N.text }}>
                      <span>Saldo perioodi lõpus</span>
                      <span style={mono}>{euroEE(rf.saldoLopp)}</span>
                    </div>

                    {/* ── RESERVKAPITAL ── */}
                    {reservPeriood > 0 && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 600, color: N.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 16, marginBottom: 4 }}>Reservkapital</div>
                        <div style={kvRow}><span>Kavandatud reserv</span><span style={mono}>{euroEE(reservPeriood)}</span></div>
                        <div style={kvRow}><span>Kuumakse</span><span style={mono}>{euro(Math.round(reservPeriood / 12))}/kuu</span></div>
                      </>
                    )}

                  </div>
                );
              })()}
            </div>

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
              </>
            )}

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
          {(kyData.nimi || kyData.registrikood || kyData.aadress) && (
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              {kyData.nimi && <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{kyData.nimi}</h1>}
              {kyData.registrikood && (
                <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{kyData.registrikood}</div>
              )}
              {kyData.aadress && (
                <div style={{ fontSize: 12, color: "#555", marginTop: kyData.registrikood ? 2 : 4 }}>{kyData.aadress}</div>
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
                  <th style={{ padding: "4px 8px" }}>Nr</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>m²</th>
                </tr>
              </thead>
              <tbody>
                {apts.map(a => (
                  <tr key={a.id} style={{ borderBottom: "1px solid #ccc" }}>
                    <td style={{ padding: "4px 8px" }}>{a.label}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace" }}>{a.areaM2.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Kortereid: {derived.building.apartmentsCount} | Kogupind: {derived.building.totAreaM2.toFixed(1)} m²
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
                      <td style={{ padding: "4px 8px" }}>{s.tegevusAasta || ""}</td>
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
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Maksumus</th>
                    <th style={{ padding: "4px 8px" }}>Rahastusplaan</th>
                  </tr>
                </thead>
                <tbody>
                  {muudInvesteeringud.map(inv => (
                    <tr key={inv.id} style={{ borderBottom: "1px solid #ccc" }}>
                      <td style={{ padding: "4px 8px" }}>{inv.nimetus || "—"}</td>
                      <td style={{ padding: "4px 8px" }}>{inv.aasta || ""}</td>
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
            {(() => {
              const haldusSum = plan.budget.costRows
                .filter(r => HALDUSTEENUSED.includes(r.category))
                .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
              const laenuSum = plan.budget.costRows
                .filter(r => LAENUMAKSED.includes(r.category))
                .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
              const muudSum = plan.budget.incomeRows
                .reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0);
              const kokku = haldusSum + laenuSum + muudSum;
              const mEq = derived.period.monthEq || 12;
              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                    <span><span style={{ color: "#666" }}>Automaatne · </span>Haldustasu</span>
                    <span style={{ fontFamily: "monospace" }}>{euroEE(haldusSum)}</span>
                  </div>
                  {laenuSum > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                      <span><span style={{ color: "#666" }}>Automaatne · </span>Laenumakse</span>
                      <span style={{ fontFamily: "monospace" }}>{euroEE(laenuSum)}</span>
                    </div>
                  )}
                  {plan.budget.incomeRows.map(r => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #ccc" }}>
                      <span>{r.category ? <span style={{ color: "#666" }}>{r.category} · </span> : ""}{r.name || "—"}</span>
                      <span style={{ fontFamily: "monospace" }}>
                        {euroEE(r.summaInput || 0)}
                      </span>
                    </div>
                  ))}
                  <div style={{ marginTop: 8, fontWeight: 700, fontFamily: "monospace" }}>
                    Kokku: {euroEE(kokku)} · {euroEE(kokku / mEq)}/kuu
                  </div>
                </>
              );
            })()}
          </div>

          {/* Fondid & laen */}
          <div className="print-section">
            <h2 className="print-section-title">Fondid & laen</h2>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
              <div><span style={{ fontWeight: 700 }}>Remondifondi määr:</span> {remondifondiArvutus.maarAastasM2.toFixed(2).replace(".", ",")} €/m² aastas</div>
              <div><span style={{ fontWeight: 700 }}>Laekumine perioodis:</span> {euroEE(derived.funds.repairFundIncomePeriodEUR)}</div>
              <div><span style={{ fontWeight: 700 }}>Planeeritud reserv:</span> {euroEE(plan.funds.reserve.plannedEUR)}</div>
              <div><span style={{ fontWeight: 700 }}>Nõutav reserv:</span> {euroEE(Math.round(plan.budget.costRows.reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0) / 12))}</div>
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
                        <td style={{ padding: "4px 8px" }}>{ln.algusAasta || ""}</td>
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
                  ["Tulud perioodis", euroEE(plan.budget.costRows.filter(r => HALDUSTEENUSED.includes(r.category)).reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0) + plan.budget.costRows.filter(r => LAENUMAKSED.includes(r.category)).reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0) + plan.budget.incomeRows.reduce((s, r) => s + (parseFloat(r.summaInput) || 0), 0))],
                  ["Vahe", euroEE(derived.totals.netOperationalPeriodEUR)],
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