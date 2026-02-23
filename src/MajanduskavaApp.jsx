import { useState, useMemo } from "react";

// ─── Utility Functions ───────────────────────────────────────────────
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const fmt = (n) => round2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const uid = () => Math.random().toString(36).slice(2, 9);

function daysBetween(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}
function monthEquiv(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + (d2.getDate() - d1.getDate()) / 30;
}
function yearFraction(a, b) { return monthEquiv(a, b) / 12; }

// ─── Loan amortization ───────────────────────────────────────────────
function generateLoanSchedule(principal, annualRate, months, type, startDate) {
  const r = annualRate / 100 / 12;
  const schedule = [];
  let balance = principal;
  for (let t = 1; t <= months; t++) {
    const interest = round2(balance * r);
    let princ;
    if (type === "annuity") {
      const annuity = r > 0 ? round2(principal * r / (1 - Math.pow(1 + r, -months))) : round2(principal / months);
      princ = round2(annuity - interest);
    } else {
      princ = round2(principal / months);
    }
    const total = round2(princ + interest);
    balance = round2(balance - princ);
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + t - 1);
    schedule.push({ month: t, date: d.toISOString().slice(0, 7), principal: princ, interest, total, balance: Math.max(0, balance) });
  }
  return schedule;
}

function loanServiceInPeriod(schedule, periodStart, periodEnd) {
  const ps = periodStart.slice(0, 7), pe = periodEnd.slice(0, 7);
  return schedule.filter(r => r.date >= ps && r.date <= pe).reduce((s, r) => ({ principal: s.principal + r.principal, interest: s.interest + r.interest, total: s.total + r.total }), { principal: 0, interest: 0, total: 0 });
}

// ─── CashFlow row calc ───────────────────────────────────────────────
function calcCFPeriodAmount(row, yearFrac, monthEq) {
  if (row.calcType === "ANNUAL_QTY_PRICE") return round2((row.quantity || 0) * (row.unitPrice || 0) * yearFrac);
  if (row.calcType === "MONTHLY_FIXED") return round2((row.monthlyFee || 0) * monthEq);
  if (row.calcType === "ANNUAL_FIXED") return round2((row.annualFixed || 0) * yearFrac);
  return 0;
}

// ─── Colors & Styles ─────────────────────────────────────────────────
const C = {
  bg: "#f4f2ed", card: "#ffffff", accent: "#1a5276", accentLight: "#2980b9",
  sidebar: "#1b2a3d", sidebarHover: "#253d56", sidebarActive: "#2980b9",
  text: "#2c3e50", textLight: "#7f8c8d", border: "#dce1e6",
  red: "#c0392b", redBg: "#fdecea", yellow: "#f39c12", yellowBg: "#fef9e7",
  green: "#27ae60", greenBg: "#eafaf1", blue: "#2980b9", blueBg: "#ebf5fb",
  inputBg: "#fafafa",
};

