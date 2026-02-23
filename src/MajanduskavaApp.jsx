import React, { useState, useMemo, useCallback } from "react";
import { evaluateMajanduskava } from "./coreClient";

// ─── UTILS ────────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 10);
const n = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : 0; };
const r2 = (x) => Math.round((n(x) + Number.EPSILON) * 100) / 100;
const r4 = (x) => Math.round((n(x) + Number.EPSILON) * 10000) / 10000;
const fmt = (v) => r2(v).toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt4 = (v) => r4(v).toLocaleString("et-EE", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const eur = (v) => `${fmt(v)} eurot`;
const pct = (v) => `${r2(v).toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const clone = (x) => JSON.parse(JSON.stringify(x));

function daysBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  if (isNaN(da) || isNaN(db)) return 0;
  return Math.max(0, Math.round((db - da) / 86400000));
}

// ─── QUARTER SELECTOR ─────────────────────────────────────────────────────────

const QUARTERS = ["I kvartal", "II kvartal", "III kvartal", "IV kvartal"];

function QuarterSelect({ value, onChange }) {
  const parts = (value || "").split("-");
  const year = parts[0] || "";
  const q = parts[1] || "";
  const curYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => String(curYear - 1 + i));
  return (
    <div className="flex gap-2">
      <select
        className="flex-1 rounded-lg px-2 py-2 text-sm"
        style={{ border: "1px solid rgba(0,0,0,0.12)" }}
        value={q}
        onChange={e => onChange(year ? `${year}-${e.target.value}` : `${curYear}-${e.target.value}`)}>
        <option value="">Kvartal</option>
        {QUARTERS.map((label, i) => <option key={i} value={String(i + 1)}>{label}</option>)}
      </select>
      <select
        className="flex-1 rounded-lg px-2 py-2 text-sm"
        style={{ border: "1px solid rgba(0,0,0,0.12)" }}
        value={year}
        onChange={e => onChange(q ? `${e.target.value}-${q}` : `${e.target.value}-`)}>
        <option value="">Aasta</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

function fmtQuarter(v) {
  if (!v) return "";
  const [y, q] = v.split("-");
  if (!q || !y) return v;
  return `${QUARTERS[Number(q) - 1]} ${y}`;
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
    const pp = type === "annuity" ? annuityPayment - interest : fixedPrincipal;
    const total = pp + interest;
    schedule.push({ month: i + 1, principal: r2(pp), interest: r2(interest), total: r2(total), balance: r2(balance - pp) });
    balance -= pp;
  }
  return schedule;
}

// ─── RESET MODAL ──────────────────────────────────────────────────────────────

function ResetModal({ sectionName, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <div className="font-semibold text-slate-900 mb-2">Kas soovite sektsiooni andmed kustutada?</div>
        <div className="text-sm text-slate-500 mb-5">
          Kõik sektsiooni <strong>{sectionName}</strong> andmed eemaldatakse. Tegevust ei saa tagasi võtta.
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">
            Tühista
          </button>
          <button onClick={onConfirm}
            className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm hover:bg-red-700">
            Kustuta andmed
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── INITIAL STATE ────────────────────────────────────────────────────────────

function makeInitial() {
  return {
    general: { name: "", regCode: "", address: "", periodStart: "", periodEnd: "" },
    apartments: [{ id: uid(), label: "1", area: "", note: "" }],
    works: [{
      id: uid(), name: "", plannedQuarter: "", cost: "", note: "",
      funding: [{ id: uid(), source: "remondifond", amount: "", condition: "", note: "" }]
    }],
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
    otherIncomes: [],
    repairFundRate: "",
    repairFundNote: "",
    plannedReserve: "",
    reserveNote: "",
    loanEnabled: false,
    loan: { amount: "", years: "", interestPct: "", type: "annuity", reserveMinPct: "10", note: "" },
    preparer: "",
    meetingDate: "",
    effectiveFrom: "",
  };
}

const INITIAL_ADMIN = () => [
  { id: uid(), description: "Heakorra teenus", amount: "", note: "" },
  { id: uid(), description: "Raamatupidamine", amount: "", note: "" },
  { id: uid(), description: "Hooldus- ja väiksemad parandustööd", amount: "", note: "" },
  { id: uid(), description: "Kindlustuskulud", amount: "", note: "" },
];
const INITIAL_SERVICES = () => [
  { id: uid(), name: "Soojusenergia", qty: "", unit: "MWh", unitPrice: "", note: "", isMonthly: false },
  { id: uid(), name: "Vesi ja kanalisatsioon", qty: "", unit: "m³", unitPrice: "", note: "", isMonthly: false },
  { id: uid(), name: "Elekter", qty: "", unit: "kWh", unitPrice: "", note: "", isMonthly: false },
  { id: uid(), name: "Prügivedu", qty: "", unit: "kuu", unitPrice: "", note: "", isMonthly: true },
];

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
  { id: 3, label: "Jooksvad kulud" },
  { id: 4, label: "Raha ja finantseerimine" },
  { id: 5, label: "Korterite maksed" },
  { id: 6, label: "Kokkuvõte ja kontroll" },
];

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function MajanduskavaApp() {
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem("majanduskava_v3");
      return saved ? { ...makeInitial(), ...JSON.parse(saved) } : makeInitial();
    } catch { return makeInitial(); }
  });
  const [section, setSection] = useState(1);
  const [solvereResult, setSolvereResult] = useState(null);
  const [solvereLoading, setSolvereLoading] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [resetModal, setResetModal] = useState(null); // { name, action }

  const save = (next) => {
    try { localStorage.setItem("majanduskava_v3", JSON.stringify(next)); } catch {}
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 1500);
  };

  const update = useCallback((path, value) => {
    setData(prev => {
      const next = clone(prev);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      save(next);
      return next;
    });
  }, []);

  const updateData = useCallback((fn) => {
    setData(prev => {
      const next = fn(clone(prev));
      save(next);
      return next;
    });
  }, []);

  // ─── COMPUTED ─────────────────────────────────────────────────────────────

  const computed = useMemo(() => {
    const period_days = daysBetween(data.general.periodStart, data.general.periodEnd);
    const period_month_equiv = period_days / 30.4375;
    const period_year_fraction = period_days / 365.25;

    const apartments = data.apartments.filter(a => n(a.area) > 0);
    const total_area_m2 = apartments.reduce((s, a) => s + n(a.area), 0);
    const apartment_count = apartments.length;
    const shares = apartments.map(a => ({
      ...a,
      share: total_area_m2 > 0 ? n(a.area) / total_area_m2 : 0
    }));

    const works_total = data.works.reduce((s, w) => s + n(w.cost), 0);
    const funding_from_repair_fund_period = data.works.reduce((s, w) =>
      s + w.funding.filter(f => f.source === "remondifond").reduce((ss, f) => ss + n(f.amount), 0), 0);
    const funding_from_loan_principal = data.works.reduce((s, w) =>
      s + w.funding.filter(f => f.source === "laen").reduce((ss, f) => ss + n(f.amount), 0), 0);
    const funding_from_special = data.works.reduce((s, w) =>
      s + w.funding.filter(f => ["sihtotstarbeline", "uhekordne"].includes(f.source)).reduce((ss, f) => ss + n(f.amount), 0), 0);
    const total_works_funded = data.works.reduce((s, w) =>
      s + w.funding.reduce((ss, f) => ss + n(f.amount), 0), 0);

    const admin_cost_period = data.adminCosts.reduce((s, r) => s + n(r.amount), 0);
    const management_cost_period = data.services.reduce((s, svc) => {
      if (svc.isMonthly) return s + n(svc.unitPrice) * period_month_equiv;
      return s + n(svc.qty) * n(svc.unitPrice) * period_year_fraction;
    }, 0);
    const running_cost_period = admin_cost_period + management_cost_period;
    const other_income_period = (data.otherIncomes || []).reduce((s, r) => s + n(r.amount), 0);

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
    const repair_fund_ok = repair_fund_min_per_m2 <= 0 || r4(repair_fund_rate) >= r4(repair_fund_min_per_m2);

    const expected_annual_running_cost = period_year_fraction > 0 ? running_cost_period / period_year_fraction : 0;
    const expected_annual_loan_service = period_year_fraction > 0 ? loan_service_period / period_year_fraction : 0;
    const expected_annual_expenses = expected_annual_running_cost + expected_annual_loan_service;
    const required_reserve_capital = expected_annual_expenses / 12;
    const planned_reserve = n(data.plannedReserve);
    const reserve_ok = planned_reserve >= required_reserve_capital;

    const admin_monthly_equiv = period_month_equiv > 0 ? admin_cost_period / period_month_equiv : 0;
    const management_monthly_equiv = period_month_equiv > 0 ? management_cost_period / period_month_equiv : 0;

    // Special monthly payment from sihtotstarbeline/uhekordne works funding
    const special_monthly = period_month_equiv > 0 ? funding_from_special / period_month_equiv : 0;

    const aptPayments = shares.map(a => {
      const apt_admin = admin_monthly_equiv * a.share;
      const apt_management = management_monthly_equiv * a.share;
      const apt_repair_fund = repair_fund_rate * n(a.area);
      const apt_special = special_monthly * a.share;
      const apt_loan_service = data.loanEnabled ? loan_service_monthly_equiv * a.share : 0;
      const apt_loan_reserve = data.loanEnabled ? loan_reserve_monthly_equiv * a.share : 0;
      const apt_total_monthly = apt_admin + apt_management + apt_repair_fund + apt_special + apt_loan_service + apt_loan_reserve;
      return { ...a, apt_admin, apt_management, apt_repair_fund, apt_special, apt_loan_service, apt_loan_reserve, apt_total_monthly };
    });

    const monthly_inflows = aptPayments.reduce((s, a) => s + a.apt_total_monthly, 0);
    const monthly_outflows = admin_monthly_equiv + management_monthly_equiv + loan_service_monthly_equiv + loan_reserve_monthly_equiv;
    const budget_ok = monthly_outflows <= 0 || monthly_inflows >= monthly_outflows;
    const works_covered = works_total <= 0 || total_works_funded >= works_total;
    const total_cost_period = running_cost_period + works_total + (data.loanEnabled ? loan_service_period : 0);
    const total_income_period = repair_fund_income_period + other_income_period;

    return {
      period_days, period_month_equiv, period_year_fraction,
      total_area_m2, apartment_count, shares,
      works_total, funding_from_repair_fund_period, funding_from_loan_principal,
      funding_from_special, total_works_funded,
      admin_cost_period, management_cost_period, running_cost_period,
      other_income_period, total_income_period,
      loanSchedule, loan_service_period, loan_service_monthly_equiv,
      loan_reserve_required_period, loan_reserve_monthly_equiv,
      loan_service_per_m2_month, loan_reserve_per_m2_month,
      repair_fund_rate, repair_fund_income_period, repair_fund_min_per_m2,
      repair_fund_required_for_works_per_m2_month, repair_fund_ok,
      expected_annual_expenses, required_reserve_capital, planned_reserve, reserve_ok,
      admin_monthly_equiv, management_monthly_equiv, special_monthly,
      aptPayments, monthly_inflows, monthly_outflows, budget_ok, works_covered,
      total_cost_period,
    };
  }, [data]);

  // ─── SOLVERE ──────────────────────────────────────────────────────────────

  const checkWithSolvere = async () => {
    if (computed.running_cost_period <= 0) {
      setSolvereResult({ error: true, message: "Palun sisesta esmalt jooksvad kulud (Sektsioon 3)." });
      return;
    }
    setSolvereLoading(true);
    const annualCosts = computed.period_year_fraction > 0
      ? computed.running_cost_period / computed.period_year_fraction : 0;
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
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {resetModal && (
        <ResetModal
          sectionName={resetModal.name}
          onConfirm={() => { resetModal.action(); setResetModal(null); }}
          onCancel={() => setResetModal(null)}
        />
      )}

      {/* Header */}
      <div className="border-b bg-white sticky top-0 z-10 no-print">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div>
            <div className="text-sm font-semibold tracking-tight">Majanduskava</div>
            {data.general.name && <div className="text-xs text-slate-400 mt-0.5">{data.general.name}</div>}
          </div>
          {savedMsg && (
            <span className="text-xs text-emerald-600 flex items-center gap-1">
              <span>✓</span> Salvestatud
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-12 gap-5 px-5 py-5">
        {/* Sidebar */}
        <div className="col-span-3 no-print">
          <div className="rounded-xl border bg-white p-3 sticky top-16">
            <div className="space-y-0.5">
              {SECTIONS.map(s => (
                <button key={s.id} onClick={() => setSection(s.id)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                    section === s.id
                      ? "bg-slate-900 text-white font-medium"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}>
                  <span className="mr-2 text-xs opacity-40">{s.id}.</span>{s.label}
                </button>
              ))}
            </div>

            {/* Quick stats */}
            <div className="mt-4 pt-3 border-t space-y-2">
              {[
                ["Periood", computed.period_days > 0 ? `${Math.round(computed.period_month_equiv)} kuud` : null],
                ["Kortereid", computed.apartment_count > 0 ? computed.apartment_count : null],
                ["Kogupind", computed.total_area_m2 > 0 ? `${r2(computed.total_area_m2)} m²` : null],
                ["Jooksvad kulud", computed.running_cost_period > 0 ? eur(computed.running_cost_period) : null],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-slate-400">{label}</span>
                  <span className={val ? "text-slate-700 font-medium" : "text-slate-300"}>
                    {val || "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="col-span-9">
          <div className="rounded-xl border bg-white">
            <div className="p-7">
              {section === 1 && <Section1 data={data} update={update} updateData={updateData} computed={computed} setResetModal={setResetModal} />}
              {section === 2 && <Section2 data={data} update={update} updateData={updateData} computed={computed} setResetModal={setResetModal} />}
              {section === 3 && <Section3 data={data} update={update} updateData={updateData} computed={computed} setResetModal={setResetModal} />}
              {section === 4 && <Section4 data={data} update={update} updateData={updateData} computed={computed} setResetModal={setResetModal} />}
              {section === 5 && <Section5 computed={computed} />}
              {section === 6 && (
                <Section6
                  data={data} update={update} computed={computed}
                  checkWithSolvere={checkWithSolvere}
                  solvereLoading={solvereLoading}
                  solvereResult={solvereResult}
                />
              )}
            </div>

            {/* Footer nav */}
            <div className="border-t px-7 py-4 flex items-center justify-between no-print">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setSection(s => Math.max(1, s - 1))}
                  disabled={section === 1}
                  className="rounded-lg border px-4 py-2 text-sm text-slate-600 disabled:opacity-30 hover:bg-slate-50 transition">
                  ← Tagasi
                </button>
                {/* Section reset link */}
                {section !== 6 && (
                  <button
                    onClick={() => {
                      const sectionLabel = SECTIONS.find(s => s.id === section)?.label;
                      const actions = {
                        1: () => updateData(d => ({ ...d, apartments: [{ id: uid(), label: "1", area: "", note: "" }] })),
                        2: () => updateData(d => ({ ...d, works: [{ id: uid(), name: "", plannedQuarter: "", cost: "", note: "", funding: [{ id: uid(), source: "remondifond", amount: "", condition: "", note: "" }] }] })),
                        3: () => updateData(d => ({ ...d, adminCosts: INITIAL_ADMIN(), services: INITIAL_SERVICES(), otherIncomes: [] })),
                        4: () => updateData(d => ({ ...d, repairFundRate: "", repairFundNote: "", plannedReserve: "", reserveNote: "", loanEnabled: false, loan: { amount: "", years: "", interestPct: "", type: "annuity", reserveMinPct: "10", note: "" } })),
                        5: () => {},
                      };
                      setResetModal({ name: sectionLabel, action: actions[section] || (() => {}) });
                    }}
                    className="text-sm transition"
                    style={{ color: "#6B7280" }}
                    onMouseEnter={e => e.target.style.color = "#374151"}
                    onMouseLeave={e => e.target.style.color = "#6B7280"}>
                    Lähtesta sektsioon
                  </button>
                )}
              </div>
              <button
                onClick={() => setSection(s => Math.min(6, s + 1))}
                disabled={section === 6}
                className="rounded-lg bg-slate-900 px-5 py-2 text-sm text-white disabled:opacity-30 hover:bg-slate-800 transition">
                Edasi →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SECTION 1: PERIOOD JA MAJA ───────────────────────────────────────────────

function Section1({ data, update, computed }) {
  return (
    <div className="space-y-7">
      <SectionHeader num="1" title="Periood ja maja" />

      <div className="grid grid-cols-2 gap-4">
        <Field label="KÜ nimi" value={data.general.name} onChange={v => update("general.name", v)} placeholder="nt Näidise KÜ" required />
        <Field label="Registrikood" value={data.general.regCode} onChange={v => update("general.regCode", v)} placeholder="12345678" required />
        <div className="col-span-2">
          <Field label="Aadress" value={data.general.address} onChange={v => update("general.address", v)} placeholder="Tänav 1, Linn" />
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-700 mb-2">
          Periood <span className="text-rose-500">*</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Algus" type="date" value={data.general.periodStart} onChange={v => update("general.periodStart", v)} />
          <Field label="Lõpp" type="date" value={data.general.periodEnd} onChange={v => update("general.periodEnd", v)} />
        </div>
        {computed.period_days > 0 && (
          <div className="mt-2 text-xs text-slate-400 flex gap-4">
            <span>{computed.period_days} päeva</span>
            <span>≈ {r2(computed.period_month_equiv)} kuud</span>
            <span>≈ {r2(computed.period_year_fraction)} aastat</span>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-slate-700">
            Korterid <span className="text-rose-500">*</span>
          </div>
          {computed.apartment_count > 0 && (
            <div className="text-xs text-slate-400">
              {computed.apartment_count} korterit · {r2(computed.total_area_m2)} m² kokku
            </div>
          )}
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-left">
              <th className="pb-2 pr-3 text-xs font-medium text-slate-400">Tähis</th>
              <th className="pb-2 pr-3 text-xs font-medium text-slate-400">Pind (m²)</th>
              <th className="pb-2 pr-3 text-xs font-medium text-slate-400">Kaasomandi osa</th>
              <th className="pb-2 text-xs font-medium text-slate-400">Märkused</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.apartments.map((apt, idx) => (
              <tr key={apt.id}>
                <td className="py-1 pr-3">
                  <SoftInput className="w-20" value={apt.label}
                    onChange={e => { const next = clone(data.apartments); next[idx].label = e.target.value; update("apartments", next); }} />
                </td>
                <td className="py-1 pr-3">
                  <SoftInput className="w-24" value={apt.area} placeholder="0.00"
                    onChange={e => { const next = clone(data.apartments); next[idx].area = e.target.value; update("apartments", next); }} />
                </td>
                <td className="py-1 pr-3 text-sm text-slate-400">
                  {computed.total_area_m2 > 0 && n(apt.area) > 0 ? pct(n(apt.area) / computed.total_area_m2 * 100) : "—"}
                </td>
                <td className="py-1 pr-3">
                  <SoftInput className="w-full" value={apt.note} placeholder="valikuline"
                    onChange={e => { const next = clone(data.apartments); next[idx].note = e.target.value; update("apartments", next); }} />
                </td>
                <td className="py-1">
                  <button className="text-slate-300 hover:text-rose-400 transition text-sm" onClick={() => {
                    const next = data.apartments.filter(a => a.id !== apt.id);
                    update("apartments", next.length ? next : [{ id: uid(), label: "1", area: "", note: "" }]);
                  }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddRowLink onClick={() => update("apartments", [...data.apartments, { id: uid(), label: String(data.apartments.length + 1), area: "", note: "" }])}>
          Lisa korter
        </AddRowLink>
      </div>
    </div>
  );
}

// ─── SECTION 2: PLAANITAVAD TÖÖD ─────────────────────────────────────────────

function Section2({ data, update, computed }) {
  return (
    <div className="space-y-5">
      <SectionHeader num="2" title="Plaanitavad tööd" subtitle="Kavandatavad toimingud ja nende rahastamine." />

      {data.works.map((work, wi) => (
        <div key={work.id} className="rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-600">Töö {wi + 1}</div>
            <button className="text-xs text-slate-400 hover:text-rose-500 transition" onClick={() => {
              const next = data.works.filter(w => w.id !== work.id);
              update("works", next.length ? next : [{
                id: uid(), name: "", plannedQuarter: "", cost: "", note: "",
                funding: [{ id: uid(), source: "remondifond", amount: "", condition: "", note: "" }]
              }]);
            }}>Eemalda</button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Töö nimetus" value={work.name}
                onChange={v => { const next = clone(data.works); next[wi].name = v; update("works", next); }}
                placeholder="nt Katuse renoveerimine" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1.5">Planeeritud aeg</div>
              <QuarterSelect value={work.plannedQuarter}
                onChange={v => { const next = clone(data.works); next[wi].plannedQuarter = v; update("works", next); }} />
            </div>
            <Field label="Maksumus (eurot)" value={work.cost}
              onChange={v => { const next = clone(data.works); next[wi].cost = v; update("works", next); }}
              placeholder="0.00" />
            <div className="col-span-2">
              <Field label="Märkused" value={work.note}
                onChange={v => { const next = clone(data.works); next[wi].note = v; update("works", next); }}
                placeholder="valikuline" />
            </div>
          </div>

          {/* Funding */}
          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">Rahastamine</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="pb-1.5 pr-2 text-xs font-medium text-slate-400">Allikas</th>
                  <th className="pb-1.5 pr-2 text-xs font-medium text-slate-400">Summa (eurot)</th>
                  <th className="pb-1.5 pr-2 text-xs font-medium text-slate-400">Tingimus</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {work.funding.map((f, fi) => (
                  <tr key={f.id}>
                    <td className="py-1 pr-2">
                      <select
                        className="rounded-lg text-sm px-2 py-1.5 w-full"
                        style={{ border: "1px solid rgba(0,0,0,0.12)" }}
                        value={f.source}
                        onChange={e => { const next = clone(data.works); next[wi].funding[fi].source = e.target.value; update("works", next); }}>
                        {FUNDING_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <SoftInput className="w-28" value={f.amount} placeholder="0.00"
                        onChange={e => { const next = clone(data.works); next[wi].funding[fi].amount = e.target.value; update("works", next); }} />
                    </td>
                    <td className="py-1 pr-2">
                      <SoftInput className="w-full" value={f.condition} placeholder="valikuline"
                        onChange={e => { const next = clone(data.works); next[wi].funding[fi].condition = e.target.value; update("works", next); }} />
                    </td>
                    <td className="py-1">
                      <button className="text-slate-300 hover:text-rose-400 transition" onClick={() => {
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
            <AddRowLink onClick={() => {
              const next = clone(data.works);
              next[wi].funding.push({ id: uid(), source: "remondifond", amount: "", condition: "", note: "" });
              update("works", next);
            }}>Lisa allikas</AddRowLink>

            {n(work.cost) > 0 && (() => {
              const funded = work.funding.reduce((s, f) => s + n(f.amount), 0);
              const ok = r2(funded) >= r2(n(work.cost));
              return (
                <div className={`mt-2 text-xs rounded-lg px-3 py-2 ${ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  Kaetud: {fmt(funded)} / {fmt(n(work.cost))} eurot
                  {funded > n(work.cost) && ` · ülejääk ${fmt(funded - n(work.cost))} eurot`}
                </div>
              );
            })()}
          </div>
        </div>
      ))}

      <button
        className="w-full rounded-xl border border-dashed border-slate-200 py-2.5 text-sm text-slate-400 hover:border-slate-300 hover:text-slate-600 transition"
        onClick={() => update("works", [...data.works, {
          id: uid(), name: "", plannedQuarter: "", cost: "", note: "",
          funding: [{ id: uid(), source: "remondifond", amount: "", condition: "", note: "" }]
        }])}>
        + Lisa töö
      </button>

      {computed.works_total > 0 && (
        <SummaryCard>
          <div className="text-xs text-slate-500 mb-3">Tööde kokkuvõte</div>
          <div className="grid grid-cols-3 gap-4">
            <SummaryItem label="Tööde kogumaksumus" value={eur(computed.works_total)} />
            <SummaryItem label="Kokku kaetud" value={eur(computed.total_works_funded)} ok={computed.works_covered} />
            <SummaryItem label="Remondifondist" value={eur(computed.funding_from_repair_fund_period)} />
          </div>
        </SummaryCard>
      )}
    </div>
  );
}

