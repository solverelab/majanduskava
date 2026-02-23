import React, { useState, useMemo, useCallback } from "react";
import { evaluateMajanduskava } from "./coreClient";

// ─── UTILS ────────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 10);
const n = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : 0; };
const r2 = (x) => Math.round((n(x) + Number.EPSILON) * 100) / 100;
const r4 = (x) => Math.round((n(x) + Number.EPSILON) * 10000) / 10000;
// FIX: use "eurot" not "€", and strip trailing zeros for display
const fmt = (v) => r2(v).toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (v) => `${fmt(v)} eurot`;
const fmt4 = (v) => r4(v).toLocaleString("et-EE", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const pct = (v) => `${r2(v).toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const clone = (x) => JSON.parse(JSON.stringify(x));

function daysBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  if (isNaN(da) || isNaN(db)) return 0;
  return Math.max(0, Math.round((db - da) / 86400000));
}

// Quarter selector helpers
const QUARTERS = ["I kv", "II kv", "III kv", "IV kv"];
function QuarterSelect({ value, onChange }) {
  const year = value ? value.split("-")[0] : "";
  const qv = value ? value.split("-")[1] : "";
  const curYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => String(curYear + i - 1));
  return (
    <div className="flex gap-2">
      <select className="rounded-lg border px-2 py-2 text-sm flex-1"
        value={qv} onChange={e => onChange(year ? `${year}-${e.target.value}` : `${curYear}-${e.target.value}`)}>
        <option value="">Kvartal</option>
        {QUARTERS.map((q, i) => <option key={i} value={String(i + 1)}>{q}</option>)}
      </select>
      <select className="rounded-lg border px-2 py-2 text-sm flex-1"
        value={year} onChange={e => onChange(qv ? `${e.target.value}-${qv}` : `${e.target.value}-`)}>
        <option value="">Aasta</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
function fmtQuarter(v) {
  if (!v) return "";
  const [y, q] = v.split("-");
  return q && y ? `${QUARTERS[Number(q) - 1]} ${y}` : v;
}

// ─── LOAN SCHEDULE ────────────────────────────────────────────────────────────

function calcLoanSchedule(principal, years, interestPct, type = "annuity") {
  const P = n(principal);
  const r = n(interestPct) / 100 / 12;
  const totalMonths = Math.round(n(years) * 12);
  if (P <= 0 || totalMonths <= 0) return [];
  const schedule = [];
  let balance = P;
  const fixedPrincipal = P / totalMonths;
  const annuityPayment = r === 0 ? P / totalMonths : (P * r) / (1 - Math.pow(1 + r, -totalMonths));
  for (let i = 0; i < totalMonths; i++) {
    const interest = balance * r;
    const principal_payment = type === "annuity" ? annuityPayment - interest : fixedPrincipal;
    const total = principal_payment + interest;
    schedule.push({ month: i + 1, principal: r2(principal_payment), interest: r2(interest), total: r2(total), balance: r2(balance - principal_payment) });
    balance -= principal_payment;
  }
  return schedule;
}

// ─── INITIAL STATE ────────────────────────────────────────────────────────────

function makeInitial() {
  return {
    general: { name: "", regCode: "", address: "", periodStart: "", periodEnd: "" },
    apartments: [{ id: uid(), label: "1", area: "", note: "" }],

    works: [{ id: uid(), name: "", plannedQuarter: "", cost: "", note: "", funding: [{ id: uid(), source: "remondifond", amount: "", condition: "", note: "" }] }],

    // Section 3 — costs
    adminCosts: [
      { id: uid(), description: "Heakorra teenus", amount: "", note: "" },
      { id: uid(), description: "Raamatupidamine", amount: "", note: "" },
      { id: uid(), description: "Hooldus- ja väiksemad parandustööd", amount: "", note: "" },
      { id: uid(), description: "Kindlustuskulud", amount: "", note: "" },
    ],
    services: [
      { id: uid(), name: "Soojusenergia", qty: "", unit: "MWh", unitPrice: "", note: "", isMonthly: false },
      { id: uid(), name: "Vesi ja kanalisatsioon", qty: "", unit: "m³", unitPrice: "", note: "", isMonthly: false },
      { id: uid(), name: "Elekter", qty: "", unit: "kWh", unitPrice: "", note: "", isMonthly: false },
      { id: uid(), name: "Prügivedu", qty: "", unit: "kuu", unitPrice: "", note: "", isMonthly: true },
    ],
    // Section 3 — income (KrtS § 41 lg 2)
    otherIncomes: [
      { id: uid(), description: "Üürituled (ühisruumid)", amount: "", note: "" },
    ],

    repairFundRate: "",
    repairFundNote: "",
    plannedReserve: "",
    reserveNote: "",
    loanEnabled: false,
    loan: { amount: "", years: "", interestPct: "", type: "annuity", startMonth: "", reserveMinPct: "10", note: "" },

    preparer: "",
    meetingDate: "",
    effectiveFrom: "",
  };
}

const FUNDING_SOURCES = [
  { value: "remondifond", label: "Remondifond" },
  { value: "reservkapital", label: "Reservkapital" },
  { value: "laen", label: "Laen" },
  { value: "toetus", label: "Toetus" },
  { value: "sihtotstarbeline", label: "Sihtotstarbeline" },
  { value: "uhekordne", label: "Ühekordne" },
  { value: "muu", label: "Muu" },
];

const UNIT_OPTIONS = ["MWh", "kWh", "m³", "l", "tk", "kuu"];

const SECTIONS = [
  { id: 1, label: "Periood ja maja" },
  { id: 2, label: "Plaanitavad tööd" },
  { id: 3, label: "Jooksvad tulud ja kulud" },
  { id: 4, label: "Raha ja finantseerimine" },
  { id: 5, label: "Korterite maksed" },
  { id: 6, label: "Kokkuvõte ja kontroll" },
];

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function MajanduskavaApp() {
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem("majanduskava_v2");
      const base = makeInitial();
      if (!saved) return base;
      const parsed = JSON.parse(saved);
      return { ...base, ...parsed };
    } catch { return makeInitial(); }
  });
  const [section, setSection] = useState(1);
  const [solvereResult, setSolvereResult] = useState(null);
  const [solvereLoading, setSolvereLoading] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  const update = useCallback((path, value) => {
    setData(prev => {
      const next = clone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      try { localStorage.setItem("majanduskava_v2", JSON.stringify(next)); } catch {}
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 1500);
      return next;
    });
  }, []);

  // ─── COMPUTED VALUES ───────────────────────────────────────────────────────

  const computed = useMemo(() => {
    const period_days = daysBetween(data.general.periodStart, data.general.periodEnd);
    const period_month_equiv = period_days / 30.4375;
    const period_year_fraction = period_days / 365.25;

    const apartments = data.apartments.filter(a => n(a.area) > 0);
    const total_area_m2 = apartments.reduce((s, a) => s + n(a.area), 0);
    const apartment_count = apartments.length;
    const shares = apartments.map(a => ({ ...a, share: total_area_m2 > 0 ? n(a.area) / total_area_m2 : 0 }));

    const works_total = data.works.reduce((s, w) => s + n(w.cost), 0);
    const funding_from_repair_fund_period = data.works.reduce((s, w) =>
      s + w.funding.filter(f => f.source === "remondifond").reduce((ss, f) => ss + n(f.amount), 0), 0);
    const funding_from_loan_principal = data.works.reduce((s, w) =>
      s + w.funding.filter(f => f.source === "laen").reduce((ss, f) => ss + n(f.amount), 0), 0);
    const total_works_funded = data.works.reduce((s, w) =>
      s + w.funding.reduce((ss, f) => ss + n(f.amount), 0), 0);

    const admin_cost_period = data.adminCosts.reduce((s, r) => s + n(r.amount), 0);
    const management_cost_period = data.services.reduce((s, svc) => {
      if (svc.isMonthly) return s + n(svc.unitPrice) * period_month_equiv;
      return s + n(svc.qty) * n(svc.unitPrice) * period_year_fraction;
    }, 0);
    const running_cost_period = admin_cost_period + management_cost_period;

    // FIX: income section
    const other_income_period = (data.otherIncomes || []).reduce((s, r) => s + n(r.amount), 0);
    const repair_fund_income_period_base = n(data.repairFundRate) * total_area_m2 * period_month_equiv;
    const total_income_period = other_income_period + repair_fund_income_period_base;

    const loanSchedule = data.loanEnabled
      ? calcLoanSchedule(data.loan.amount, data.loan.years, data.loan.interestPct, data.loan.type)
      : [];
    const loan_payments_in_period = Math.min(Math.round(period_month_equiv), loanSchedule.length);
    const loan_service_period = loanSchedule.slice(0, loan_payments_in_period).reduce((s, p) => s + p.total, 0);
    const loan_service_monthly_equiv = period_month_equiv > 0 ? loan_service_period / period_month_equiv : 0;
    const loan_reserve_pct = n(data.loan.reserveMinPct) / 100;
    const loan_reserve_required_period = loan_service_period * loan_reserve_pct;
    const loan_reserve_monthly_equiv = period_month_equiv > 0 ? loan_reserve_required_period / period_month_equiv : 0;
    const loan_service_per_m2_month = total_area_m2 > 0 ? loan_service_monthly_equiv / total_area_m2 : 0;
    const loan_reserve_per_m2_month = total_area_m2 > 0 ? loan_reserve_monthly_equiv / total_area_m2 : 0;

    const repair_fund_rate = n(data.repairFundRate);
    const repair_fund_income_period = repair_fund_rate * total_area_m2 * period_month_equiv;
    const repair_fund_required_for_works_per_m2_month = (total_area_m2 > 0 && period_month_equiv > 0)
      ? funding_from_repair_fund_period / (total_area_m2 * period_month_equiv) : 0;
    const repair_fund_min_per_m2 = data.loanEnabled
      ? repair_fund_required_for_works_per_m2_month + loan_service_per_m2_month + loan_reserve_per_m2_month
      : repair_fund_required_for_works_per_m2_month;

    // FIX: use r4 comparison to avoid floating point errors
    const repair_fund_ok = repair_fund_min_per_m2 <= 0 || r4(repair_fund_rate) >= r4(repair_fund_min_per_m2);

    const expected_annual_running_cost = period_year_fraction > 0 ? running_cost_period / period_year_fraction : 0;
    const expected_annual_loan_service = period_year_fraction > 0 ? loan_service_period / period_year_fraction : 0;
    const expected_annual_expenses = expected_annual_running_cost + expected_annual_loan_service;
    const required_reserve_capital = expected_annual_expenses / 12;
    const planned_reserve = n(data.plannedReserve);
    const reserve_ok = planned_reserve >= required_reserve_capital;

    const admin_monthly_equiv = period_month_equiv > 0 ? admin_cost_period / period_month_equiv : 0;
    const management_monthly_equiv = period_month_equiv > 0 ? management_cost_period / period_month_equiv : 0;

    const aptPayments = shares.map(a => {
      const apt_admin = admin_monthly_equiv * a.share;
      const apt_management = management_monthly_equiv * a.share;
      const apt_repair_fund = repair_fund_rate * n(a.area);
      const apt_loan_service = data.loanEnabled ? loan_service_monthly_equiv * a.share : 0;
      const apt_loan_reserve = data.loanEnabled ? loan_reserve_monthly_equiv * a.share : 0;
      const apt_total_monthly = apt_admin + apt_management + apt_repair_fund + apt_loan_service + apt_loan_reserve;
      return { ...a, apt_admin, apt_management, apt_repair_fund, apt_loan_service, apt_loan_reserve, apt_total_monthly };
    });

    const monthly_inflows = aptPayments.reduce((s, a) => s + a.apt_total_monthly, 0);
    const monthly_outflows = admin_monthly_equiv + management_monthly_equiv + loan_service_monthly_equiv + loan_reserve_monthly_equiv;
    const budget_ok = monthly_outflows <= 0 || monthly_inflows >= monthly_outflows;
    const works_covered = works_total <= 0 || total_works_funded >= works_total;

    const total_cost_period = running_cost_period + works_total + (data.loanEnabled ? loan_service_period : 0);

    return {
      period_days, period_month_equiv, period_year_fraction,
      total_area_m2, apartment_count, shares,
      works_total, funding_from_repair_fund_period, funding_from_loan_principal, total_works_funded,
      admin_cost_period, management_cost_period, running_cost_period,
      other_income_period, total_income_period,
      loanSchedule, loan_service_period, loan_service_monthly_equiv,
      loan_reserve_required_period, loan_reserve_monthly_equiv,
      loan_service_per_m2_month, loan_reserve_per_m2_month,
      repair_fund_rate, repair_fund_income_period, repair_fund_min_per_m2,
      repair_fund_required_for_works_per_m2_month, repair_fund_ok,
      expected_annual_expenses, required_reserve_capital, planned_reserve, reserve_ok,
      admin_monthly_equiv, management_monthly_equiv,
      aptPayments, monthly_inflows, monthly_outflows, budget_ok, works_covered,
      total_cost_period,
    };
  }, [data]);

  // ─── SOLVERE API ──────────────────────────────────────────────────────────

  const checkWithSolvere = async () => {
    if (computed.running_cost_period <= 0) {
      setSolvereResult({ error: true, message: "Palun sisesta esmalt jooksvad kulud (Sektsioon 3)." });
      return;
    }
    setSolvereLoading(true);
    const annualCosts = computed.period_year_fraction > 0 ? computed.running_cost_period / computed.period_year_fraction : 0;
    const facts = {
      total_expected_annual_costs: annualCosts,
      planned_reserve_capital: computed.planned_reserve,
      previous_year_total_costs: annualCosts,
      existing_loans: 0,
      new_loan_amount: data.loanEnabled ? n(data.loan.amount) : 0,
    };
    const result = await evaluateMajanduskava(facts);
    setSolvereResult(result);
    setSolvereLoading(false);
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b bg-white sticky top-0 z-10 no-print">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <div className="text-base font-bold">Majanduskava</div>
            {data.general.name && <div className="text-xs text-slate-500">{data.general.name}</div>}
          </div>
          <div className="flex items-center gap-3">
            {savedMsg && <span className="text-xs text-emerald-600">✓ Salvestatud</span>}
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-12 gap-4 px-4 py-4">
        {/* Sidebar */}
        <div className="col-span-3 no-print">
          <div className="rounded-xl border bg-white p-3 sticky top-20">
            <div className="space-y-1">
              {SECTIONS.map(s => (
                <button key={s.id} onClick={() => setSection(s.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${section === s.id ? "bg-slate-900 text-white font-semibold" : "hover:bg-slate-100"}`}>
                  <span className="mr-2 text-xs opacity-60">{s.id}.</span>{s.label}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-1 border-t pt-3 text-xs text-slate-600">
              <div className="flex justify-between"><span>Periood</span><span>{computed.period_days > 0 ? `${Math.round(computed.period_month_equiv)} kuud` : "—"}</span></div>
              <div className="flex justify-between"><span>Kortereid</span><span>{computed.apartment_count || "—"}</span></div>
              <div className="flex justify-between"><span>Pind kokku</span><span>{computed.total_area_m2 > 0 ? `${r2(computed.total_area_m2)} m²` : "—"}</span></div>
              <div className="flex justify-between"><span>Jooksvad kulud</span><span>{computed.running_cost_period > 0 ? eur(computed.running_cost_period) : "—"}</span></div>
              <div className="flex justify-between"><span>Tööde kogukulu</span><span>{computed.works_total > 0 ? eur(computed.works_total) : "—"}</span></div>
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="col-span-9">
          <div className="rounded-xl border bg-white p-6">
            {section === 1 && <Section1 data={data} update={update} computed={computed} />}
            {section === 2 && <Section2 data={data} update={update} computed={computed} />}
            {section === 3 && <Section3 data={data} update={update} computed={computed} />}
            {section === 4 && <Section4 data={data} update={update} computed={computed} />}
            {section === 5 && <Section5 computed={computed} />}
            {section === 6 && (
              <Section6
                data={data} update={update} computed={computed}
                checkWithSolvere={checkWithSolvere}
                solvereLoading={solvereLoading}
                solvereResult={solvereResult}
              />
            )}
            <div className="mt-8 flex justify-between no-print">
              <button onClick={() => setSection(s => Math.max(1, s - 1))} disabled={section === 1}
                className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40 hover:bg-slate-50">
                ← Tagasi
              </button>
              <button onClick={() => setSection(s => Math.min(6, s + 1))} disabled={section === 6}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40 hover:bg-slate-800">
                Edasi →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SECTION 1 ────────────────────────────────────────────────────────────────