const S = {
  app: { display: "flex", minHeight: "100vh", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: C.bg, color: C.text, fontSize: 14 },
  sidebar: { width: 260, minWidth: 260, background: C.sidebar, color: "#ecf0f1", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh", overflowY: "auto" },
  sidebarTitle: { padding: "24px 20px 8px", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#7fb3d3", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 8 },
  navItem: (active) => ({ padding: "10px 20px", cursor: "pointer", fontSize: 13.5, fontWeight: active ? 600 : 400, background: active ? C.sidebarActive : "transparent", color: active ? "#fff" : "#b0c4d8", borderRadius: 6, margin: "2px 8px", transition: "all 0.15s", display: "flex", justifyContent: "space-between", alignItems: "center" }),
  main: { flex: 1, padding: "32px 40px", maxWidth: 1100 },
  sTitle: { fontSize: 22, fontWeight: 700, color: C.accent, marginBottom: 4, letterSpacing: -0.3 },
  sSub: { fontSize: 13, color: C.textLight, marginBottom: 20 },
  card: { background: C.card, borderRadius: 10, padding: "24px 28px", marginBottom: 20, border: `1px solid ${C.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" },
  cTitle: { fontSize: 15, fontWeight: 600, marginBottom: 14, color: C.accent },
  tbl: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontWeight: 600, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.5, color: C.textLight },
  thR: { textAlign: "right", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontWeight: 600, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.5, color: C.textLight },
  td: { padding: "7px 10px", borderBottom: `1px solid ${C.border}` },
  tdR: { padding: "7px 10px", borderBottom: `1px solid ${C.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  inp: { border: `1px solid ${C.border}`, borderRadius: 5, padding: "7px 10px", fontSize: 13, width: "100%", background: C.inputBg, outline: "none", boxSizing: "border-box" },
  inpS: { border: `1px solid ${C.border}`, borderRadius: 5, padding: "6px 8px", fontSize: 13, width: "100%", background: C.inputBg, outline: "none", boxSizing: "border-box" },
  sel: { border: `1px solid ${C.border}`, borderRadius: 5, padding: "7px 10px", fontSize: 13, background: C.inputBg, outline: "none", cursor: "pointer" },
  btn: { background: C.accent, color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnSm: { background: "transparent", color: C.accentLight, border: `1px solid ${C.accentLight}`, borderRadius: 5, padding: "5px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer" },
  btnX: { background: "transparent", color: C.red, border: "none", padding: "4px 8px", fontSize: 18, cursor: "pointer", lineHeight: 1 },
  reset: { color: C.textLight, fontSize: 12, cursor: "pointer", textDecoration: "underline", marginLeft: 12 },
  badge: (color, bg) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, color, background: bg }),
  sumRow: { fontWeight: 700, background: "#f8f9fa" },
  row: { display: "flex", gap: 16, marginBottom: 14 },
  col: { flex: 1 },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.3 },
  help: { fontSize: 11, color: C.textLight, marginTop: 2 },
  hr: { borderTop: `1px solid ${C.border}`, margin: "16px 0", border: "none", borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: C.border },
  printBtn: (off) => ({ background: off ? "#bdc3c7" : C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: off ? "not-allowed" : "pointer", letterSpacing: 0.5, boxShadow: off ? "none" : "0 2px 8px rgba(26,82,118,0.3)" }),
};

function AlertBox({ type, children }) {
  const m = { red: { bg: C.redBg, bc: C.red, ic: "🔴" }, yellow: { bg: C.yellowBg, bc: C.yellow, ic: "🟡" }, green: { bg: C.greenBg, bc: C.green, ic: "🟢" } };
  const c = m[type] || m.green;
  return <div style={{ padding: "10px 14px", borderRadius: 6, border: `1px solid ${c.bc}30`, background: c.bg, color: type === "yellow" ? "#7d6608" : c.bc, fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}><span>{c.ic}</span><span>{children}</span></div>;
}

function Badge({ type, children }) {
  const m = { red: [C.red, C.redBg, "🔴"], yellow: ["#7d6608", C.yellowBg, "🟡"], green: [C.green, C.greenBg, "🟢"] };
  const [col, bg, ic] = m[type] || m.green;
  return <span style={S.badge(col, bg)}>{ic} {children}</span>;
}

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 32, maxWidth: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        <p style={{ fontSize: 15, marginBottom: 20 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ ...S.btnSm, padding: "8px 20px" }}>Tühista</button>
          <button onClick={onConfirm} style={{ ...S.btn, background: C.red }}>Kinnita</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════
export default function App() {
  const [sec, setSec] = useState(0);
  const [modal, setModal] = useState(null);

  // ── 1) Period & Apartments ──
  const [periodStart, setPeriodStart] = useState("2025-01-01");
  const [periodEnd, setPeriodEnd] = useState("2025-12-31");
  const [apts, setApts] = useState([
    { id: uid(), label: "1", area: 45.2, notes: "" },
    { id: uid(), label: "2", area: 62.8, notes: "" },
    { id: uid(), label: "3", area: 38.5, notes: "" },
  ]);

  // ── 2) Investments ──
  const [works, setWorks] = useState([]);
  const [fundRows, setFundRows] = useState({});

  // ── 3) Costs ──
  const [fixCosts, setFixCosts] = useState([]);
  const [fcCosts, setFcCosts] = useState([]);

  // ── 4) Income ──
  const [fixIncome, setFixIncome] = useState([]);
  const [fcIncome, setFcIncome] = useState([]);

  // ── 5) Financing ──
  const [rfRate, setRfRate] = useState(0.50);
  const [loanOn, setLoanOn] = useState(false);
  const [loanAmt, setLoanAmt] = useState(50000);
  const [loanMo, setLoanMo] = useState(120);
  const [loanPct, setLoanPct] = useState(4.5);
  const [loanTy, setLoanTy] = useState("annuity");
  const [loanSt, setLoanSt] = useState("2025-01");
  const [loanResPct, setLoanResPct] = useState(10);
  const [planRes, setPlanRes] = useState(5000);

  // ═══ Derived: Period ═══
  const pDays = useMemo(() => daysBetween(periodStart, periodEnd), [periodStart, periodEnd]);
  const pMo = useMemo(() => Math.max(0.001, monthEquiv(periodStart, periodEnd)), [periodStart, periodEnd]);
  const pYr = useMemo(() => Math.max(0.001, yearFraction(periodStart, periodEnd)), [periodStart, periodEnd]);
  const totArea = useMemo(() => apts.reduce((s, a) => s + (parseFloat(a.area) || 0), 0), [apts]);
  const shares = useMemo(() => apts.map(a => totArea > 0 ? (parseFloat(a.area) || 0) / totArea : 0), [apts, totArea]);

  // ═══ Derived: Costs ═══
  const fixCostsTot = useMemo(() => fixCosts.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), [fixCosts]);
  const fcCostsTot = useMemo(() => fcCosts.reduce((s, r) => s + calcCFPeriodAmount(r, pYr, pMo), 0), [fcCosts, pYr, pMo]);
  const costsPeriod = fixCostsTot + fcCostsTot;
  const costsMo = round2(costsPeriod / pMo);

  // ═══ Derived: Income ═══
  const fixIncTot = useMemo(() => fixIncome.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), [fixIncome]);
  const fcIncTot = useMemo(() => fcIncome.reduce((s, r) => s + calcCFPeriodAmount(r, pYr, pMo), 0), [fcIncome, pYr, pMo]);
  const incPeriod = fixIncTot + fcIncTot;
  const incMo = round2(incPeriod / pMo);

  // ═══ Derived: Net operational ═══
  const netOpPeriod = costsPeriod - incPeriod;
  const netOpMo = round2(netOpPeriod / pMo);

  // ═══ Derived: Works ═══
  const worksTot = useMemo(() => works.reduce((s, w) => s + (parseFloat(w.cost) || 0), 0), [works]);
  const wfTotals = useMemo(() => {
    const m = {};
    works.forEach(w => { m[w.id] = (fundRows[w.id] || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0); });
    return m;
  }, [works, fundRows]);
  const fundFromRF = useMemo(() => {
    let t = 0;
    Object.values(fundRows).forEach(rows => rows.forEach(r => { if (r.source === "remondifond") t += (parseFloat(r.amount) || 0); }));
    return t;
  }, [fundRows]);
  const totalFund = useMemo(() => {
    let t = 0;
    Object.values(fundRows).forEach(rows => rows.forEach(r => { t += (parseFloat(r.amount) || 0); }));
    return t;
  }, [fundRows]);

  // ═══ Derived: Loan ═══
  const loanSched = useMemo(() => loanOn ? generateLoanSchedule(loanAmt, loanPct, loanMo, loanTy, loanSt + "-01") : [], [loanOn, loanAmt, loanPct, loanMo, loanTy, loanSt]);
  const loanSvcP = useMemo(() => loanOn && loanSched.length ? loanServiceInPeriod(loanSched, periodStart, periodEnd) : { principal: 0, interest: 0, total: 0 }, [loanOn, loanSched, periodStart, periodEnd]);
  const loanSvcMo = round2(loanSvcP.total / pMo);
  const loanResReq = round2(loanSvcP.total * (loanResPct / 100));
  const loanResMo = round2(loanResReq / pMo);
  const loanSvcM2 = totArea > 0 ? round4(loanSvcMo / totArea) : 0;
  const loanResM2 = totArea > 0 ? round4(loanResMo / totArea) : 0;

  // ═══ Derived: Repair fund ═══
  const rfIncome = round2(rfRate * totArea * pMo);
  const rfReqM2 = useMemo(() => {
    const wr = totArea > 0 && pMo > 0 ? fundFromRF / (totArea * pMo) : 0;
    return round4(wr + (loanOn ? loanSvcM2 + loanResM2 : 0));
  }, [fundFromRF, totArea, pMo, loanOn, loanSvcM2, loanResM2]);

  // ═══ Derived: Reserve ═══
  const expAnnOps = Math.max(0, netOpPeriod) / pYr;
  const expAnnLoan = loanSvcP.total / pYr;
  const expAnnExp = expAnnOps + expAnnLoan;
  const reqReserve = round2(expAnnExp / 12);

  // ═══ Derived: Apartment payments ═══
  const netMonthNeed = netOpMo + (loanOn ? loanSvcMo + loanResMo : 0);
  const aptPayments = useMemo(() => apts.map((a, i) => {
    const ar = parseFloat(a.area) || 0;
    const sh = shares[i];
    const nOps = round2(netMonthNeed * sh);
    const rf = round2(rfRate * ar);
    return { ...a, area: ar, share: sh, netOps: nOps, repairFund: rf, total: round2(nOps + rf), costsShare: round2(costsMo * sh), incShare: round2(incMo * sh), loanSh: loanOn ? round2(loanSvcMo * sh) : 0, loanResSh: loanOn ? round2(loanResMo * sh) : 0 };
  }), [apts, shares, netMonthNeed, rfRate, costsMo, incMo, loanSvcMo, loanResMo, loanOn]);

  // ═══ Validations ═══
  const validations = useMemo(() => {
    const v = [];
    if (apts.length < 1) v.push({ t: "red", m: "Vähemalt 1 korter on nõutud", s: 0 });
    if (totArea <= 0) v.push({ t: "red", m: "Korterite kogupind peab olema > 0", s: 0 });
    if (new Date(periodEnd) < new Date(periodStart)) v.push({ t: "red", m: "Perioodi lõpp peab olema ≥ algus", s: 0 });
    works.forEach(w => {
      const ft = wfTotals[w.id] || 0, co = parseFloat(w.cost) || 0;
      if (ft < co) v.push({ t: "red", m: `Töö "${w.name || "?"}" rahastus (${fmt(ft)} €) < maksumus (${fmt(co)} €)`, s: 1 });
      if (ft > co) v.push({ t: "yellow", m: `Töö "${w.name || "?"}" rahastus (${fmt(ft)} €) > maksumus (${fmt(co)} €)`, s: 1 });
    });
    if (totalFund < worksTot && works.length > 0) v.push({ t: "red", m: `Tööde kogurahastus (${fmt(totalFund)} €) < maksumus (${fmt(worksTot)} €)`, s: 6 });
    if (rfRate < rfReqM2 && rfReqM2 > 0) v.push({ t: "red", m: `Remondifondi määr (${rfRate.toFixed(2)}) < miinimum (${rfReqM2.toFixed(2)}) €/m²/kuu`, s: 4 });
    if (planRes < reqReserve) v.push({ t: "red", m: `Reservkapital (${fmt(planRes)} €) < nõutav (${fmt(reqReserve)} €)`, s: 4 });
    if (netMonthNeed < 0) v.push({ t: "yellow", m: "Kavandatavad tulud ületavad kulusid – ülejääk jääb üldiseks reserviks", s: 6 });
    if (v.filter(x => x.t === "red").length === 0 && (works.length > 0 || fixCosts.length > 0 || fcCosts.length > 0)) v.push({ t: "green", m: "Kõik kontrollid läbitud", s: 6 });
    return v;
  }, [apts, totArea, periodStart, periodEnd, works, wfTotals, totalFund, worksTot, rfRate, rfReqM2, planRes, reqReserve, netMonthNeed, fixCosts, fcCosts]);

  const hasErr = validations.some(v => v.t === "red");
  const secErr = (i) => validations.filter(v => v.s === i && v.t === "red").length;

  // ═══ Helpers ═══
  const upApt = (id, f, v) => setApts(p => p.map(a => a.id === id ? { ...a, [f]: v } : a));
  const upWork = (id, f, v) => setWorks(p => p.map(w => w.id === id ? { ...w, [f]: v } : w));
  const upFR = (wid, rid, f, v) => setFundRows(p => ({ ...p, [wid]: (p[wid] || []).map(r => r.id === rid ? { ...r, [f]: v } : r) }));
  const upRow = (set) => (id, f, v) => set(p => p.map(r => r.id === id ? { ...r, [f]: v } : r));
  const rmRow = (set) => (id) => set(p => p.filter(r => r.id !== id));
  const mkFixed = () => ({ id: uid(), name: "", amount: 0, notes: "" });
  const mkFc = () => ({ id: uid(), name: "", calcType: "MONTHLY_FIXED", quantity: 0, unitPrice: 0, monthlyFee: 0, annualFixed: 0, notes: "" });

  const resetSec = (i) => setModal({
    msg: "Kas soovid selle sektsiooni andmed lähtestada?",
    ok: () => {
      if (i === 0) { setApts([{ id: uid(), label: "1", area: 0, notes: "" }]); setPeriodStart("2025-01-01"); setPeriodEnd("2025-12-31"); }
      if (i === 1) { setWorks([]); setFundRows({}); }
      if (i === 2) { setFixCosts([]); setFcCosts([]); }
      if (i === 3) { setFixIncome([]); setFcIncome([]); }
      if (i === 4) { setRfRate(0.50); setLoanOn(false); setPlanRes(5000); }
      setModal(null);
    }
  });

  const SECTIONS = ["Periood ja maja", "Investeeringud", "Kavandatavad kulud", "Kavandatavad tulud", "Finantseerimine", "Korterite maksed", "Kokkuvõte"];

  // ═══════════════════════════════════════════════════════════════════
  // SECTION RENDERERS
  // ═══════════════════════════════════════════════════════════════════

  // ── 0: Period & Building ──
  const r0 = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={S.sTitle}>Periood ja maja</h2>
        <span style={S.reset} onClick={() => resetSec(0)}>Lähtesta sektsioon</span>
      </div>
      <p style={S.sSub}>Määra eelarveperiood ja sisesta korterite andmed</p>
      <div style={S.card}>
        <div style={S.cTitle}>Periood</div>
        <div style={S.row}>
          <div style={S.col}><label style={S.lbl}>Algus</label><input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={S.inp} /></div>
          <div style={S.col}><label style={S.lbl}>Lõpp</label><input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={S.inp} /></div>
        </div>
        <div style={{ display: "flex", gap: 24, fontSize: 13, color: C.textLight }}>
          <span><b>{pDays}</b> päeva</span>
          <span><b>{pMo.toFixed(1)}</b> kuud</span>
          <span><b>{pYr.toFixed(3)}</b> aasta</span>
        </div>
      </div>
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.cTitle}>Korterid</div>
          <button style={S.btnSm} onClick={() => setApts(p => [...p, { id: uid(), label: String(p.length + 1), area: 0, notes: "" }])}>+ Lisa korter</button>
        </div>
        <table style={S.tbl}><thead><tr>
          <th style={S.th}>Tähis</th><th style={S.th}>Pind m²</th><th style={S.thR}>Osa %</th><th style={S.th}>Märkused</th><th style={{ ...S.th, width: 40 }}></th>
        </tr></thead><tbody>
          {apts.map((a, i) => (
            <tr key={a.id}>
              <td style={S.td}><input value={a.label} onChange={e => upApt(a.id, "label", e.target.value)} style={{ ...S.inpS, width: 80 }} /></td>
              <td style={S.td}><input type="number" value={a.area} onChange={e => upApt(a.id, "area", e.target.value)} style={{ ...S.inpS, width: 100, textAlign: "right" }} /></td>
              <td style={S.tdR}>{(shares[i] * 100).toFixed(2)}%</td>
              <td style={S.td}><input value={a.notes} onChange={e => upApt(a.id, "notes", e.target.value)} style={S.inpS} /></td>
              <td style={S.td}><button style={S.btnX} onClick={() => setApts(p => p.filter(x => x.id !== a.id))}>×</button></td>
            </tr>
          ))}
          <tr style={S.sumRow}>
            <td style={S.td}>Kokku</td><td style={S.tdR}><b>{totArea.toFixed(2)}</b> m²</td><td style={S.tdR}>100%</td><td style={S.td}><b>{apts.length}</b> korterit</td><td></td>
          </tr>
        </tbody></table>
      </div>
      {validations.filter(v => v.s === 0).map((v, i) => <AlertBox key={i} type={v.t}>{v.m}</AlertBox>)}
    </div>
  );

  // ── 1: Investments ──
  const r1 = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={S.sTitle}>Investeeringud</h2>
        <span style={S.reset} onClick={() => resetSec(1)}>Lähtesta sektsioon</span>
      </div>
      <p style={S.sSub}>Kavandatavad tööd ja nende rahastamine</p>
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.cTitle}>Tööd</div>
          <button style={S.btnSm} onClick={() => setWorks(p => [...p, { id: uid(), name: "", year: "2025", quarter: "Q1", cost: 0, notes: "" }])}>+ Lisa töö</button>
        </div>
        {works.length === 0 && <p style={{ color: C.textLight, fontSize: 13, fontStyle: "italic" }}>Töid pole lisatud</p>}
        {works.map(w => {
          const ft = wfTotals[w.id] || 0, co = parseFloat(w.cost) || 0, diff = ft - co;
          return (
            <div key={w.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 12, background: "#fafbfc" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ flex: 2, minWidth: 150 }}><label style={S.lbl}>Nimetus</label><input value={w.name} onChange={e => upWork(w.id, "name", e.target.value)} style={S.inpS} placeholder="Töö nimetus" /></div>
                <div style={{ flex: 0.7, minWidth: 80 }}><label style={S.lbl}>Aasta</label><input value={w.year} onChange={e => upWork(w.id, "year", e.target.value)} style={S.inpS} /></div>
                <div style={{ flex: 0.7, minWidth: 80 }}><label style={S.lbl}>Kvartal</label>
                  <select value={w.quarter} onChange={e => upWork(w.id, "quarter", e.target.value)} style={S.sel}><option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option></select>
                </div>
                <div style={{ flex: 1, minWidth: 100 }}><label style={S.lbl}>Maksumus €</label><input type="number" value={w.cost} onChange={e => upWork(w.id, "cost", e.target.value)} style={{ ...S.inpS, textAlign: "right" }} /></div>
                <div style={{ flex: 1.5, minWidth: 100 }}><label style={S.lbl}>Märkused</label><input value={w.notes} onChange={e => upWork(w.id, "notes", e.target.value)} style={S.inpS} /></div>
                <button style={{ ...S.btnX, marginTop: 18 }} onClick={() => { setWorks(p => p.filter(x => x.id !== w.id)); setFundRows(p => { const n = { ...p }; delete n[w.id]; return n; }); }}>×</button>
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.textLight }}>RAHASTAMINE</span>
                  <button style={{ ...S.btnSm, fontSize: 11, padding: "3px 10px" }} onClick={() => setFundRows(p => ({ ...p, [w.id]: [...(p[w.id] || []), { id: uid(), source: "remondifond", amount: 0, notes: "" }] }))}>+ Lisa rida</button>
                </div>
                {(fundRows[w.id] || []).map(r => (
                  <div key={r.id} style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "center" }}>
                    <select value={r.source} onChange={e => upFR(w.id, r.id, "source", e.target.value)} style={{ ...S.sel, flex: 1.5, fontSize: 12 }}>
                      <option value="remondifond">Remondifond</option><option value="reservkapital">Reservkapital</option><option value="laen">Laen</option><option value="toetus">Toetus</option><option value="erakorraline">Erakorraline makse</option>
                    </select>
                    <input type="number" value={r.amount} onChange={e => upFR(w.id, r.id, "amount", e.target.value)} style={{ ...S.inpS, flex: 1, textAlign: "right" }} placeholder="Summa €" />
                    <input value={r.notes || ""} onChange={e => upFR(w.id, r.id, "notes", e.target.value)} style={{ ...S.inpS, flex: 1.5 }} placeholder="Märkused" />
                    <button style={S.btnX} onClick={() => setFundRows(p => ({ ...p, [w.id]: (p[w.id] || []).filter(x => x.id !== r.id) }))}>×</button>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12 }}>
                  <span>Rahastatud: <b>{fmt(ft)} €</b> / {fmt(co)} €</span>
                  {diff < 0 && <Badge type="red">Puudu {fmt(Math.abs(diff))} €</Badge>}
                  {diff > 0 && <Badge type="yellow">Ülejääk {fmt(diff)} €</Badge>}
                  {diff === 0 && co > 0 && <Badge type="green">Kaetud</Badge>}
                </div>
              </div>
            </div>
          );
        })}
        {works.length > 0 && <div style={{ ...S.sumRow, padding: "10px 0", fontSize: 14 }}>Tööd kokku: <b>{fmt(worksTot)} €</b> | Rahastatud: <b>{fmt(totalFund)} €</b></div>}
      </div>
      {validations.filter(v => v.s === 1).map((v, i) => <AlertBox key={i} type={v.t}>{v.m}</AlertBox>)}
    </div>
  );

  // ── Generic CashFlow renderer ──
  const rCF = (title, sub, fixed, setFixed, forecast, setForecast, fixTot, fcTot, totP, moEq, si) => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={S.sTitle}>{title}</h2>
        <span style={S.reset} onClick={() => resetSec(si)}>Lähtesta sektsioon</span>
      </div>
      <p style={S.sSub}>{sub}</p>
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.cTitle}>Püsiread (perioodisumma)</div>
          <button style={S.btnSm} onClick={() => setFixed(p => [...p, mkFixed()])}>+ Lisa rida</button>
        </div>
        {fixed.length === 0 && <p style={{ color: C.textLight, fontSize: 13, fontStyle: "italic" }}>Ridu pole lisatud</p>}
        {fixed.length > 0 && <table style={S.tbl}><thead><tr><th style={S.th}>Nimetus</th><th style={S.thR}>Summa €</th><th style={S.th}>Märkused</th><th style={{ ...S.th, width: 40 }}></th></tr></thead><tbody>
          {fixed.map(r => (
            <tr key={r.id}>
              <td style={S.td}><input value={r.name} onChange={e => upRow(setFixed)(r.id, "name", e.target.value)} style={S.inpS} placeholder="Nimetus" /></td>
              <td style={S.td}><input type="number" value={r.amount} onChange={e => upRow(setFixed)(r.id, "amount", e.target.value)} style={{ ...S.inpS, textAlign: "right" }} /></td>
              <td style={S.td}><input value={r.notes} onChange={e => upRow(setFixed)(r.id, "notes", e.target.value)} style={S.inpS} /></td>
              <td style={S.td}><button style={S.btnX} onClick={() => rmRow(setFixed)(r.id)}>×</button></td>
            </tr>
          ))}
          <tr style={S.sumRow}><td style={S.td}>Kokku</td><td style={S.tdR}><b>{fmt(fixTot)} €</b></td><td></td><td></td></tr>
        </tbody></table>}
      </div>
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.cTitle}>Prognoosiread (mudelpõhine)</div>
          <button style={S.btnSm} onClick={() => setForecast(p => [...p, mkFc()])}>+ Lisa rida</button>
        </div>
        {forecast.length === 0 && <p style={{ color: C.textLight, fontSize: 13, fontStyle: "italic" }}>Ridu pole lisatud</p>}
        {forecast.length > 0 && <div style={{ overflowX: "auto" }}><table style={S.tbl}><thead><tr>
          <th style={S.th}>Nimetus</th><th style={S.th}>Arvutusviis</th><th style={S.thR}>Kogus</th><th style={S.thR}>Ühikuhind €</th><th style={S.thR}>Kuutasu €</th><th style={S.thR}>Aastane €</th><th style={S.thR}>Periood €</th><th style={{ ...S.th, width: 40 }}></th>
        </tr></thead><tbody>
          {forecast.map(r => {
            const pa = calcCFPeriodAmount(r, pYr, pMo);
            const dash = <span style={{ color: "#ccc" }}>—</span>;
            return (
              <tr key={r.id}>
                <td style={S.td}><input value={r.name} onChange={e => upRow(setForecast)(r.id, "name", e.target.value)} style={S.inpS} placeholder="Nimetus" /></td>
                <td style={S.td}>
                  <select value={r.calcType} onChange={e => upRow(setForecast)(r.id, "calcType", e.target.value)} style={{ ...S.sel, fontSize: 11, padding: "5px 4px" }}>
                    <option value="ANNUAL_QTY_PRICE">Kogus × hind</option><option value="MONTHLY_FIXED">Kuutasu</option><option value="ANNUAL_FIXED">Aastane</option>
                  </select>
                </td>
                <td style={S.td}>{r.calcType === "ANNUAL_QTY_PRICE" ? <input type="number" value={r.quantity} onChange={e => upRow(setForecast)(r.id, "quantity", parseFloat(e.target.value) || 0)} style={{ ...S.inpS, textAlign: "right", width: 70 }} /> : dash}</td>
                <td style={S.td}>{r.calcType === "ANNUAL_QTY_PRICE" ? <input type="number" value={r.unitPrice} onChange={e => upRow(setForecast)(r.id, "unitPrice", parseFloat(e.target.value) || 0)} style={{ ...S.inpS, textAlign: "right", width: 80 }} /> : dash}</td>
                <td style={S.td}>{r.calcType === "MONTHLY_FIXED" ? <input type="number" value={r.monthlyFee} onChange={e => upRow(setForecast)(r.id, "monthlyFee", parseFloat(e.target.value) || 0)} style={{ ...S.inpS, textAlign: "right", width: 80 }} /> : dash}</td>
                <td style={S.td}>{r.calcType === "ANNUAL_FIXED" ? <input type="number" value={r.annualFixed} onChange={e => upRow(setForecast)(r.id, "annualFixed", parseFloat(e.target.value) || 0)} style={{ ...S.inpS, textAlign: "right", width: 80 }} /> : dash}</td>
                <td style={S.tdR}><b>{fmt(pa)}</b></td>
                <td style={S.td}><button style={S.btnX} onClick={() => rmRow(setForecast)(r.id)}>×</button></td>
              </tr>
            );
          })}
          <tr style={S.sumRow}><td style={S.td} colSpan={6}>Kokku</td><td style={S.tdR}><b>{fmt(fcTot)} €</b></td><td></td></tr>
        </tbody></table></div>}
      </div>
      <div style={{ ...S.card, background: C.blueBg, border: `1px solid ${C.blue}30` }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
          <span><b>Periood kokku:</b> {fmt(totP)} €</span>
          <span><b>Kuu ekvivalent:</b> {fmt(moEq)} €/kuu</span>
        </div>
      </div>
    </div>
  );

  // ── 4: Financing ──
  const r4 = () => (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={S.sTitle}>Finantseerimine</h2>
        <span style={S.reset} onClick={() => resetSec(4)}>Lähtesta sektsioon</span>
      </div>
      <p style={S.sSub}>Remondifond, laen ja reservkapital</p>

      {/* Repair fund */}
      <div style={S.card}>
        <div style={S.cTitle}>Remondifond</div>
        <div style={S.row}>
          <div style={S.col}>
            <label style={S.lbl}>Määr (€/m²/kuu)</label>
            <input type="number" step="0.01" value={rfRate} onChange={e => setRfRate(parseFloat(e.target.value) || 0)} style={{ ...S.inp, maxWidth: 200 }} />
          </div>
          <div style={S.col}>
            <label style={S.lbl}>Perioodi laekumine</label>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.accent, marginTop: 4 }}>{fmt(rfIncome)} €</div>
            <div style={S.help}>{rfRate.toFixed(2)} × {totArea.toFixed(2)} m² × {pMo.toFixed(1)} kuud</div>
          </div>
        </div>
        <div style={S.hr} />
        <div style={{ display: "flex", gap: 24, fontSize: 13, flexWrap: "wrap" }}>
          <div>Tööde remondifondi-osa: <b>{fmt(fundFromRF)} €</b></div>
          <div>Miinimummäär: <b>{rfReqM2.toFixed(2)} €/m²/kuu</b></div>
        </div>
        {rfRate < rfReqM2 && rfReqM2 > 0 && <div style={{ marginTop: 8 }}><AlertBox type="red">Remondifondi määr on alla miinimumi!</AlertBox></div>}
      </div>

      {/* Loan */}
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.cTitle}>Laen</div>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={loanOn} onChange={e => setLoanOn(e.target.checked)} /> Laen kasutusel
          </label>
        </div>
        {loanOn && <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 140 }}><label style={S.lbl}>Summa €</label><input type="number" value={loanAmt} onChange={e => setLoanAmt(parseFloat(e.target.value) || 0)} style={S.inpS} /></div>
            <div style={{ flex: 1, minWidth: 100 }}><label style={S.lbl}>Periood (kuud)</label><input type="number" value={loanMo} onChange={e => setLoanMo(parseInt(e.target.value) || 0)} style={S.inpS} /></div>
            <div style={{ flex: 1, minWidth: 100 }}><label style={S.lbl}>Intress %/a</label><input type="number" step="0.1" value={loanPct} onChange={e => setLoanPct(parseFloat(e.target.value) || 0)} style={S.inpS} /></div>
            <div style={{ flex: 1, minWidth: 120 }}><label style={S.lbl}>Tüüp</label><select value={loanTy} onChange={e => setLoanTy(e.target.value)} style={S.sel}><option value="annuity">Annuiteet</option><option value="linear">Lineaarne</option></select></div>
            <div style={{ flex: 1, minWidth: 120 }}><label style={S.lbl}>Algus</label><input type="month" value={loanSt} onChange={e => setLoanSt(e.target.value)} style={S.inpS} /></div>
            <div style={{ flex: 1, minWidth: 100 }}><label style={S.lbl}>Reserv %</label><input type="number" value={loanResPct} onChange={e => setLoanResPct(parseFloat(e.target.value) || 0)} style={S.inpS} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
            <div style={{ padding: 12, background: "#f8f9fa", borderRadius: 6 }}>
              <div style={S.lbl}>Teenindus perioodis</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(loanSvcP.total)} €</div>
              <div style={S.help}>Põhiosa: {fmt(loanSvcP.principal)} € | Intress: {fmt(loanSvcP.interest)} €</div>
            </div>
            <div style={{ padding: 12, background: "#f8f9fa", borderRadius: 6 }}>
              <div style={S.lbl}>Kuu ekvivalent</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(loanSvcMo)} €/kuu</div>
              <div style={S.help}>{loanSvcM2.toFixed(4)} €/m²/kuu</div>
            </div>
            <div style={{ padding: 12, background: "#f8f9fa", borderRadius: 6 }}>
              <div style={S.lbl}>Reserv nõue</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(loanResReq)} €</div>
              <div style={S.help}>{fmt(loanResMo)} €/kuu | {loanResM2.toFixed(4)} €/m²/kuu</div>
            </div>
          </div>
        </>}
      </div>

      {/* Reserve */}
      <div style={S.card}>
        <div style={S.cTitle}>Reservkapital</div>
        <div style={S.row}>
          <div style={S.col}>
            <label style={S.lbl}>Planeeritud reserv €</label>
            <input type="number" value={planRes} onChange={e => setPlanRes(parseFloat(e.target.value) || 0)} style={{ ...S.inp, maxWidth: 200 }} />
          </div>
          <div style={S.col}>
            <label style={S.lbl}>Nõutav reserv</label>
            <div style={{ fontSize: 18, fontWeight: 700, color: planRes < reqReserve ? C.red : C.green, marginTop: 4 }}>{fmt(reqReserve)} €</div>
            <div style={S.help}>1/12 aasta eeldatavatest kuludest ({fmt(expAnnExp)} €/a)</div>
          </div>
        </div>
        {planRes < reqReserve && <AlertBox type="red">Reservkapital on alla nõutava miinimumi!</AlertBox>}
      </div>
      {validations.filter(v => v.s === 4).map((v, i) => <AlertBox key={i} type={v.t}>{v.m}</AlertBox>)}
    </div>
  );

  // ── 5: Apartment Payments ──
  const r5 = () => (
    <div>
      <h2 style={S.sTitle}>Korterite maksed</h2>
      <p style={S.sSub}>Igakuised maksed korteri kaupa, jaotatud m² järgi</p>
      <div style={{ ...S.card, background: C.blueBg, border: `1px solid ${C.blue}30`, marginBottom: 16 }}>
        <div style={{ fontSize: 13 }}>
          <b>Neto kuuvajadus:</b> {fmt(netMonthNeed)} €/kuu
          <span style={{ margin: "0 12px", color: C.textLight }}>|</span>
          Kulud: {fmt(costsMo)} − Tulud: {fmt(incMo)}
          {loanOn && <> + Laen: {fmt(loanSvcMo)} + Reserv: {fmt(loanResMo)}</>}
        </div>
      </div>
      <div style={S.card}>
        <div style={{ overflowX: "auto" }}>
          <table style={S.tbl}><thead><tr>
            <th style={S.th}>Korter</th><th style={S.thR}>m²</th><th style={S.thR}>Osa</th>
            <th style={S.thR}>Kulud</th><th style={S.thR}>Tulud (−)</th>
            {loanOn && <th style={S.thR}>Laen</th>}
            {loanOn && <th style={S.thR}>Laenu reserv</th>}
            <th style={S.thR}>Remondifond</th>
            <th style={{ ...S.thR, color: C.accent, fontWeight: 700 }}>KOKKU €/kuu</th>
          </tr></thead><tbody>
            {aptPayments.map(a => (
              <tr key={a.id}>
                <td style={{ ...S.td, fontWeight: 600 }}>{a.label}</td>
                <td style={S.tdR}>{a.area.toFixed(2)}</td>
                <td style={S.tdR}>{(a.share * 100).toFixed(2)}%</td>
                <td style={S.tdR}>{fmt(a.costsShare)}</td>
                <td style={{ ...S.tdR, color: C.green }}>−{fmt(a.incShare)}</td>
                {loanOn && <td style={S.tdR}>{fmt(a.loanSh)}</td>}
                {loanOn && <td style={S.tdR}>{fmt(a.loanResSh)}</td>}
                <td style={S.tdR}>{fmt(a.repairFund)}</td>
                <td style={{ ...S.tdR, fontWeight: 700, fontSize: 14, color: C.accent }}>{fmt(a.total)}</td>
              </tr>
            ))}
            <tr style={S.sumRow}>
              <td style={S.td}>Kokku</td>
              <td style={S.tdR}>{totArea.toFixed(2)}</td>
              <td style={S.tdR}>100%</td>
              <td style={S.tdR}>{fmt(aptPayments.reduce((s, a) => s + a.costsShare, 0))}</td>
              <td style={{ ...S.tdR, color: C.green }}>−{fmt(aptPayments.reduce((s, a) => s + a.incShare, 0))}</td>
              {loanOn && <td style={S.tdR}>{fmt(aptPayments.reduce((s, a) => s + a.loanSh, 0))}</td>}
              {loanOn && <td style={S.tdR}>{fmt(aptPayments.reduce((s, a) => s + a.loanResSh, 0))}</td>}
              <td style={S.tdR}>{fmt(aptPayments.reduce((s, a) => s + a.repairFund, 0))}</td>
              <td style={{ ...S.tdR, fontWeight: 700, fontSize: 14 }}>{fmt(aptPayments.reduce((s, a) => s + a.total, 0))}</td>
            </tr>
          </tbody></table>
        </div>
      </div>
    </div>
  );

  // ── 6: Summary ──
  const r6 = () => (
    <div>
      <h2 style={S.sTitle}>Kokkuvõte ja kontroll</h2>
      <p style={S.sSub}>Eelarve ülevaade, kontrollid ja prindi</p>
      <div style={S.card}>
        <div style={S.cTitle}>Eelarve ülevaade</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[
            { lbl: "Kulud", val: costsPeriod, mo: costsMo, bg: "#f8f9fa", col: C.text },
            { lbl: "Tulud", val: incPeriod, mo: incMo, bg: "#f0faf0", col: C.green },
            { lbl: "Neto tegevus", val: netOpPeriod, mo: netOpMo, bg: C.blueBg, col: C.accent },
            { lbl: "Kuumakse vajadus", val: netMonthNeed * pMo, mo: netMonthNeed, bg: "#fef9e7", col: "#7d6608" },
          ].map((x, i) => (
            <div key={i} style={{ padding: 16, background: x.bg, borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textLight, textTransform: "uppercase", marginBottom: 8 }}>{x.lbl}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: x.col }}>{fmt(x.val)} €</div>
              <div style={S.help}>{fmt(x.mo)} €/kuu</div>
            </div>
          ))}
        </div>
        {works.length > 0 && (
          <div style={{ marginTop: 16, padding: 16, background: "#f8f9fa", borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textLight, textTransform: "uppercase", marginBottom: 8 }}>Investeeringud</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(worksTot)} €</div>
            <div style={S.help}>Rahastatud: {fmt(totalFund)} € | Remondifond perioodis: {fmt(rfIncome)} €</div>
          </div>
        )}
      </div>
      <div style={S.card}>
        <div style={S.cTitle}>Kontrollid</div>
        {validations.length === 0 && <p style={{ color: C.textLight, fontSize: 13 }}>Kontrollitavaid andmeid pole</p>}
        {validations.map((v, i) => <AlertBox key={i} type={v.t}>{v.m}</AlertBox>)}
      </div>
      <div style={{ textAlign: "center", marginTop: 24 }}>
        <button style={S.printBtn(hasErr)} disabled={hasErr} title={hasErr ? "Paranda vead enne printimist" : "Prindi ODF"} onClick={() => { if (!hasErr) window.print(); }}>
          🖨️ Prindi ODF
        </button>
        {hasErr && <p style={{ fontSize: 12, color: C.red, marginTop: 8 }}>Paranda vead enne printimist</p>}
      </div>
    </div>
  );

  const renderSec = () => {
    if (sec === 0) return r0();
    if (sec === 1) return r1();
    if (sec === 2) return rCF("Kavandatavad kulud", "Püsi- ja prognoosiread kulude planeerimiseks", fixCosts, setFixCosts, fcCosts, setFcCosts, fixCostsTot, fcCostsTot, costsPeriod, costsMo, 2);
    if (sec === 3) return rCF("Kavandatavad tulud", "Püsi- ja prognoosiread tulude planeerimiseks", fixIncome, setFixIncome, fcIncome, setFcIncome, fixIncTot, fcIncTot, incPeriod, incMo, 3);
    if (sec === 4) return r4();
    if (sec === 5) return r5();
    if (sec === 6) return r6();
  };

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <nav style={S.sidebar}>
        <div style={S.sidebarTitle}>KÜ Eelarve</div>
        {SECTIONS.map((name, i) => {
          const e = secErr(i);
          return (
            <div key={i} style={S.navItem(sec === i)} onClick={() => setSec(i)}
              onMouseEnter={ev => { if (sec !== i) ev.currentTarget.style.background = C.sidebarHover; }}
              onMouseLeave={ev => { if (sec !== i) ev.currentTarget.style.background = "transparent"; }}>
              <span>{i + 1}. {name}</span>
              {e > 0 && <span style={{ background: C.red, color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>{e}</span>}
            </div>
          );
        })}
        <div style={{ marginTop: "auto", padding: "16px 20px", fontSize: 11, color: "#5a7a94", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          Korteriühistu eelarve<br />planeerimise tööriist
        </div>
      </nav>
      <main style={S.main}>{renderSec()}</main>
      {modal && <ConfirmModal message={modal.msg} onConfirm={modal.ok} onCancel={() => setModal(null)} />}
    </div>
  );
}