// ─── SECTION 3: JOOKSVAD TULUD JA KULUD ──────────────────────────────────────

function Section3({ data, update, computed, setResetModal }) {
  const otherIncomes = data.otherIncomes || [];

  return (
    <div className="space-y-8">
      <SectionHeader num="3" title="Jooksvad tulud ja kulud" subtitle="Perioodilised majandamiskulud ja muud tulud." />

      {/* A. TULUD — discreet */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium text-slate-700">Muud tulud <span className="text-xs font-normal text-slate-400">(valikuline)</span></div>
          {otherIncomes.length > 0 && (
            <button className="text-xs text-slate-400 hover:text-slate-600 transition"
              onClick={() => setResetModal({ name: "Muud tulud", action: () => update("otherIncomes", []) })}>
              Lähtesta
            </button>
          )}
        </div>
        <div className="text-xs text-slate-400 mb-3">
          Sisestage ainult tulud, mis ei ole seotud remondifondi ega reservkapitaliga.
        </div>

        {otherIncomes.length > 0 && (
          <table className="w-full text-sm mb-1">
            <thead>
              <tr className="text-left">
                <th className="pb-1.5 pr-3 text-xs font-medium text-slate-400">Kirjeldus</th>
                <th className="pb-1.5 pr-3 text-xs font-medium text-slate-400">Summa perioodis (eurot)</th>
                <th className="pb-1.5 text-xs font-medium text-slate-400">Märkused</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {otherIncomes.map((row, idx) => (
                <tr key={row.id}>
                  <td className="py-1 pr-3">
                    <SoftInput className="w-full" value={row.description} placeholder="nt Üüritulu"
                      onChange={e => { const next = clone(otherIncomes); next[idx].description = e.target.value; update("otherIncomes", next); }} />
                  </td>
                  <td className="py-1 pr-3">
                    <SoftInput className="w-28" value={row.amount} placeholder="0.00"
                      onChange={e => { const next = clone(otherIncomes); next[idx].amount = e.target.value; update("otherIncomes", next); }} />
                  </td>
                  <td className="py-1 pr-3">
                    <SoftInput className="w-full" value={row.note} placeholder="valikuline"
                      onChange={e => { const next = clone(otherIncomes); next[idx].note = e.target.value; update("otherIncomes", next); }} />
                  </td>
                  <td className="py-1">
                    <button className="text-slate-300 hover:text-rose-400 transition text-xs"
                      onClick={() => update("otherIncomes", otherIncomes.filter(r => r.id !== row.id))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex items-center justify-between">
          <AddRowLink onClick={() => update("otherIncomes", [...otherIncomes, { id: uid(), description: "", amount: "", note: "" }])}>
            Lisa tulu
          </AddRowLink>
          {computed.other_income_period > 0 && (
            <div className="text-sm text-slate-500">
              Muud tulud kokku: <span className="font-semibold text-slate-700">{eur(computed.other_income_period)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100" />

      {/* B. HALDUS-HOOLDUS */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-slate-700">Haldus ja hooldus</div>
          <button className="text-xs text-slate-400 hover:text-slate-600 transition"
            onClick={() => setResetModal({ name: "Haldus ja hooldus", action: () => update("adminCosts", INITIAL_ADMIN()) })}>
            Lähtesta
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="pb-2 pr-3 text-xs font-medium text-slate-400">Kirjeldus</th>
              <th className="pb-2 pr-3 text-xs font-medium text-slate-400">Summa perioodis (eurot)</th>
              <th className="pb-2 text-xs font-medium text-slate-400">Märkused</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.adminCosts.map((row, idx) => (
              <tr key={row.id}>
                <td className="py-1.5 pr-3">
                  <SoftInput className="w-full" value={row.description}
                    onChange={e => { const next = clone(data.adminCosts); next[idx].description = e.target.value; update("adminCosts", next); }} />
                </td>
                <td className="py-1.5 pr-3">
                  <SoftInput className="w-28" value={row.amount} placeholder="0.00"
                    onChange={e => { const next = clone(data.adminCosts); next[idx].amount = e.target.value; update("adminCosts", next); }} />
                </td>
                <td className="py-1.5 pr-3">
                  <SoftInput className="w-full" value={row.note} placeholder="valikuline"
                    onChange={e => { const next = clone(data.adminCosts); next[idx].note = e.target.value; update("adminCosts", next); }} />
                </td>
                <td className="py-1.5">
                  <button className="text-slate-300 hover:text-rose-400 transition text-xs"
                    onClick={() => {
                      const next = data.adminCosts.filter(r => r.id !== row.id);
                      update("adminCosts", next.length ? next : [{ id: uid(), description: "", amount: "", note: "" }]);
                    }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between mt-1">
          <AddRowLink onClick={() => update("adminCosts", [...data.adminCosts, { id: uid(), description: "", amount: "", note: "" }])}>
            Lisa rida
          </AddRowLink>
          <div className="text-sm text-slate-500">
            Haldus ja hooldus kokku: <span className="font-semibold text-slate-700">{eur(computed.admin_cost_period)}</span>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100" />

      {/* C. MAJANDAMISKULUDE PROGNOOS */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium text-slate-700">Majandamiskulude prognoos</div>
          <button className="text-xs text-slate-400 hover:text-slate-600 transition"
            onClick={() => setResetModal({ name: "Majandamiskulude prognoos", action: () => update("services", INITIAL_SERVICES()) })}>
            Lähtesta
          </button>
        </div>
        <div className="text-xs text-slate-400 mb-3">
          Soojusenergia, vee- ja kanalisatsiooniteenuse ning elektrienergia prognoositav kogus aastas.
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="pb-2 pr-2 text-xs font-medium text-slate-400">Teenus</th>
              <th className="pb-2 pr-2 text-xs font-medium text-slate-400">Aastane kogus</th>
              <th className="pb-2 pr-2 text-xs font-medium text-slate-400">Ühik</th>
              <th className="pb-2 pr-2 text-xs font-medium text-slate-400">Ühikuhind (eurot)</th>
              <th className="pb-2 pr-2 text-xs font-medium text-slate-400">Summa perioodis (eurot)</th>
              <th className="pb-2 text-xs font-medium text-slate-400">Märkused</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.services.map((svc, idx) => {
              const period_cost = svc.isMonthly
                ? n(svc.unitPrice) * computed.period_month_equiv
                : n(svc.qty) * n(svc.unitPrice) * computed.period_year_fraction;
              return (
                <tr key={svc.id}>
                  <td className="py-1.5 pr-2">
                    <SoftInput className="w-full" value={svc.name}
                      onChange={e => { const next = clone(data.services); next[idx].name = e.target.value; update("services", next); }} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <SoftInput className="w-20" value={svc.qty} placeholder={svc.isMonthly ? "—" : "0"} disabled={svc.isMonthly}
                      onChange={e => { const next = clone(data.services); next[idx].qty = e.target.value; update("services", next); }} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <select className="rounded-lg text-sm px-2 py-1.5"
                      style={{ border: "1px solid rgba(0,0,0,0.12)" }}
                      value={svc.unit}
                      onChange={e => { const next = clone(data.services); next[idx].unit = e.target.value; next[idx].isMonthly = e.target.value === "kuu"; update("services", next); }}>
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <SoftInput className="w-24" value={svc.unitPrice} placeholder="0.00"
                      onChange={e => { const next = clone(data.services); next[idx].unitPrice = e.target.value; update("services", next); }} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600"
                      style={{ backgroundColor: "#F3F6FA", minWidth: "7rem" }}>
                      {period_cost > 0 ? fmt(period_cost) : "—"}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2">
                    <SoftInput className="w-full" value={svc.note} placeholder="valikuline"
                      onChange={e => { const next = clone(data.services); next[idx].note = e.target.value; update("services", next); }} />
                  </td>
                  <td className="py-1.5">
                    <button className="text-slate-300 hover:text-rose-400 transition text-xs"
                      onClick={() => {
                        const next = data.services.filter(s => s.id !== svc.id);
                        update("services", next.length ? next : [{ id: uid(), name: "", qty: "", unit: "MWh", unitPrice: "", note: "", isMonthly: false }]);
                      }}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between mt-1">
          <AddRowLink onClick={() => update("services", [...data.services, { id: uid(), name: "", qty: "", unit: "MWh", unitPrice: "", note: "", isMonthly: false }])}>
            Lisa teenus
          </AddRowLink>
          <div className="text-sm text-slate-500">
            Majandamiskulud kokku: <span className="font-semibold text-slate-700">{eur(computed.management_cost_period)}</span>
          </div>
        </div>
      </div>

      {/* D. ELEVATED SUMMARY CARD */}
      {computed.running_cost_period > 0 && (
        <div className="rounded-xl p-5" style={{ backgroundColor: "#F7F9FC", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">Jooksvad tulud ja kulud kokku perioodis</div>
          <div className="space-y-1.5 text-sm">
            {computed.other_income_period > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Muud tulud</span>
                <span>{eur(computed.other_income_period)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-500">
              <span>Haldus ja hooldus</span>
              <span>{eur(computed.admin_cost_period)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Majandamiskulud</span>
              <span>{eur(computed.management_cost_period)}</span>
            </div>
          </div>
          <div className="border-t border-slate-200 mt-3 pt-3 flex justify-between">
            <span className="text-sm font-semibold text-slate-700">Jooksvad kulud kokku</span>
            <span className="text-base font-bold text-slate-900">{eur(computed.running_cost_period)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SECTION 4: RAHA JA FINANTSEERIMINE ──────────────────────────────────────

function Section4({ data, update, computed }) {
  return (
    <div className="space-y-6">
      <SectionHeader num="4" title="Raha ja finantseerimine" subtitle="Remondifond, reservkapital ja laen." />

      {/* Remondifond */}
      <div className="rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="text-sm font-medium text-slate-700">Remondifond</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Remondifondi makse (eurot/m²/kuus)" value={data.repairFundRate}
            onChange={v => update("repairFundRate", v)} placeholder="0.00" required />
          <div className="rounded-lg p-3" style={{ backgroundColor: "#F7F9FC" }}>
            <div className="text-xs text-slate-400 mb-0.5">Kogutulu perioodis</div>
            <div className="text-sm font-semibold text-slate-700">{eur(computed.repair_fund_income_period)}</div>
          </div>
        </div>
        <Field label="Märkused" value={data.repairFundNote} onChange={v => update("repairFundNote", v)} placeholder="valikuline" />
        {computed.repair_fund_min_per_m2 > 0 && (
          <StatusBadge ok={computed.repair_fund_ok}
            okText="Remondifondimäär on piisav"
            failText="Remondifondimäär on liian väike">
            <div className="text-xs mt-0.5">
              Nõutav: {fmt4(computed.repair_fund_min_per_m2)} eurot/m²/kuus
              {!computed.repair_fund_ok && ` · puudujääk ${fmt4(computed.repair_fund_min_per_m2 - computed.repair_fund_rate)}`}
            </div>
          </StatusBadge>
        )}
      </div>

      {/* Reservkapital */}
      <div className="rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="text-sm font-medium text-slate-700">Reservkapital</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Planeeritud reservkapital perioodi lõpuks (eurot)" value={data.plannedReserve}
            onChange={v => update("plannedReserve", v)} placeholder="0.00" required />
          <div className="rounded-lg p-3" style={{ backgroundColor: "#F7F9FC" }}>
            <div className="text-xs text-slate-400 mb-0.5">Nõutav miinimum</div>
            <div className="text-sm font-semibold text-slate-700">{eur(computed.required_reserve_capital)}</div>
            <div className="text-xs text-slate-400 mt-0.5">= aasta kulud / 12</div>
          </div>
        </div>
        {computed.required_reserve_capital > 0 && (
          <StatusBadge ok={computed.reserve_ok}
            okText="Reservkapital vastab nõudele"
            failText="Reservkapital on alla miinimumi">
            <div className="text-xs mt-0.5">
              Planeeritud: {eur(computed.planned_reserve)} · Nõutav: {eur(computed.required_reserve_capital)}
            </div>
          </StatusBadge>
        )}
        <Field label="Märkused" value={data.reserveNote} onChange={v => update("reserveNote", v)} placeholder="valikuline" />
      </div>

      {/* Laen */}
      <div className="rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-700">Laen</div>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-slate-600">
            <input type="checkbox" checked={data.loanEnabled}
              onChange={e => update("loanEnabled", e.target.checked)} />
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
                <div className="text-xs font-medium text-slate-500 mb-1.5">Graafiku tüüp</div>
                <select className="w-full rounded-lg px-3 py-2 text-sm"
                  style={{ border: "1px solid rgba(0,0,0,0.12)" }}
                  value={data.loan.type} onChange={e => update("loan.type", e.target.value)}>
                  <option value="annuity">Annuiteetlaen (võrdne kuumakse)</option>
                  <option value="fixed">Fikseeritud põhiosaga</option>
                </select>
              </div>
              <Field label="Panga reservinõue (%)" value={data.loan.reserveMinPct} onChange={v => update("loan.reserveMinPct", v)} placeholder="10" />
              <Field label="Märkused" value={data.loan.note} onChange={v => update("loan.note", v)} placeholder="valikuline" />
            </div>

            {computed.loanSchedule.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["Kuine laenumakse", eur(computed.loanSchedule[0]?.total)],
                  ["Teenindus perioodis", eur(computed.loan_service_period)],
                  ["Reservinõue perioodis", eur(computed.loan_reserve_required_period)],
                  ["Teenindus eurot/m²/kuu", fmt4(computed.loan_service_per_m2_month)],
                  ["Reserv eurot/m²/kuu", fmt4(computed.loan_reserve_per_m2_month)],
                ].map(([label, val]) => (
                  <div key={label} className="rounded-lg p-3" style={{ backgroundColor: "#F7F9FC" }}>
                    <div className="text-xs text-slate-400 mb-0.5">{label}</div>
                    <div className="text-sm font-semibold text-slate-700">{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Automaatne finantskokkuvõte */}
      <SummaryCard>
        <div className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">Automaatne finantskokkuvõte</div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <SummaryItem label="Tööde kogukulu" value={eur(computed.works_total)} />
          <SummaryItem label="Laenuvajadus" value={eur(computed.funding_from_loan_principal)} />
          <SummaryItem label="Remondifond perioodis" value={eur(computed.repair_fund_income_period)} />
          {data.loanEnabled && computed.loanSchedule.length > 0 && <>
            <SummaryItem label="Kuine laenumakse" value={eur(computed.loanSchedule[0]?.total)} />
            <SummaryItem label="Kuine reserv" value={eur(computed.loan_reserve_monthly_equiv)} />
            <SummaryItem label="Vajalik remondifond (laenuga)" value={`${fmt4(computed.repair_fund_min_per_m2)} eurot/m²/kuu`} ok={computed.repair_fund_ok} />
          </>}
        </div>
        {!computed.repair_fund_ok && computed.repair_fund_min_per_m2 > 0 && (
          <div className="mt-3 text-xs text-rose-600 border-t border-slate-200 pt-3">
            Puudujääk remondifondis: {fmt4(computed.repair_fund_min_per_m2 - computed.repair_fund_rate)} eurot/m²/kuus
          </div>
        )}
      </SummaryCard>
    </div>
  );
}

// ─── SECTION 5: KORTERITE MAKSED ─────────────────────────────────────────────

function Section5({ computed }) {
  if (computed.apartment_count === 0) {
    return (
      <div className="space-y-4">
        <SectionHeader num="5" title="Korterite maksed" />
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
          Palun sisesta esmalt korterid ja nende pindalad (Sektsioon 1).
        </div>
      </div>
    );
  }

  const total_monthly = computed.aptPayments.reduce((s, a) => s + a.apt_total_monthly, 0);
  const hasLoan = computed.loanSchedule.length > 0;
  const hasSpecial = computed.special_monthly > 0;

  return (
    <div className="space-y-6">
      <SectionHeader num="5" title="Korterite maksed" subtitle="Perioodilised ettemaksed kaasomandi osa järgi." />

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-4 py-3 text-xs font-medium text-slate-500">Korter</th>
              <th className="px-4 py-3 text-xs font-medium text-slate-500">Pind (m²)</th>
              <th className="px-4 py-3 text-xs font-medium text-slate-500">Osakaal</th>
              <th className="px-4 py-3 text-xs font-medium text-slate-500">Haldus-hooldus<br/><span className="font-normal">(eurot/kuu)</span></th>
              <th className="px-4 py-3 text-xs font-medium text-slate-500">Majandamiskulud<br/><span className="font-normal">(eurot/kuu)</span></th>
              <th className="px-4 py-3 text-xs font-medium text-slate-500">Remondifond<br/><span className="font-normal">(eurot/kuu)</span></th>
              {hasSpecial && <th className="px-4 py-3 text-xs font-medium text-slate-500">Erimaksed<br/><span className="font-normal">(eurot/kuu)</span></th>}
              {hasLoan && <>
                <th className="px-4 py-3 text-xs font-medium text-slate-500">Laen<br/><span className="font-normal">(eurot/kuu)</span></th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500">Reserv<br/><span className="font-normal">(eurot/kuu)</span></th>
              </>}
              <th className="px-4 py-3 text-xs font-medium text-slate-700">Kokku<br/><span className="font-normal">(eurot/kuu)</span></th>
            </tr>
          </thead>
          <tbody>
            {computed.aptPayments.map((a, i) => (
              <tr key={a.id} className={i % 2 === 0 ? "" : "bg-slate-50/50"}>
                <td className="px-4 py-2.5 font-medium">{a.label}</td>
                <td className="px-4 py-2.5 text-slate-500">{r2(n(a.area)).toLocaleString("et-EE")}</td>
                <td className="px-4 py-2.5 text-slate-400">{pct(a.share * 100)}</td>
                <td className="px-4 py-2.5">{fmt(a.apt_admin)}</td>
                <td className="px-4 py-2.5">{fmt(a.apt_management)}</td>
                <td className="px-4 py-2.5">{fmt(a.apt_repair_fund)}</td>
                {hasSpecial && <td className="px-4 py-2.5">{fmt(a.apt_special)}</td>}
                {hasLoan && <>
                  <td className="px-4 py-2.5">{fmt(a.apt_loan_service)}</td>
                  <td className="px-4 py-2.5">{fmt(a.apt_loan_reserve)}</td>
                </>}
                <td className="px-4 py-2.5 font-semibold">{fmt(a.apt_total_monthly)}</td>
              </tr>
            ))}
            <tr className="bg-slate-900 text-white">
              <td className="px-4 py-3 font-semibold">Kokku</td>
              <td className="px-4 py-3">{r2(computed.total_area_m2).toLocaleString("et-EE")} m²</td>
              <td className="px-4 py-3">100%</td>
              <td className="px-4 py-3">{fmt(computed.admin_monthly_equiv)}</td>
              <td className="px-4 py-3">{fmt(computed.management_monthly_equiv)}</td>
              <td className="px-4 py-3">{fmt(computed.repair_fund_rate * computed.total_area_m2)}</td>
              {hasSpecial && <td className="px-4 py-3">{fmt(computed.special_monthly)}</td>}
              {hasLoan && <>
                <td className="px-4 py-3">{fmt(computed.loan_service_monthly_equiv)}</td>
                <td className="px-4 py-3">{fmt(computed.loan_reserve_monthly_equiv)}</td>
              </>}
              <td className="px-4 py-3 font-bold text-base">{fmt(total_monthly)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-right text-sm text-slate-500">
        Perioodilised ettemaksed kokku perioodis:{" "}
        <strong className="text-slate-900">{eur(total_monthly * computed.period_month_equiv)}</strong>
      </div>
    </div>
  );
}

// ─── SECTION 6: KOKKUVÕTE JA KONTROLL ────────────────────────────────────────

function Section6({ data, update, computed, checkWithSolvere, solvereLoading, solvereResult }) {
  const checks = [
    { label: "Periood on määratud", ok: computed.period_days > 0 },
    { label: "Vähemalt 1 korter andmetega", ok: computed.apartment_count > 0 },
    { label: "Jooksvad kulud sisestatud", ok: computed.running_cost_period > 0 },
    { label: "Reservkapital vastab nõudele", ok: computed.reserve_ok },
    { label: "Remondifondimäär on piisav", ok: computed.repair_fund_ok },
    { label: "Tööde rahastus kaetud", ok: computed.works_covered },
    { label: "Eelarve on tasakaalus", ok: computed.budget_ok },
  ];
  const allOk = checks.every(c => c.ok);
  const balance = computed.monthly_inflows - computed.monthly_outflows;

  return (
    <div className="space-y-6">
      <SectionHeader num="6" title="Kokkuvõte ja kontroll" />

      {/* Finantskoond */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 p-4 text-center">
          <div className="text-xs text-slate-400 mb-1">Kulud kokku perioodis</div>
          <div className="text-lg font-bold">{eur(computed.total_cost_period)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 text-center">
          <div className="text-xs text-slate-400 mb-1">Tulud kokku perioodis</div>
          <div className="text-lg font-bold">{eur(computed.total_income_period)}</div>
        </div>
        <div className={`rounded-xl border p-4 text-center ${
          computed.budget_ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
        }`}>
          <div className="text-xs text-slate-400 mb-1">Eelarve tasakaal (kuus)</div>
          <div className={`text-lg font-bold ${computed.budget_ok ? "text-emerald-700" : "text-rose-700"}`}>
            {eur(balance)}
          </div>
        </div>
      </div>

      {/* Seaduslik kontroll */}
      <div className="rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-medium text-slate-700 mb-3">Seaduslik kontroll</div>
        <div className="space-y-1.5">
          {checks.map((c, i) => (
            <div key={i} className={`flex items-center gap-2.5 text-sm px-3 py-2 rounded-lg ${
              c.ok ? "text-emerald-700" : "text-rose-600 bg-rose-50"
            }`}>
              <span className="text-base">{c.ok ? "✅" : "❌"}</span>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Solvere */}
      <div className="rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-slate-700">Solvere automaatkontroll</div>
          <button onClick={checkWithSolvere} disabled={solvereLoading}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50 hover:bg-slate-800 transition">
            {solvereLoading ? "Kontrollin..." : "Kontrolli õiguspärasust"}
          </button>
        </div>
        {solvereResult && (
          <div className={`rounded-xl p-4 text-sm ${
            solvereResult.error ? "bg-amber-50 text-amber-800" :
            solvereResult.valid ? "bg-emerald-50 text-emerald-800" :
            "bg-rose-50 text-rose-800"}`}>
            <div className="font-semibold">
              {solvereResult.error ? `⚠️ ${solvereResult.message}` :
               solvereResult.valid ? "✅ Majanduskava on õiguspärane" :
               "❌ Leiti õiguslikke vastuolusid"}
            </div>
            {solvereResult.violations?.map((v, i) => (
              <div key={i} className="mt-2 border-t border-current/20 pt-2">
                <div className="font-semibold">{v.reference}</div>
                <div className="mt-0.5">{v.message}</div>
                {v.provided_value != null && <div className="text-xs mt-1 opacity-70">Sisestatud: {eur(v.provided_value)}</div>}
              </div>
            ))}
            {solvereResult.trace_id && (
              <div className="mt-2 text-xs opacity-40">Trace ID: {solvereResult.trace_id}</div>
            )}
          </div>
        )}
      </div>

      {/* Vormistamine */}
      <div className="rounded-xl border border-slate-200 p-5 space-y-3">
        <div className="text-sm font-medium text-slate-700">Vormistamine</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Üldkoosoleku kuupäev" type="date" value={data.meetingDate} onChange={v => update("meetingDate", v)} />
          <Field label="Kehtib alates" type="date" value={data.effectiveFrom} onChange={v => update("effectiveFrom", v)} />
          <Field label="Koostaja" value={data.preparer} onChange={v => update("preparer", v)} placeholder="Juhatuse liige" />
        </div>
      </div>

      {/* PDF */}
      <div className={`rounded-xl p-5 ${allOk ? "bg-slate-900 text-white" : "bg-slate-100"}`}>
        {allOk ? (
          <div className="mb-3">
            <div className="font-semibold">✅ Kõik kontrollid on läbitud</div>
            <div className="text-sm text-slate-300 mt-0.5">Majanduskava on valmis kinnitamiseks.</div>
          </div>
        ) : (
          <div className="text-sm text-slate-500 mb-3">
            Mõned kontrollid vajavad tähelepanu. PDF on siiski genereeritav.
          </div>
        )}
        <button onClick={() => window.print()}
          className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
            allOk
              ? "bg-white text-slate-900 hover:bg-slate-100"
              : "bg-slate-900 text-white hover:bg-slate-800"
          }`}>
          Genereeri majanduskava PDF
        </button>
      </div>
    </div>
  );
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────

function SectionHeader({ num, title, subtitle }) {
  return (
    <div className="border-b border-slate-100 pb-5 mb-1">
      <div className="flex items-baseline gap-2.5">
        <span className="text-2xl font-bold text-slate-200">{num}</span>
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      </div>
      {subtitle && <div className="mt-1 text-sm text-slate-400">{subtitle}</div>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required, disabled }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-slate-500 mb-1.5">
        {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
      </div>
      <input
        type={type}
        className="w-full rounded-lg px-3 py-2 text-sm placeholder:text-slate-300 disabled:bg-slate-50 transition focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        style={{ border: "1px solid rgba(0,0,0,0.12)" }}
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}

function SoftInput({ className = "", ...props }) {
  return (
    <input
      {...props}
      className={`rounded-lg px-2.5 py-1.5 text-sm placeholder:text-slate-300 disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900/10 ${className}`}
      style={{ border: "1px solid rgba(0,0,0,0.12)", ...props.style }}
    />
  );
}

function AddRowLink({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="text-xs transition mt-1"
      style={{ color: "#9CA3AF" }}
      onMouseEnter={e => e.target.style.color = "#4B5563"}
      onMouseLeave={e => e.target.style.color = "#9CA3AF"}>
      + {children}
    </button>
  );
}

function SummaryCard({ children }) {
  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: "#F7F9FC", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      {children}
    </div>
  );
}

function SummaryItem({ label, value, ok }) {
  return (
    <div>
      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
      <div className={`text-sm font-semibold ${ok === true ? "text-emerald-700" : ok === false ? "text-rose-600" : "text-slate-700"}`}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ ok, okText, failText, children }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 text-sm ${ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
      <div className="font-medium">{ok ? `✅ ${okText}` : `❌ ${failText}`}</div>
      {children}
    </div>
  );
}

function Divider() {
  return <hr className="border-slate-100" />;
}