function Section1({ data, update, computed }) {
  return (
    <div className="space-y-6">
      <SectionHeader num="1" title="Periood ja maja" />
      <div className="grid grid-cols-2 gap-4">
        <Field label="KÜ nimi" value={data.general.name} onChange={v => update("general.name", v)} placeholder="nt Näidise KÜ" required />
        <Field label="Registrikood" value={data.general.regCode} onChange={v => update("general.regCode", v)} placeholder="12345678" required />
        <Field label="Aadress" value={data.general.address} onChange={v => update("general.address", v)} placeholder="Tänav 1, Linn" />
      </div>

      <div>
        <div className="text-sm font-semibold text-slate-700 mb-1">Periood <span className="text-rose-500">*</span></div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Algus" type="date" value={data.general.periodStart} onChange={v => update("general.periodStart", v)} />
          <Field label="Lõpp" type="date" value={data.general.periodEnd} onChange={v => update("general.periodEnd", v)} />
        </div>
        {computed.period_days > 0 && (
          <div className="mt-2 flex gap-4 text-xs text-slate-500">
            <span>{computed.period_days} päeva</span>
            <span>≈ {r2(computed.period_month_equiv)} kuud</span>
            <span>≈ {r2(computed.period_year_fraction)} aastat</span>
          </div>
        )}
      </div>

      <Divider />

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-700">Korterid <span className="text-rose-500">*</span></div>
          <div className="text-xs text-slate-500">{computed.apartment_count} korterit • kokku {r2(computed.total_area_m2)} m²</div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-slate-500">
            <th className="pb-2 pr-3">Tähis</th>
            <th className="pb-2 pr-3">Pind (m²)</th>
            <th className="pb-2 pr-3">Kaasomandi osa</th>
            <th className="pb-2">Märkused</th>
            <th />
          </tr></thead>
          <tbody>
            {data.apartments.map((apt, idx) => (
              <tr key={apt.id} className="border-b">
                <td className="py-1 pr-3"><input className="w-20 rounded border px-2 py-1 text-sm" value={apt.label}
                  onChange={e => { const next = clone(data.apartments); next[idx].label = e.target.value; update("apartments", next); }} /></td>
                <td className="py-1 pr-3"><input className="w-24 rounded border px-2 py-1 text-sm" value={apt.area} placeholder="0.00"
                  onChange={e => { const next = clone(data.apartments); next[idx].area = e.target.value; update("apartments", next); }} /></td>
                <td className="py-1 pr-3 text-slate-500">
                  {computed.total_area_m2 > 0 && n(apt.area) > 0 ? pct(n(apt.area) / computed.total_area_m2 * 100) : "—"}
                </td>
                <td className="py-1 pr-3"><input className="w-full rounded border px-2 py-1 text-sm" value={apt.note} placeholder="valikuline"
                  onChange={e => { const next = clone(data.apartments); next[idx].note = e.target.value; update("apartments", next); }} /></td>
                <td className="py-1"><button className="text-slate-400 hover:text-red-500" onClick={() => {
                  const next = data.apartments.filter(a => a.id !== apt.id);
                  update("apartments", next.length ? next : [{ id: uid(), label: "1", area: "", note: "" }]);
                }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="mt-2 text-sm text-slate-600 hover:text-slate-900 underline"
          onClick={() => update("apartments", [...data.apartments, { id: uid(), label: String(data.apartments.length + 1), area: "", note: "" }])}>
          + Lisa korter
        </button>
      </div>
    </div>
  );
}

// ─── SECTION 2 ────────────────────────────────────────────────────────────────

function Section2({ data, update, computed }) {
  return (
    <div className="space-y-6">
      <SectionHeader num="2" title="Plaanitavad tööd" subtitle="KrtS § 41 lg 1 — Ülevaade kavandatavatest toimingutest" />

      {data.works.map((work, wi) => (
        <div key={work.id} className="rounded-xl border p-4 space-y-4">
          <div className="flex items-start justify-between">
            <div className="font-semibold text-sm">Töö {wi + 1}</div>
            <button className="text-slate-400 hover:text-red-500 text-sm" onClick={() => {
              const next = data.works.filter(w => w.id !== work.id);
              update("works", next.length ? next : [{ id: uid(), name: "", plannedQuarter: "", cost: "", note: "", funding: [{ id: uid(), source: "remondifond", amount: "", condition: "", note: "" }] }]);
            }}>Eemalda</button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Töö nimetus" value={work.name}
                onChange={v => { const next = clone(data.works); next[wi].name = v; update("works", next); }} placeholder="nt Katuse renoveerimine" />
            </div>
            <div>
              <div className="text-sm font-medium text-slate-700 mb-1">Planeeritud aeg</div>
              <QuarterSelect value={work.plannedQuarter}
                onChange={v => { const next = clone(data.works); next[wi].plannedQuarter = v; update("works", next); }} />
            </div>
            <Field label="Eeldatav maksumus (eurot)" value={work.cost}
              onChange={v => { const next = clone(data.works); next[wi].cost = v; update("works", next); }} placeholder="0.00" />
            <div className="col-span-2">
              <Field label="Märkused" value={work.note}
                onChange={v => { const next = clone(data.works); next[wi].note = v; update("works", next); }} placeholder="valikuline" />
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold mb-2">Rahastamine</div>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-slate-500">
                <th className="pb-2 pr-2">Allikas</th>
                <th className="pb-2 pr-2">Summa (eurot)</th>
                <th className="pb-2 pr-2">Tingimus</th>
                <th />
              </tr></thead>
              <tbody>
                {work.funding.map((f, fi) => (
                  <tr key={f.id} className="border-b">
                    <td className="py-1 pr-2">
                      <select className="rounded border px-2 py-1 text-sm w-full" value={f.source}
                        onChange={e => { const next = clone(data.works); next[wi].funding[fi].source = e.target.value; update("works", next); }}>
                        {FUNDING_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <input className="w-28 rounded border px-2 py-1 text-sm" value={f.amount} placeholder="0.00"
                        onChange={e => { const next = clone(data.works); next[wi].funding[fi].amount = e.target.value; update("works", next); }} />
                    </td>
                    <td className="py-1 pr-2">
                      <input className="w-full rounded border px-2 py-1 text-sm" value={f.condition} placeholder="valikuline"
                        onChange={e => { const next = clone(data.works); next[wi].funding[fi].condition = e.target.value; update("works", next); }} />
                    </td>
                    <td className="py-1">
                      <button className="text-slate-400 hover:text-red-500" onClick={() => {
                        const next = clone(data.works);
                        next[wi].funding = next[wi].funding.filter(ff => ff.id !== f.id);
                        if (!next[wi].funding.length) next[wi].funding = [{ id: uid(), source: "remondifond", amount: "", condition: "", note: "" }];
                        update("works", next);
                      }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="mt-1 text-xs text-slate-500 hover:text-slate-900 underline"
              onClick={() => { const next = clone(data.works); next[wi].funding.push({ id: uid(), source: "remondifond", amount: "", condition: "", note: "" }); update("works", next); }}>
              + Lisa rahastamise allikas
            </button>

            {n(work.cost) > 0 && (() => {
              const funded = work.funding.reduce((s, f) => s + n(f.amount), 0);
              const ok = funded >= n(work.cost);
              return (
                <div className={`mt-2 text-xs rounded p-2 ${ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  Kaetud: {fmt(funded)} / {fmt(n(work.cost))} eurot
                  {funded > n(work.cost) && ` (ülejääk: ${fmt(funded - n(work.cost))} eurot)`}
                </div>
              );
            })()}
          </div>
        </div>
      ))}

      <button className="rounded-lg border border-dashed px-4 py-2 text-sm text-slate-600 hover:border-slate-400 w-full"
        onClick={() => update("works", [...data.works, { id: uid(), name: "", plannedQuarter: "", cost: "", note: "", funding: [{ id: uid(), source: "remondifond", amount: "", condition: "", note: "" }] }])}>
        + Lisa töö
      </button>

      {computed.works_total > 0 && (
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <div className="font-semibold mb-2">Tööde kokkuvõte</div>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Tööde kogumaksumus" value={eur(computed.works_total)} />
            <Stat label="Kokku kaetud" value={eur(computed.total_works_funded)} ok={computed.works_covered} />
            <Stat label="Remondifondist" value={eur(computed.funding_from_repair_fund_period)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SECTION 3 ────────────────────────────────────────────────────────────────

function Section3({ data, update, computed }) {
  return (
    <div className="space-y-6">
      <SectionHeader num="3" title="Jooksvad tulud ja kulud" subtitle="KrtS § 41 lg 2 ja lg 5" />

      {/* TULUD */}
      <div>
        <div className="text-sm font-semibold mb-1">Muud tulud</div>
        <div className="text-xs text-slate-500 mb-3">Remondifond ja reservkapital sisestatakse sektsioonis 4</div>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-slate-500">
            <th className="pb-2 pr-3">Kirjeldus</th>
            <th className="pb-2 pr-3">Summa perioodis (eurot)</th>
            <th className="pb-2">Märkused</th>
            <th />
          </tr></thead>
          <tbody>
            {(data.otherIncomes || []).map((row, idx) => (
              <tr key={row.id} className="border-b">
                <td className="py-1 pr-3">
                  <input className="w-full rounded border px-2 py-1 text-sm" value={row.description}
                    onChange={e => { const next = clone(data.otherIncomes); next[idx].description = e.target.value; update("otherIncomes", next); }} />
                </td>
                <td className="py-1 pr-3">
                  <input className="w-28 rounded border px-2 py-1 text-sm" value={row.amount} placeholder="0.00"
                    onChange={e => { const next = clone(data.otherIncomes); next[idx].amount = e.target.value; update("otherIncomes", next); }} />
                </td>
                <td className="py-1 pr-3">
                  <input className="w-full rounded border px-2 py-1 text-sm" value={row.note} placeholder="valikuline"
                    onChange={e => { const next = clone(data.otherIncomes); next[idx].note = e.target.value; update("otherIncomes", next); }} />
                </td>
                <td className="py-1">
                  <button className="text-slate-400 hover:text-red-500" onClick={() => {
                    const next = (data.otherIncomes || []).filter(r => r.id !== row.id);
                    update("otherIncomes", next);
                  }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 flex items-center justify-between">
          <button className="text-sm text-slate-600 hover:text-slate-900 underline"
            onClick={() => update("otherIncomes", [...(data.otherIncomes || []), { id: uid(), description: "", amount: "", note: "" }])}>
            + Lisa tulu
          </button>
          <div className="text-sm font-semibold">Muud tulud kokku: {eur(computed.other_income_period)}</div>
        </div>
      </div>

      <Divider />

      {/* HALDUS-HOOLDUS */}
      <div>
        <div className="text-sm font-semibold mb-3">Haldus-hooldus</div>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-slate-500">
            <th className="pb-2 pr-3">Kirjeldus</th>
            <th className="pb-2 pr-3">Summa perioodis (eurot)</th>
            <th className="pb-2">Märkused</th>
            <th />
          </tr></thead>
          <tbody>
            {data.adminCosts.map((row, idx) => (
              <tr key={row.id} className="border-b">
                <td className="py-1 pr-3">
                  <input className="w-full rounded border px-2 py-1 text-sm" value={row.description}
                    onChange={e => { const next = clone(data.adminCosts); next[idx].description = e.target.value; update("adminCosts", next); }} />
                </td>
                <td className="py-1 pr-3">
                  <input className="w-28 rounded border px-2 py-1 text-sm" value={row.amount} placeholder="0.00"
                    onChange={e => { const next = clone(data.adminCosts); next[idx].amount = e.target.value; update("adminCosts", next); }} />
                </td>
                <td className="py-1 pr-3">
                  <input className="w-full rounded border px-2 py-1 text-sm" value={row.note} placeholder="valikuline"
                    onChange={e => { const next = clone(data.adminCosts); next[idx].note = e.target.value; update("adminCosts", next); }} />
                </td>
                <td className="py-1">
                  <button className="text-slate-400 hover:text-red-500" onClick={() => {
                    const next = data.adminCosts.filter(r => r.id !== row.id);
                    update("adminCosts", next.length ? next : [{ id: uid(), description: "", amount: "", note: "" }]);
                  }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 flex items-center justify-between">
          <button className="text-sm text-slate-600 hover:text-slate-900 underline"
            onClick={() => update("adminCosts", [...data.adminCosts, { id: uid(), description: "", amount: "", note: "" }])}>
            + Lisa rida
          </button>
          <div className="text-sm font-semibold">Kokku: {eur(computed.admin_cost_period)}</div>
        </div>
      </div>

      <Divider />

      {/* MAJANDAMISKULUDE PROGNOOS */}
      <div>
        <div className="text-sm font-semibold mb-1">Majandamiskulude prognoos</div>
        <div className="text-xs text-slate-500 mb-3">KrtS § 41 lg 5 — soojusenergia, vesi ja kanalisatsioon, elekter, prügivedu</div>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-slate-500">
            <th className="pb-2 pr-2">Teenus</th>
            <th className="pb-2 pr-2">Aastane kogus</th>
            <th className="pb-2 pr-2">Ühik</th>
            <th className="pb-2 pr-2">Ühikuhind (eurot)</th>
            <th className="pb-2 pr-2">Summa perioodis (eurot)</th>
            <th className="pb-2">Märkused</th>
            <th />
          </tr></thead>
          <tbody>
            {data.services.map((svc, idx) => {
              const period_cost = svc.isMonthly
                ? n(svc.unitPrice) * computed.period_month_equiv
                : n(svc.qty) * n(svc.unitPrice) * computed.period_year_fraction;
              return (
                <tr key={svc.id} className="border-b">
                  <td className="py-1 pr-2"><input className="w-full rounded border px-2 py-1 text-sm" value={svc.name}
                    onChange={e => { const next = clone(data.services); next[idx].name = e.target.value; update("services", next); }} /></td>
                  <td className="py-1 pr-2"><input className="w-20 rounded border px-2 py-1 text-sm" value={svc.qty}
                    placeholder={svc.isMonthly ? "kuutasu" : "0"} disabled={svc.isMonthly}
                    onChange={e => { const next = clone(data.services); next[idx].qty = e.target.value; update("services", next); }} /></td>
                  <td className="py-1 pr-2">
                    <select className="rounded border px-2 py-1 text-sm" value={svc.unit}
                      onChange={e => { const next = clone(data.services); next[idx].unit = e.target.value; next[idx].isMonthly = e.target.value === "kuu"; update("services", next); }}>
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2"><input className="w-24 rounded border px-2 py-1 text-sm" value={svc.unitPrice} placeholder="0.00"
                    onChange={e => { const next = clone(data.services); next[idx].unitPrice = e.target.value; update("services", next); }} /></td>
                  <td className="py-1 pr-2 font-semibold text-slate-700">{period_cost > 0 ? fmt(period_cost) : "—"}</td>
                  <td className="py-1 pr-2"><input className="w-full rounded border px-2 py-1 text-sm" value={svc.note} placeholder="valikuline"
                    onChange={e => { const next = clone(data.services); next[idx].note = e.target.value; update("services", next); }} /></td>
                  <td className="py-1"><button className="text-slate-400 hover:text-red-500" onClick={() => {
                    const next = data.services.filter(s => s.id !== svc.id);
                    update("services", next.length ? next : [{ id: uid(), name: "", qty: "", unit: "MWh", unitPrice: "", note: "", isMonthly: false }]);
                  }}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-1 flex items-center justify-between">
          <button className="text-sm text-slate-600 hover:text-slate-900 underline"
            onClick={() => update("services", [...data.services, { id: uid(), name: "", qty: "", unit: "MWh", unitPrice: "", note: "", isMonthly: false }])}>
            + Lisa teenus
          </button>
          <div className="text-sm font-semibold">Kokku: {eur(computed.management_cost_period)}</div>
        </div>
      </div>

      {/* Koond */}
      <div className="rounded-xl bg-slate-900 text-white p-4">
        <div className="text-sm font-semibold mb-3">Jooksvad tulud ja kulud kokku perioodis</div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><div className="text-slate-400 text-xs">Muud tulud</div><div className="font-bold">{eur(computed.other_income_period)}</div></div>
          <div><div className="text-slate-400 text-xs">Haldus-hooldus</div><div className="font-bold">{eur(computed.admin_cost_period)}</div></div>
          <div><div className="text-slate-400 text-xs">Majandamiskulud</div><div className="font-bold">{eur(computed.management_cost_period)}</div></div>
          <div className="col-span-3 border-t border-slate-700 pt-3">
            <div className="text-slate-400 text-xs">Jooksvad kulud kokku</div>
            <div className="font-bold text-lg">{eur(computed.running_cost_period)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SECTION 4 ────────────────────────────────────────────────────────────────

function Section4({ data, update, computed }) {
  return (
    <div className="space-y-6">
      <SectionHeader num="4" title="Raha ja finantseerimine" subtitle="KrtS § 41 lg 4 — Reservkapital ja remondifond" />

      <div className="rounded-xl border p-4 space-y-3">
        <div className="font-semibold text-sm">Remondifond</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Remondifondi makse (eurot/m²/kuus)" value={data.repairFundRate}
            onChange={v => update("repairFundRate", v)} placeholder="0.00" required />
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="text-xs text-slate-500">Kogutulu perioodis</div>
            <div className="font-bold">{eur(computed.repair_fund_income_period)}</div>
          </div>
        </div>
        <Field label="Märkused" value={data.repairFundNote} onChange={v => update("repairFundNote", v)} placeholder="valikuline" />
        {computed.repair_fund_min_per_m2 > 0 && (
          <div className={`rounded-lg p-3 text-sm ${computed.repair_fund_ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
            <div className="font-semibold">{computed.repair_fund_ok ? "✅ Remondifondimäär on piisav" : "❌ Remondifondimäär on liian väike"}</div>
            <div className="mt-1 text-xs">
              Nõutav miinimum: {fmt4(computed.repair_fund_min_per_m2)} eurot/m²/kuus
              {!computed.repair_fund_ok && ` (puudujääk: ${fmt4(computed.repair_fund_min_per_m2 - computed.repair_fund_rate)} eurot/m²/kuus)`}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="font-semibold text-sm">Reservkapital</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Planeeritud reservkapital perioodi lõpuks (eurot)" value={data.plannedReserve}
            onChange={v => update("plannedReserve", v)} placeholder="0.00" required />
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="text-xs text-slate-500">Nõutav miinimum (KrtS § 48)</div>
            <div className="font-bold">{eur(computed.required_reserve_capital)}</div>
            <div className="text-xs text-slate-400 mt-1">= aasta eeldatavad kulud / 12</div>
          </div>
        </div>
        {computed.required_reserve_capital > 0 && (
          <div className={`rounded-lg p-3 text-sm ${computed.reserve_ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
            <div className="font-semibold">{computed.reserve_ok ? "✅ Reservkapital vastab nõudele" : "❌ Reservkapital on alla miinimumi"}</div>
            <div className="mt-1 text-xs">Planeeritud: {eur(computed.planned_reserve)} | Nõutav: {eur(computed.required_reserve_capital)}</div>
          </div>
        )}
        <Field label="Märkused" value={data.reserveNote} onChange={v => update("reserveNote", v)} placeholder="valikuline" />
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm">Laen</div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={data.loanEnabled} onChange={e => update("loanEnabled", e.target.checked)} />
            Laen on kavandatud
          </label>
        </div>
        {data.loanEnabled && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Laenusumma (eurot)" value={data.loan.amount} onChange={v => update("loan.amount", v)} placeholder="0.00" required />
              <Field label="Laenuperiood (aastat)" value={data.loan.years} onChange={v => update("loan.years", v)} placeholder="0" required />
              <Field label="Intressimäär (%)" value={data.loan.interestPct} onChange={v => update("loan.interestPct", v)} placeholder="0.00" required />
              <div>
                <div className="text-sm font-medium text-slate-700 mb-1">Graafiku tüüp</div>
                <select className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={data.loan.type} onChange={e => update("loan.type", e.target.value)}>
                  <option value="annuity">Annuiteetlaen (võrdne kuumakse)</option>
                  <option value="fixed">Fikseeritud põhiosaga</option>
                </select>
              </div>
              <Field label="Panga reservinõue (%)" value={data.loan.reserveMinPct} onChange={v => update("loan.reserveMinPct", v)} placeholder="10" />
              <Field label="Märkused" value={data.loan.note} onChange={v => update("loan.note", v)} placeholder="valikuline" />
            </div>
            {computed.loanSchedule.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm grid grid-cols-3 gap-3">
                <div><div className="text-xs text-slate-500">Kuine laenumakse</div><div className="font-bold">{eur(computed.loanSchedule[0]?.total)}</div></div>
                <div><div className="text-xs text-slate-500">Laenu teenindus perioodis</div><div className="font-bold">{eur(computed.loan_service_period)}</div></div>
                <div><div className="text-xs text-slate-500">Reservinõue perioodis</div><div className="font-bold">{eur(computed.loan_reserve_required_period)}</div></div>
                <div><div className="text-xs text-slate-500">Laenu teenindus eurot/m²/kuu</div><div className="font-bold">{fmt4(computed.loan_service_per_m2_month)}</div></div>
                <div><div className="text-xs text-slate-500">Reserv eurot/m²/kuu</div><div className="font-bold">{fmt4(computed.loan_reserve_per_m2_month)}</div></div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-slate-900 text-white p-4">
        <div className="text-sm font-semibold mb-3">Automaatne finantskokkuvõte</div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><div className="text-slate-400 text-xs">Tööde kogukulu</div><div className="font-bold">{eur(computed.works_total)}</div></div>
          <div><div className="text-slate-400 text-xs">Laenuvajadus</div><div className="font-bold">{eur(computed.funding_from_loan_principal)}</div></div>
          <div><div className="text-slate-400 text-xs">Remondifond perioodis</div><div className="font-bold">{eur(computed.repair_fund_income_period)}</div></div>
        </div>
      </div>
    </div>
  );
}

// ─── SECTION 5 ────────────────────────────────────────────────────────────────

function Section5({ computed }) {
  if (computed.apartment_count === 0) {
    return (
      <div className="space-y-4">
        <SectionHeader num="5" title="Korterite maksed" />
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          Palun sisesta esmalt korterid ja nende pindalad (Sektsioon 1).
        </div>
      </div>
    );
  }
  const total_monthly = computed.aptPayments.reduce((s, a) => s + a.apt_total_monthly, 0);
  const hasLoan = computed.loanSchedule.length > 0;

  return (
    <div className="space-y-6">
      <SectionHeader num="5" title="Korterite maksed" subtitle="Perioodilised ettemaksed kaasomandi osa järgi" />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs text-slate-500">
              <th className="px-3 py-2">Korter</th>
              <th className="px-3 py-2">Pind (m²)</th>
              <th className="px-3 py-2">Osakaal</th>
              <th className="px-3 py-2">Haldus-hooldus (eurot/kuu)</th>
              <th className="px-3 py-2">Majandamiskulud (eurot/kuu)</th>
              <th className="px-3 py-2">Remondifond (eurot/kuu)</th>
              {hasLoan && <>
                <th className="px-3 py-2">Laen (eurot/kuu)</th>
                <th className="px-3 py-2">Reserv (eurot/kuu)</th>
              </>}
              <th className="px-3 py-2 font-bold text-slate-700">Kokku (eurot/kuu)</th>
            </tr>
          </thead>
          <tbody>
            {computed.aptPayments.map((a, i) => (
              <tr key={a.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                <td className="px-3 py-2 font-medium">{a.label}</td>
                <td className="px-3 py-2">{r2(n(a.area)).toLocaleString("et-EE")}</td>
                <td className="px-3 py-2 text-slate-500">{pct(a.share * 100)}</td>
                <td className="px-3 py-2">{fmt(a.apt_admin)}</td>
                <td className="px-3 py-2">{fmt(a.apt_management)}</td>
                <td className="px-3 py-2">{fmt(a.apt_repair_fund)}</td>
                {hasLoan && <>
                  <td className="px-3 py-2">{fmt(a.apt_loan_service)}</td>
                  <td className="px-3 py-2">{fmt(a.apt_loan_reserve)}</td>
                </>}
                <td className="px-3 py-2 font-bold">{fmt(a.apt_total_monthly)}</td>
              </tr>
            ))}
            <tr className="border-t bg-slate-900 text-white text-sm font-bold">
              <td className="px-3 py-2">KOKKU</td>
              <td className="px-3 py-2">{r2(computed.total_area_m2).toLocaleString("et-EE")} m²</td>
              <td className="px-3 py-2">100%</td>
              <td className="px-3 py-2">{fmt(computed.admin_monthly_equiv)}</td>
              <td className="px-3 py-2">{fmt(computed.management_monthly_equiv)}</td>
              <td className="px-3 py-2">{fmt(computed.repair_fund_rate * computed.total_area_m2)}</td>
              {hasLoan && <>
                <td className="px-3 py-2">{fmt(computed.loan_service_monthly_equiv)}</td>
                <td className="px-3 py-2">{fmt(computed.loan_reserve_monthly_equiv)}</td>
              </>}
              <td className="px-3 py-2">{fmt(total_monthly)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="text-sm text-slate-500 text-right">
        Perioodilised ettemaksed kokku perioodis: <strong className="text-slate-900">{eur(total_monthly * computed.period_month_equiv)}</strong>
      </div>
    </div>
  );
}

// ─── SECTION 6 ────────────────────────────────────────────────────────────────

function Section6({ data, update, computed, checkWithSolvere, solvereLoading, solvereResult }) {
  const checks = [
    { label: "Periood on määratud", ok: computed.period_days > 0 },
    { label: "Vähemalt 1 korter andmetega", ok: computed.apartment_count > 0 },
    { label: "Jooksvad kulud sisestatud", ok: computed.running_cost_period > 0 },
    { label: "Reservkapital vastab nõudele (KrtS § 48)", ok: computed.reserve_ok },
    { label: "Remondifondimäär on piisav", ok: computed.repair_fund_ok },
    { label: "Tööde rahastus kaetud", ok: computed.works_covered },
    { label: "Eelarve on tasakaalus", ok: computed.budget_ok },
  ];
  const allOk = checks.every(c => c.ok);

  return (
    <div className="space-y-6">
      <SectionHeader num="6" title="Kokkuvõte ja kontroll" />

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border p-4 text-center">
          <div className="text-xs text-slate-500">Kulud kokku perioodis</div>
          <div className="mt-1 text-xl font-bold">{eur(computed.total_cost_period)}</div>
        </div>
        <div className="rounded-xl border p-4 text-center">
          <div className="text-xs text-slate-500">Jooksvad kulud perioodis</div>
          <div className="mt-1 text-xl font-bold">{eur(computed.running_cost_period)}</div>
        </div>
        <div className={`rounded-xl border p-4 text-center ${computed.budget_ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
          <div className="text-xs text-slate-500">Eelarve tasakaal (kuus)</div>
          <div className={`mt-1 text-xl font-bold ${computed.budget_ok ? "text-emerald-700" : "text-rose-700"}`}>
            {eur(computed.monthly_inflows - computed.monthly_outflows)}
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <div className="font-semibold text-sm mb-3">Seaduslik kontroll</div>
        <div className="space-y-2">
          {checks.map((c, i) => (
            <div key={i} className={`flex items-center gap-2 text-sm p-2 rounded-lg ${c.ok ? "text-emerald-700" : "text-rose-700 bg-rose-50"}`}>
              <span>{c.ok ? "✅" : "❌"}</span>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-sm">Solvere automaatkontroll</div>
          <button onClick={checkWithSolvere} disabled={solvereLoading}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50 hover:bg-slate-800">
            {solvereLoading ? "Kontrollin..." : "Kontrolli õiguspärasust"}
          </button>
        </div>
        {solvereResult && (
          <div className={`rounded-xl p-3 text-sm ${solvereResult.error ? "bg-amber-50 text-amber-800" : solvereResult.valid ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
            <div className="font-semibold">
              {solvereResult.error ? `⚠️ ${solvereResult.message}` : solvereResult.valid ? "✅ Majanduskava on õiguspärane" : "❌ Leiti õiguslikke vastuolusid"}
            </div>
            {solvereResult.violations?.map((v, i) => (
              <div key={i} className="mt-2 border-t pt-2">
                <div className="font-semibold">{v.reference}</div>
                <div>{v.message}</div>
                {v.provided_value != null && <div className="text-xs mt-1">Sisestatud: {eur(v.provided_value)}</div>}
              </div>
            ))}
            {solvereResult.trace_id && <div className="mt-2 text-xs opacity-60">Trace ID: {solvereResult.trace_id}</div>}
          </div>
        )}
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="font-semibold text-sm">Vormistamine</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Üldkoosoleku kuupäev" type="date" value={data.meetingDate} onChange={v => update("meetingDate", v)} />
          <Field label="Kehtib alates" type="date" value={data.effectiveFrom} onChange={v => update("effectiveFrom", v)} />
          <Field label="Koostaja" value={data.preparer} onChange={v => update("preparer", v)} placeholder="Juhatuse liige" />
        </div>
      </div>

      {/* FIX: dark print button always visible, not only when allOk */}
      <div className={`rounded-xl p-4 ${allOk ? "bg-slate-900 text-white" : "bg-slate-100"}`}>
        {allOk ? (
          <>
            <div className="font-semibold">✅ Kõik kontrollid on läbitud</div>
            <div className="mt-1 text-sm text-slate-300">Majanduskava on valmis kinnitamiseks.</div>
          </>
        ) : (
          <div className="text-sm text-slate-600">Mõned kontrollid vajavad tähelepanu. PDF genereerida on siiski võimalik.</div>
        )}
        <button onClick={() => window.print()}
          className={`mt-3 rounded-lg px-4 py-2 text-sm font-semibold ${allOk ? "bg-white text-slate-900 hover:bg-slate-100" : "bg-slate-900 text-white hover:bg-slate-800"}`}>
          Genereeri majanduskava PDF
        </button>
      </div>
    </div>
  );
}

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────

function SectionHeader({ num, title, subtitle }) {
  return (
    <div className="border-b pb-4 mb-2">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-300">{num}</span>
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      {subtitle && <div className="mt-1 text-xs text-slate-500">{subtitle}</div>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required, disabled }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700">{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</div>
      <input type={type} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm placeholder:text-slate-400 disabled:bg-slate-50"
        value={value ?? ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
    </label>
  );
}

function Divider() { return <hr className="border-slate-200" />; }

function Stat({ label, value, ok }) {
  return (
    <div className={`rounded-lg p-2 ${ok === true ? "bg-emerald-50" : ok === false ? "bg-rose-50" : "bg-white border"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-sm mt-0.5">{value}</div>
    </div>
  );
}
