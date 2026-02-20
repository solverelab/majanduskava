import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * MajanduskavaApp.jsx
 * - Mitmeleheline majanduskava vorm (KrtS § 41 lg 1 p 1–5 loogika)
 * - Lapselihtne täitmine, professionaalne väljund
 * - Automaat-arvutused, validatsioonid, hoiatused
 * - localStorage autosave + eksport (print/PDF)
 *
 * NB! See on front-end MVP. SaaS-iks: hiljem lisad auth + andmebaasi + multi-ühingud.
 */

// ------------------------- utils -------------------------
const LS_KEY = "solverelab_majanduskava_v1";

const euro = (n) => {
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString("et-EE", { style: "currency", currency: "EUR" });
};

const pct = (n, digits = 3) => {
  const x = Number.isFinite(n) ? n : 0;
  return `${x.toFixed(digits)}%`;
};

const num = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const cleaned = String(v).replace(",", ".").replace(/\s/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const uid = () => Math.random().toString(36).slice(2, 10);

function clampNonNeg(n) {
  const x = num(n);
  return x < 0 ? 0 : x;
}

function sum(arr, pick = (x) => x) {
  return arr.reduce((acc, it) => acc + num(pick(it)), 0);
}

function diff(plan, prev) {
  return num(plan) - num(prev);
}

function round2(n) {
  const x = num(n);
  return Math.round(x * 100) / 100;
}

// ------------------------- defaults -------------------------
const DEFAULT_CONDITION = [
  { id: "roof", label: "Katus ja katusekate", status: "hea", last: "", next: "", notes: "" },
  { id: "facade", label: "Välisseinad ja fassaad", status: "hea", last: "", next: "", notes: "" },
  { id: "windows", label: "Aknad ja välisuksed", status: "hea", last: "", next: "", notes: "" },
  { id: "foundation", label: "Vundament / kelder", status: "hea", last: "", next: "", notes: "" },
  { id: "stair", label: "Trepikojad ja üldruumid", status: "hea", last: "", next: "", notes: "" },
  { id: "heating", label: "Küttesüsteem (torustik/radiaatorid)", status: "hea", last: "", next: "", notes: "" },
  { id: "hotwater", label: "Soe tarbevesi", status: "hea", last: "", next: "", notes: "" },
  { id: "water", label: "Vesi ja kanalisatsioon", status: "hea", last: "", next: "", notes: "" },
  { id: "electric", label: "Elektrisüsteem ja valgustus", status: "hea", last: "", next: "", notes: "" },
  { id: "vent", label: "Ventilatsioon", status: "hea", last: "", next: "", notes: "" },
  { id: "lift", label: "Lift (kui on)", status: "hea", last: "", next: "", notes: "" },
  { id: "yard", label: "Territoorium ja haljastus", status: "hea", last: "", next: "", notes: "" },
];

const DEFAULT_INCOME = [
  { id: "advances", label: "Majandamiskulude ettemaksed korteriomanikelt (§ 40 lg 1)", prev: 0, plan: 0 },
  { id: "repairFund", label: "Remondifond – laekumised korteriomanikelt (KrtS § 41 lg 1 p 4)", prev: 0, plan: 0 },
  { id: "reserveFund", label: "Reservkapitali laekumised (KrtS § 48)", prev: 0, plan: 0 },
  { id: "rent", label: "Renditulud (ühisruumide üür vms)", prev: 0, plan: 0 },
  { id: "subsidy", label: "Toetused ja sihtfinantseerimine", prev: 0, plan: 0 },
  { id: "otherIncome", label: "Muud tulud", prev: 0, plan: 0 },
];

const DEFAULT_RUNNING = [
  { id: "heat", label: "Soojusenergia (küttekulud)", prev: 0, plan: 0, group: "Energia" },
  { id: "electricCommon", label: "Elekter (üldruumid/õuevalgustus)", prev: 0, plan: 0, group: "Energia" },
  { id: "waterSewer", label: "Vesi ja kanalisatsioon", prev: 0, plan: 0, group: "Vesi" },
  { id: "gas", label: "Gaas (kui kohaldub)", prev: 0, plan: 0, group: "Energia" },

  { id: "waste", label: "Prügivedu ja jäätmekäitlus", prev: 0, plan: 0, group: "Hooldus" },
  { id: "chimney", label: "Korstnapühkimine / seadmete hooldus", prev: 0, plan: 0, group: "Hooldus" },
  { id: "liftService", label: "Liftihooldus", prev: 0, plan: 0, group: "Hooldus" },
  { id: "fireSafety", label: "Tuleohutus (kustutid/signalisatsioon)", prev: 0, plan: 0, group: "Hooldus" },
  { id: "snow", label: "Lumekoristus ja heakord", prev: 0, plan: 0, group: "Hooldus" },
  { id: "landscape", label: "Haljastus ja territoorium", prev: 0, plan: 0, group: "Hooldus" },
  { id: "insurance", label: "Kindlustus (hoone/vastutus)", prev: 0, plan: 0, group: "Hooldus" },

  { id: "manager", label: "Valitseja/halduslepingu tasu", prev: 0, plan: 0, group: "Teenused" },
  { id: "accounting", label: "Raamatupidamisteenus", prev: 0, plan: 0, group: "Teenused" },
  { id: "bankFees", label: "Pangakulud ja tehingutasud", prev: 0, plan: 0, group: "Teenused" },
  { id: "legal", label: "Juriidilised ja notariteenused", prev: 0, plan: 0, group: "Teenused" },
  { id: "otherRunning", label: "Muud jooksvad kulud", prev: 0, plan: 0, group: "Teenused" },
];

const DEFAULT_INVEST = [
  { id: "plannedWorks", label: "Remondifondist finantseeritavad tööd (vt “Maja tervis”)", prev: 0, plan: 0 },
  { id: "loanPrincipal", label: "Laenu põhiosa tagasimaksed", prev: 0, plan: 0 },
  { id: "loanInterest", label: "Laenu intressimaksed", prev: 0, plan: 0 },
  { id: "otherInvest", label: "Muud investeeringud / erakorralised kulud", prev: 0, plan: 0 },
];

const DEFAULT_HEAT_MONTHS = [
  "Jaanuar",
  "Veebruar",
  "Märts",
  "Aprill",
  "Mai",
  "Juuni",
  "Juuli",
  "August",
  "September",
  "Oktober",
  "November",
  "Detsember",
].map((m) => ({ id: uid(), month: m, qtyMWh: 0, pricePerMWh: 0, prevCost: 0 }));

const DEFAULT_OTHER_ENERGY = [
  { id: "elec", label: "Elekter (üldruumid)", unit: "kWh", qty: 0, price: 0, prevCost: 0 },
  { id: "waterCold", label: "Vesi (külm)", unit: "m³", qty: 0, price: 0, prevCost: 0 },
  { id: "waterHot", label: "Vesi (soe)", unit: "m³", qty: 0, price: 0, prevCost: 0 },
  { id: "sewer", label: "Kanalisatsioon", unit: "m³", qty: 0, price: 0, prevCost: 0 },
  { id: "gas2", label: "Gaas (kui kohaldub)", unit: "m³", qty: 0, price: 0, prevCost: 0 },
];

const makeInitial = () => ({
  meta: {
    name: "",
    regCode: "",
    address: "",
    board: "",
    year: new Date().getFullYear(),
    periodStart: "",
    periodEnd: "",
    meetingDate: "",
    protocolNo: "",
  },
  building: {
    aptCount: 0,
    shareDenom: 1000,
    totalArea: 0,
    buildYear: "",
    floors: "",
  },
  condition: DEFAULT_CONDITION,
  plannedWorks: [
    { id: uid(), desc: "Näide: Trepikoja värvimine", type: "remont", period: "04.2026–05.2026", cost: 0, funding: "remondifond" },
  ],
  notes: { worksNotes: "" },

  budget: {
    income: DEFAULT_INCOME,
    running: DEFAULT_RUNNING,
    invest: DEFAULT_INVEST,
  },

  apartments: [
    { id: uid(), unit: "Korter 1", owner: "", shareNum: 0 },
    { id: uid(), unit: "Korter 2", owner: "", shareNum: 0 },
  ],

  funds: {
    reserveStart: 0,
    reserveIn: 0,
    reserveOut: 0,
    repairStart: 0,
    repairIn: 0,
    repairOutOther: 0, // lisaks planeeritud töödele (kui vaja)
  },

  energy: {
    heatMonths: DEFAULT_HEAT_MONTHS,
    other: DEFAULT_OTHER_ENERGY,
  },

  confirmation: {
    meetingDate: "",
    meetingPlace: "",
    votesFor: "",
    votesAgainst: "",
    votesAbstain: "",
    protocolNo: "",
    effectiveFrom: "",
    retroactive: "ei",
    retroactiveReason: "",
  },
});

// ------------------------- UI atoms -------------------------
function Section({ title, subtitle, children, right }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Label({ children }) {
  return <div className="mb-1 text-xs font-medium text-slate-700">{children}</div>;
}

function Input({ value, onChange, placeholder, type = "text", className = "", ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-blue-200 focus:ring-2 ${className}`}
      {...rest}
    />
  );
}

function NumberInput({ value, onChange, placeholder, className = "", step = "0.01", ...rest }) {
  return (
    <Input
      type="number"
      step={step}
      value={value}
      onChange={(v) => onChange(v === "" ? "" : num(v))}
      placeholder={placeholder}
      className={className}
      {...rest}
    />
  );
}

function Select({ value, onChange, options, className = "" }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-blue-200 focus:ring-2 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Pill({ tone = "neutral", children }) {
  const map = {
    neutral: "bg-slate-100 text-slate-800 border-slate-200",
    ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
    warn: "bg-amber-50 text-amber-900 border-amber-200",
    bad: "bg-rose-50 text-rose-900 border-rose-200",
    info: "bg-blue-50 text-blue-900 border-blue-200",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${map[tone]}`}>{children}</span>;
}

function Btn({ children, onClick, tone = "primary", disabled = false, className = "" }) {
  const map = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300",
    ghost: "bg-white text-slate-900 hover:bg-slate-50 border border-slate-300 disabled:text-slate-400",
    danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-3 py-2 text-sm font-medium transition ${map[tone]} ${className}`}
      type="button"
    >
      {children}
    </button>
  );
}

// ------------------------- main app -------------------------
export default function MajanduskavaApp() {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return makeInitial();
      const parsed = JSON.parse(raw);
      // lihtne merge: kui tulevikus lisad välju, hoiab defaulti alles
      return { ...makeInitial(), ...parsed };
    } catch {
      return makeInitial();
    }
  });

  const [step, setStep] = useState(0);
  const [savedAt, setSavedAt] = useState(null);
  const saveTimer = useRef(null);

  // autosave (debounce)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
        setSavedAt(new Date());
      } catch {
        // ignore
      }
    }, 350);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [data]);

  const steps = useMemo(
    () => [
      { title: "Maja pass", subtitle: "Ühingu ja maja põhiandmed" },
      { title: "Maja tervis", subtitle: "Seisukord + planeeritud tööd (KrtS § 41 lg 1 p 1)" },
      { title: "Raha plaan", subtitle: "Tulud ja kulud (KrtS § 41 lg 1 p 2)" },
      { title: "Korteriomanike maksed", subtitle: "Jaotus kaasomandi osa järgi (KrtS § 40, § 41 lg 1 p 3)" },
      { title: "Reserv ja remondifond", subtitle: "Fondid + reservi miinimum 1/12 (KrtS § 48; § 41 lg 1 p 4)" },
      { title: "Energia prognoos", subtitle: "Kogused ja hinnad (KrtS § 41 lg 1 p 5)" },
      { title: "Kinnitus", subtitle: "Üldkoosoleku otsuse andmed + väljatrükk" },
    ],
    []
  );

  // ------------------------- derived calculations -------------------------
  const plannedWorksTotal = useMemo(() => sum(data.plannedWorks, (w) => w.cost), [data.plannedWorks]);

  const incomeTotals = useMemo(() => {
    const prev = sum(data.budget.income, (x) => x.prev);
    const plan = sum(data.budget.income, (x) => x.plan);
    return { prev: round2(prev), plan: round2(plan), diff: round2(plan - prev) };
  }, [data.budget.income]);

  const runningTotals = useMemo(() => {
    const prev = sum(data.budget.running, (x) => x.prev);
    const plan = sum(data.budget.running, (x) => x.plan);
    return { prev: round2(prev), plan: round2(plan), diff: round2(plan - prev) };
  }, [data.budget.running]);

  const investTotals = useMemo(() => {
    // plannedWorks rida (invest.plannedWorks) võiks automaatselt peegeldada “Maja tervis” tööde summat
    const mapped = data.budget.invest.map((r) => (r.id === "plannedWorks" ? { ...r, plan: plannedWorksTotal } : r));
    const prev = sum(mapped, (x) => x.prev);
    const plan = sum(mapped, (x) => x.plan);
    return { prev: round2(prev), plan: round2(plan), diff: round2(plan - prev), mapped };
  }, [data.budget.invest, plannedWorksTotal]);

  const budgetResult = useMemo(() => {
    const prev = incomeTotals.prev - runningTotals.prev - investTotals.prev;
    const plan = incomeTotals.plan - runningTotals.plan - investTotals.plan;
    return { prev: round2(prev), plan: round2(plan), diff: round2(plan - prev) };
  }, [incomeTotals, runningTotals, investTotals]);

  const annualCostsPlanned = useMemo(() => round2(runningTotals.plan + investTotals.plan), [runningTotals.plan, investTotals.plan]);
  const reserveMinimum = useMemo(() => round2(annualCostsPlanned / 12), [annualCostsPlanned]);

  const fundsDerived = useMemo(() => {
    const reserveEnd = round2(num(data.funds.reserveStart) + num(data.funds.reserveIn) - num(data.funds.reserveOut));
    // remondifondi kasutus: planeeritud tööd + lisakasutus
    const repairOut = round2(plannedWorksTotal + num(data.funds.repairOutOther));
    const repairEnd = round2(num(data.funds.repairStart) + num(data.funds.repairIn) - repairOut);
    return { reserveEnd, repairOut, repairEnd };
  }, [data.funds, plannedWorksTotal]);

  const shareDiagnostics = useMemo(() => {
    const denom = num(data.building.shareDenom) || 0;
    const sumShares = sum(data.apartments, (a) => a.shareNum);
    const ok = denom > 0 && round2(sumShares) === round2(denom);
    return { denom, sumShares: round2(sumShares), ok };
  }, [data.apartments, data.building.shareDenom]);

  const payments = useMemo(() => {
    const denom = shareDiagnostics.denom;
    if (!denom) return [];

    const monthlyTotal = round2((runningTotals.plan + investTotals.plan) / 12);
    const monthlyRunning = round2(runningTotals.plan / 12);
    const monthlyInvest = round2(investTotals.plan / 12);

    return data.apartments.map((a) => {
      const shareNum = num(a.shareNum);
      const share = denom ? shareNum / denom : 0;
      const yearTotal = round2((runningTotals.plan + investTotals.plan) * share);
      const monthTotal = round2(monthlyTotal * share);
      const monthRun = round2(monthlyRunning * share);
      const monthInvest = round2(monthlyInvest * share);

      return {
        ...a,
        sharePct: share * 100,
        yearTotal,
        monthTotal,
        monthRun,
        monthInvest,
      };
    });
  }, [data.apartments, shareDiagnostics.denom, runningTotals.plan, investTotals.plan]);

  const energyDerived = useMemo(() => {
    const heatRows = data.energy.heatMonths.map((r) => {
      const cost = round2(num(r.qtyMWh) * num(r.pricePerMWh));
      const change = round2(cost - num(r.prevCost));
      return { ...r, cost, change };
    });
    const heatTotal = round2(sum(heatRows, (r) => r.cost));
    const heatPrevTotal = round2(sum(heatRows, (r) => r.prevCost));
    const heatChange = round2(heatTotal - heatPrevTotal);

    const otherRows = data.energy.other.map((r) => {
      const cost = round2(num(r.qty) * num(r.price));
      const change = round2(cost - num(r.prevCost));
      return { ...r, cost, change };
    });
    const otherTotal = round2(sum(otherRows, (r) => r.cost));
    const otherPrevTotal = round2(sum(otherRows, (r) => r.prevCost));
    const otherChange = round2(otherTotal - otherPrevTotal);

    return { heatRows, heatTotal, heatPrevTotal, heatChange, otherRows, otherTotal, otherPrevTotal, otherChange };
  }, [data.energy]);

  // ------------------------- validation -------------------------
  const errors = useMemo(() => {
    const e = {};

    // Step 0: meta/building
    if (!data.meta.name.trim()) e.meta_name = "Palun sisesta korteriühistu nimi.";
    if (!data.meta.regCode.trim()) e.meta_reg = "Palun sisesta registrikood.";
    if (!data.meta.address.trim()) e.meta_addr = "Palun sisesta aadress.";
    if (!data.meta.meetingDate.trim()) e.meta_meeting = "Palun sisesta üldkoosoleku kuupäev (või plaanitav kuupäev).";
    if (num(data.building.shareDenom) <= 0) e.build_denom = "Kaasomandi osade koguarv (nimetaja) peab olema > 0.";

    // Step 3: shares
    if (!shareDiagnostics.ok) {
      e.shares_sum = `Kaasomandi osade summa peab võrduma nimetajaga. Hetkel: summa ${shareDiagnostics.sumShares}, nimetaja ${shareDiagnostics.denom}.`;
    }

    // Step 4: reserve minimum check (informatiivne, mitte blokeeriv)
    const reserveEnd = fundsDerived.reserveEnd;
    if (reserveEnd + 1e-9 < reserveMinimum) {
      e.reserve_min = `Hoiatus: reservkapital perioodi lõpus (${euro(reserveEnd)}) on väiksem kui seaduslik miinimum 1/12 aasta kuludest (${euro(reserveMinimum)}).`;
    }

    // Step 6: confirmation
    // (mitte blokeeriv: SaaS-is võib lubada mustandina)
    return e;
  }, [data, shareDiagnostics, fundsDerived.reserveEnd, reserveMinimum]);

  const stepHasBlockingErrors = (s) => {
    // blokeerime vaid “Maja pass” ja “Maksed” kriitilised vead
    if (s === 0) return Boolean(errors.meta_name || errors.meta_reg || errors.meta_addr || errors.meta_meeting || errors.build_denom);
    if (s === 3) return Boolean(errors.shares_sum);
    return false;
  };

  // ------------------------- handlers -------------------------
  const update = (path, value) => {
    // path: "meta.name" jne
    setData((prev) => {
      const copy = structuredClone(prev);
      const keys = path.split(".");
      let cur = copy;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return copy;
    });
  };

  const updateRow = (pathToArray, id, patch) => {
    setData((prev) => {
      const copy = structuredClone(prev);
      const keys = pathToArray.split(".");
      let cur = copy;
      for (const k of keys) cur = cur[k];
      const idx = cur.findIndex((x) => x.id === id);
      if (idx >= 0) cur[idx] = { ...cur[idx], ...patch };
      return copy;
    });
  };

  const addRow = (pathToArray, row) => {
    setData((prev) => {
      const copy = structuredClone(prev);
      const keys = pathToArray.split(".");
      let cur = copy;
      for (const k of keys) cur = cur[k];
      cur.push(row);
      return copy;
    });
  };

  const removeRow = (pathToArray, id) => {
    setData((prev) => {
      const copy = structuredClone(prev);
      const keys = pathToArray.split(".");
      let cur = copy;
      for (const k of keys) cur = cur[k];
      const next = cur.filter((x) => x.id !== id);
      // kirjutame tagasi
      const parentKeys = keys.slice(0, -1);
      let parent = copy;
      for (const k of parentKeys) parent = parent[k];
      parent[keys[keys.length - 1]] = next;
      return copy;
    });
  };

  const resetAll = () => {
    if (!confirm("Kas lähtestan kogu majanduskava? (salvestus kustub)")) return;
    localStorage.removeItem(LS_KEY);
    setData(makeInitial());
    setStep(0);
  };

  const printPdf = () => {
    window.print();
  };

  // ------------------------- render -------------------------
  const toneForResult = (n) => {
    if (n > 0.009) return "ok";
    if (n < -0.009) return "bad";
    return "warn";
  };

  const topBadges = (
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone="info">KrtS § 41 vorm • dünaamiline</Pill>
      <Pill tone={toneForResult(budgetResult.plan)}>Tulemus (plaan): {euro(budgetResult.plan)}</Pill>
      <Pill tone={fundsDerived.reserveEnd + 1e-9 < reserveMinimum ? "warn" : "ok"}>
        Reserv lõpus: {euro(fundsDerived.reserveEnd)} • miin {euro(reserveMinimum)}
      </Pill>
      <Pill tone={shareDiagnostics.ok ? "ok" : "warn"}>
        Osakaalud: {shareDiagnostics.sumShares}/{shareDiagnostics.denom}
      </Pill>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .page { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <div className="text-sm font-semibold text-blue-700">Solvere Lab • Majanduskava</div>
            <div className="text-xs text-slate-600">
              Lihtne täita. Arvutab ise. Vastab KrtS § 41 lg 1 p 1–5 loogikale.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Btn tone="ghost" onClick={printPdf}>Prindi / salvesta PDF</Btn>
            <Btn tone="ghost" onClick={resetAll}>Lähtesta</Btn>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-6 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <div className="no-print space-y-3">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">Navigeerimine</div>
            <div className="mt-1 text-xs text-slate-600">Sammud 1–7</div>

            <div className="mt-4 space-y-1">
              {steps.map((s, i) => {
                const active = i === step;
                const blocked = stepHasBlockingErrors(i);
                return (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => setStep(i)}
                    className={`flex w-full items-start justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
                      active ? "bg-blue-50 text-blue-900 ring-1 ring-blue-200" : "hover:bg-slate-50"
                    }`}
                  >
                    <span>
                      <div className="font-medium">{i + 1}. {s.title}</div>
                      <div className="text-xs text-slate-600">{s.subtitle}</div>
                    </span>
                    {blocked ? <Pill tone="warn">vajab</Pill> : <span className="text-slate-300">›</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">Kiirseis</div>
            <div className="mt-3">{topBadges}</div>
            <div className="mt-3 text-xs text-slate-600">
              {savedAt ? `Autosave: ${savedAt.toLocaleTimeString("et-EE")}` : "Autosave: —"}
            </div>
          </div>

          {errors.reserve_min ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-semibold">Hoiatus</div>
              <div className="mt-1">{errors.reserve_min}</div>
            </div>
          ) : null}
        </div>

        {/* Main */}
        <div className="space-y-4">
          <div className="no-print flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">{steps[step].title}</h1>
              <p className="text-sm text-slate-600">{steps[step].subtitle}</p>
            </div>

            <div className="flex items-center gap-2">
              <Btn tone="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                Tagasi
              </Btn>
              <Btn
                onClick={() => {
                  if (stepHasBlockingErrors(step)) return;
                  setStep((s) => Math.min(steps.length - 1, s + 1));
                }}
                disabled={step === steps.length - 1 || stepHasBlockingErrors(step)}
              >
                Edasi
              </Btn>
            </div>
          </div>

          {step === 0 && (
            <PagePass data={data} update={update} errors={errors} />
          )}

          {step === 1 && (
            <PageHealth
              data={data}
              updateRow={updateRow}
              addRow={addRow}
              removeRow={removeRow}
              update={update}
              plannedWorksTotal={plannedWorksTotal}
            />
          )}

          {step === 2 && (
            <PageBudget
              data={data}
              updateRow={updateRow}
              plannedWorksTotal={plannedWorksTotal}
              incomeTotals={incomeTotals}
              runningTotals={runningTotals}
              investTotals={investTotals}
              budgetResult={budgetResult}
            />
          )}

          {step === 3 && (
            <PagePayments
              data={data}
              updateRow={updateRow}
              addRow={addRow}
              removeRow={removeRow}
              shareDiagnostics={shareDiagnostics}
              payments={payments}
              runningTotals={runningTotals}
              investTotals={investTotals}
              errors={errors}
            />
          )}

          {step === 4 && (
            <PageFunds
              data={data}
              update={update}
              plannedWorksTotal={plannedWorksTotal}
              annualCostsPlanned={annualCostsPlanned}
              reserveMinimum={reserveMinimum}
              fundsDerived={fundsDerived}
              errors={errors}
            />
          )}

          {step === 5 && (
            <PageEnergy data={data} updateRow={updateRow} energyDerived={energyDerived} />
          )}

          {step === 6 && (
            <PageConfirm
              data={data}
              update={update}
              incomeTotals={incomeTotals}
              runningTotals={runningTotals}
              investTotals={investTotals}
              budgetResult={budgetResult}
              shareDiagnostics={shareDiagnostics}
              fundsDerived={fundsDerived}
              reserveMinimum={reserveMinimum}
              energyDerived={energyDerived}
              printPdf={printPdf}
            />
          )}

          {/* Print-only summary */}
          <div className="print-only hidden">
            <PrintSummary
              data={data}
              plannedWorksTotal={plannedWorksTotal}
              incomeTotals={incomeTotals}
              runningTotals={runningTotals}
              investTotals={investTotals}
              budgetResult={budgetResult}
              shareDiagnostics={shareDiagnostics}
              fundsDerived={fundsDerived}
              reserveMinimum={reserveMinimum}
              energyDerived={energyDerived}
              payments={payments}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------- Pages -------------------------
function PagePass({ data, update, errors }) {
  return (
    <div className="space-y-4">
      <Section
        title="A. Korteriühistu andmed"
        subtitle="Sisesta põhiandmed. Need lähevad majanduskava päisesse."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Korteriühistu nimi</Label>
            <Input value={data.meta.name} onChange={(v) => update("meta.name", v)} placeholder="nt KÜ Päikese 12" />
            {errors.meta_name ? <div className="mt-1 text-xs text-rose-600">{errors.meta_name}</div> : null}
          </div>
          <div>
            <Label>Registrikood</Label>
            <Input value={data.meta.regCode} onChange={(v) => update("meta.regCode", v)} placeholder="nt 12345678" />
            {errors.meta_reg ? <div className="mt-1 text-xs text-rose-600">{errors.meta_reg}</div> : null}
          </div>
          <div className="md:col-span-2">
            <Label>Aadress</Label>
            <Input value={data.meta.address} onChange={(v) => update("meta.address", v)} placeholder="nt Päikese tn 12, Tallinn" />
            {errors.meta_addr ? <div className="mt-1 text-xs text-rose-600">{errors.meta_addr}</div> : null}
          </div>
          <div className="md:col-span-2">
            <Label>Juhatuse liige (nimi + kontakt)</Label>
            <Input value={data.meta.board} onChange={(v) => update("meta.board", v)} placeholder="nt Ilona, tel 5xxx xxxx, email ..." />
          </div>
        </div>
      </Section>

      <Section title="B. Majandusaasta" subtitle="Millise perioodi kohta kava kehtib?">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label>Majandusaasta (aasta)</Label>
            <NumberInput value={data.meta.year} onChange={(v) => update("meta.year", clampNonNeg(v))} step="1" />
          </div>
          <div>
            <Label>Periood algus</Label>
            <Input value={data.meta.periodStart} onChange={(v) => update("meta.periodStart", v)} placeholder="pp.kk.aaaa" />
          </div>
          <div>
            <Label>Periood lõpp</Label>
            <Input value={data.meta.periodEnd} onChange={(v) => update("meta.periodEnd", v)} placeholder="pp.kk.aaaa" />
          </div>
          <div>
            <Label>Üldkoosoleku kuupäev</Label>
            <Input value={data.meta.meetingDate} onChange={(v) => update("meta.meetingDate", v)} placeholder="pp.kk.aaaa" />
            {errors.meta_meeting ? <div className="mt-1 text-xs text-rose-600">{errors.meta_meeting}</div> : null}
          </div>

          <div className="md:col-span-2">
            <Label>Protokolli number</Label>
            <Input value={data.meta.protocolNo} onChange={(v) => update("meta.protocolNo", v)} placeholder="nt 3-2026" />
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-semibold">Õiguslik info (automaatne märkus)</div>
          <ul className="mt-1 list-disc pl-5">
            <li>Majanduskava kujutab korteriühistu eelarvet KrtS § 41 lg 1 p-de 1–5 tähenduses.</li>
            <li>Kehtestab üldkoosolek lihthäälteenamusega (KrtS §§ 35, 41 lg 3).</li>
            <li>Kui uut kava ei kehtestata, kehtib eelmine kava (KrtS § 41 lg 5).</li>
          </ul>
        </div>
      </Section>

      <Section title="C. Korteriomandite ülevaade" subtitle="Need numbrid aitavad arvutada korteriomanike maksed.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label>Korterite arv</Label>
            <NumberInput value={data.building.aptCount} onChange={(v) => update("building.aptCount", clampNonNeg(v))} step="1" />
          </div>
          <div>
            <Label>Kaasomandi osade koguarv (nimetaja)</Label>
            <NumberInput value={data.building.shareDenom} onChange={(v) => update("building.shareDenom", clampNonNeg(v))} step="1" />
            {errors.build_denom ? <div className="mt-1 text-xs text-rose-600">{errors.build_denom}</div> : null}
          </div>
          <div>
            <Label>Korterite koguüldpind (m²)</Label>
            <NumberInput value={data.building.totalArea} onChange={(v) => update("building.totalArea", clampNonNeg(v))} />
          </div>
          <div>
            <Label>Elamu ehitusaasta</Label>
            <Input value={data.building.buildYear} onChange={(v) => update("building.buildYear", v)} placeholder="nt 1986" />
          </div>
          <div>
            <Label>Korruselisus</Label>
            <Input value={data.building.floors} onChange={(v) => update("building.floors", v)} placeholder="nt 5" />
          </div>
        </div>
      </Section>
    </div>
  );
}

function PageHealth({ data, updateRow, addRow, removeRow, update, plannedWorksTotal }) {
  const statusOptions = [
    { value: "hea", label: "🟢 Hea" },
    { value: "jalgida", label: "🟡 Vajab jälgimist" },
    { value: "halb", label: "🔴 Vajab remonti" },
  ];

  const typeOptions = [
    { value: "hooldus", label: "Hooldus" },
    { value: "remont", label: "Remont" },
    { value: "uuendus", label: "Uuendus" },
  ];

  const fundingOptions = [
    { value: "jooksev", label: "Jooksev eelarve" },
    { value: "remondifond", label: "Remondifond" },
    { value: "reserv", label: "Reservkapital" },
    { value: "laen", label: "Laen" },
    { value: "toetus", label: "Toetus" },
  ];

  return (
    <div className="space-y-4">
      <Section title="I. Hoone üldseisukord" subtitle="Vali seisukord. Kui tahad, lisa ka kuupäev ja märkus.">
        <div className="space-y-3">
          {data.condition.map((row) => (
            <div key={row.id} className="rounded-2xl border p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div className="md:col-span-2">
                  <Label>Hoone osa / süsteem</Label>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">{row.label}</div>
                </div>
                <div>
                  <Label>Seisukord</Label>
                  <Select value={row.status} onChange={(v) => updateRow("condition", row.id, { status: v })} options={statusOptions} />
                </div>
                <div>
                  <Label>Viimane ülevaatus</Label>
                  <Input value={row.last} onChange={(v) => updateRow("condition", row.id, { last: v })} placeholder="kk.aaaa" />
                </div>
                <div>
                  <Label>Järgmine ülevaatus</Label>
                  <Input value={row.next} onChange={(v) => updateRow("condition", row.id, { next: v })} placeholder="kk.aaaa" />
                </div>
                <div className="md:col-span-5">
                  <Label>Märkused</Label>
                  <Input value={row.notes} onChange={(v) => updateRow("condition", row.id, { notes: v })} placeholder="nt pragusid ei tähelda / vaja tellida audit ..." />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="II. Planeeritud tööd ja toimingud"
        subtitle="Kirjuta tööd lihtsas keeles. Lisa ligikaudne maksumus."
        right={<Pill tone="info">Kokku: {euro(plannedWorksTotal)}</Pill>}
      >
        <div className="space-y-3">
          {data.plannedWorks.map((w) => (
            <div key={w.id} className="rounded-2xl border p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="md:col-span-2">
                  <Label>Töö kirjeldus</Label>
                  <Input value={w.desc} onChange={(v) => updateRow("plannedWorks", w.id, { desc: v })} placeholder="nt Trepikoja värvimine" />
                </div>
                <div>
                  <Label>Liik</Label>
                  <Select value={w.type} onChange={(v) => updateRow("plannedWorks", w.id, { type: v })} options={typeOptions} />
                </div>
                <div>
                  <Label>Aeg</Label>
                  <Input value={w.period} onChange={(v) => updateRow("plannedWorks", w.id, { period: v })} placeholder="nt 04.2026–05.2026" />
                </div>
                <div>
                  <Label>Maksumus (€)</Label>
                  <NumberInput value={w.cost} onChange={(v) => updateRow("plannedWorks", w.id, { cost: clampNonNeg(v) })} />
                </div>
                <div>
                  <Label>Raha tuleb</Label>
                  <Select value={w.funding} onChange={(v) => updateRow("plannedWorks", w.id, { funding: v })} options={fundingOptions} />
                </div>
                <div className="flex items-end">
                  <Btn tone="danger" onClick={() => removeRow("plannedWorks", w.id)} className="w-full">
                    Kustuta
                  </Btn>
                </div>
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <Btn
              tone="ghost"
              onClick={() =>
                addRow("plannedWorks", { id: uid(), desc: "", type: "remont", period: "", cost: 0, funding: "remondifond" })
              }
            >
              + Lisa töö
            </Btn>
          </div>
        </div>

        <div className="mt-4">
          <Label>Täiendavad märkused / selgitused</Label>
          <textarea
            value={data.notes.worksNotes}
            onChange={(e) => update("notes.worksNotes", e.target.value)}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2"
            rows={4}
            placeholder="Kirjelda täpsemalt: probleemid, pooleli tööd, riskid, prioriteedid..."
          />
        </div>
      </Section>
    </div>
  );
}

function BudgetTable({ title, rows, onChangeRow, totals, lockPlanId, lockPlanValue }) {
  return (
    <Section
      title={title}
      right={<Pill tone="info">Plaan kokku: {euro(totals.plan)}</Pill>}
    >
      <div className="overflow-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="text-left text-xs text-slate-600">
            <tr>
              <th className="py-2 pr-3">Rida</th>
              <th className="py-2 pr-3">Eelmine aasta tegelik</th>
              <th className="py-2 pr-3">Kavandatav</th>
              <th className="py-2 pr-3">Muutus</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const planLocked = lockPlanId && r.id === lockPlanId;
              const planValue = planLocked ? lockPlanValue : r.plan;
              const d = diff(planValue, r.prev);

              return (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.label}</div>
                    {r.group ? <div className="text-xs text-slate-500">{r.group}</div> : null}
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.prev} onChange={(v) => onChangeRow(r.id, { prev: clampNonNeg(v) })} />
                  </td>
                  <td className="py-2 pr-3">
                    {planLocked ? (
                      <div className="rounded-xl bg-slate-50 px-3 py-2">{euro(planValue)}</div>
                    ) : (
                      <NumberInput value={r.plan} onChange={(v) => onChangeRow(r.id, { plan: clampNonNeg(v) })} />
                    )}
                    {planLocked ? <div className="mt-1 text-xs text-slate-500">Võetakse automaatselt “Maja tervis” töödest.</div> : null}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-medium">{euro(d)}</div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t bg-slate-50">
              <td className="py-2 pr-3 font-semibold">KOKKU</td>
              <td className="py-2 pr-3 font-semibold">{euro(totals.prev)}</td>
              <td className="py-2 pr-3 font-semibold">{euro(totals.plan)}</td>
              <td className="py-2 pr-3 font-semibold">{euro(totals.diff)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function PageBudget({ data, updateRow, plannedWorksTotal, incomeTotals, runningTotals, investTotals, budgetResult }) {
  const investRows = investTotals.mapped;

  const onIncome = (id, patch) => updateRow("budget.income", id, patch);
  const onRunning = (id, patch) => updateRow("budget.running", id, patch);
  const onInvest = (id, patch) => updateRow("budget.invest", id, patch);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Eelarve kokkuvõte</div>
          <div className="flex flex-wrap gap-2">
            <Pill tone="info">Tulud: {euro(incomeTotals.plan)}</Pill>
            <Pill tone="info">Jooksvad kulud: {euro(runningTotals.plan)}</Pill>
            <Pill tone="info">Investeeringud: {euro(investTotals.plan)}</Pill>
            <Pill tone={budgetResult.plan > 0 ? "ok" : budgetResult.plan < 0 ? "bad" : "warn"}>
              Tulemus: {euro(budgetResult.plan)}
            </Pill>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-600">
          🟦 sisesta sina • ⚫ arvutab süsteem • Investeeringute real “Remondifondi tööd” tuleb automaatselt planeeritud tööde summast ({euro(plannedWorksTotal)}).
        </div>
      </div>

      <BudgetTable title="A. Tulud (KrtS § 41 lg 1 p 2)" rows={data.budget.income} onChangeRow={onIncome} totals={incomeTotals} />

      <BudgetTable title="B. Jooksvad majandamiskulud" rows={data.budget.running} onChangeRow={onRunning} totals={runningTotals} />

      <BudgetTable
        title="C. Remondi- ja investeerimiskulud"
        rows={investRows}
        onChangeRow={onInvest}
        totals={{ prev: investTotals.prev, plan: investTotals.plan, diff: investTotals.diff }}
        lockPlanId="plannedWorks"
        lockPlanValue={plannedWorksTotal}
      />

      <Section title="D. Tulemi selgitus" subtitle="Tulemus = Tulud – Jooksvad kulud – Investeeringud">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Tulud (plaan)</div>
            <div className="text-lg font-semibold">{euro(incomeTotals.plan)}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Kulud (plaan)</div>
            <div className="text-lg font-semibold">{euro(runningTotals.plan + investTotals.plan)}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Tulemus (plaan)</div>
            <div className="text-lg font-semibold">{euro(budgetResult.plan)}</div>
            <div className="mt-1">
              <Pill tone={budgetResult.plan > 0 ? "ok" : budgetResult.plan < 0 ? "bad" : "warn"}>
                {budgetResult.plan > 0 ? "Ülejääk" : budgetResult.plan < 0 ? "Puudujääk" : "Tasakaalus"}
              </Pill>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function PagePayments({ data, updateRow, addRow, removeRow, shareDiagnostics, payments, runningTotals, investTotals, errors }) {
  const monthlyRunning = round2(runningTotals.plan / 12);
  const monthlyInvest = round2(investTotals.plan / 12);

  return (
    <div className="space-y-4">
      <Section title="A. Kulu kokkuvõte" subtitle="Need summad jaotatakse korteriomanike vahel kaasomandi osa järgi (KrtS § 40 lg 1).">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Jooksvad kulud / kuu</div>
            <div className="text-lg font-semibold">{euro(monthlyRunning)}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Investeeringud / kuu</div>
            <div className="text-lg font-semibold">{euro(monthlyInvest)}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Kokku / kuu</div>
            <div className="text-lg font-semibold">{euro(monthlyRunning + monthlyInvest)}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone={shareDiagnostics.ok ? "ok" : "warn"}>
            Osakaalude kontroll: summa {shareDiagnostics.sumShares} / nimetaja {shareDiagnostics.denom}
          </Pill>
          {!shareDiagnostics.ok ? <Pill tone="warn">Paranda osakaalud, muidu makseid ei saa õigesti arvutada.</Pill> : null}
        </div>

        {errors.shares_sum ? <div className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{errors.shares_sum}</div> : null}
      </Section>

      <Section
        title="B. Korteriomandid ja maksed"
        subtitle="Lisa kõik korterid (või impordi hiljem). Kaasomandi osa: lugeja / nimetaja."
        right={
          <Btn
            tone="ghost"
            onClick={() => addRow("apartments", { id: uid(), unit: `Korter ${data.apartments.length + 1}`, owner: "", shareNum: 0 })}
          >
            + Lisa korter
          </Btn>
        }
      >
        <div className="overflow-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Korteriomand / omanik</th>
                <th className="py-2 pr-3">Kaasomandi osa (lugeja)</th>
                <th className="py-2 pr-3">Osakaal</th>
                <th className="py-2 pr-3">Aastas</th>
                <th className="py-2 pr-3">Kuus</th>
                <th className="py-2 pr-3">sh jooksev / kuu</th>
                <th className="py-2 pr-3">sh invest / kuu</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-2 pr-3">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <Input value={p.unit} onChange={(v) => updateRow("apartments", p.id, { unit: v })} placeholder="nt Korter 12" />
                      <Input value={p.owner} onChange={(v) => updateRow("apartments", p.id, { owner: v })} placeholder="Omanik (valikuline)" />
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={p.shareNum} onChange={(v) => updateRow("apartments", p.id, { shareNum: clampNonNeg(v) })} step="1" />
                    <div className="mt-1 text-xs text-slate-500">/ {shareDiagnostics.denom}</div>
                  </td>
                  <td className="py-2 pr-3 font-medium">{pct(p.sharePct, 3)}</td>
                  <td className="py-2 pr-3 font-medium">{euro(p.yearTotal)}</td>
                  <td className="py-2 pr-3 font-medium">{euro(p.monthTotal)}</td>
                  <td className="py-2 pr-3">{euro(p.monthRun)}</td>
                  <td className="py-2 pr-3">{euro(p.monthInvest)}</td>
                  <td className="py-2 pr-3">
                    <Btn tone="danger" onClick={() => removeRow("apartments", p.id)}>Kustuta</Btn>
                  </td>
                </tr>
              ))}

              <tr className="border-t bg-slate-50">
                <td className="py-2 pr-3 font-semibold">KOKKU</td>
                <td className="py-2 pr-3 font-semibold">{shareDiagnostics.sumShares} / {shareDiagnostics.denom}</td>
                <td className="py-2 pr-3 font-semibold">{shareDiagnostics.ok ? "100%" : "—"}</td>
                <td className="py-2 pr-3 font-semibold">{euro(sum(payments, (x) => x.yearTotal))}</td>
                <td className="py-2 pr-3 font-semibold">{euro(sum(payments, (x) => x.monthTotal))}</td>
                <td className="py-2 pr-3 font-semibold">{euro(sum(payments, (x) => x.monthRun))}</td>
                <td className="py-2 pr-3 font-semibold">{euro(sum(payments, (x) => x.monthInvest))}</td>
                <td className="py-2 pr-3"></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-semibold">Õiguslik märkus</div>
          <div className="mt-1">
            KrtS § 40 lg 1: korteriomanikud teevad perioodilisi ettemakseid vastavalt oma kaasomandi osa suurusele.
            Erinev jaotus on lubatud ainult põhikirja alusel (KrtS § 40 lg 2).
          </div>
        </div>
      </Section>
    </div>
  );
}

function PageFunds({ data, update, plannedWorksTotal, annualCostsPlanned, reserveMinimum, fundsDerived, errors }) {
  return (
    <div className="space-y-4">
      <Section title="A. Reservkapital (KrtS § 48)" subtitle="Reserv peab olema vähemalt 1/12 aasta eeldatavatest kuludest.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label>Algjääk</Label>
            <NumberInput value={data.funds.reserveStart} onChange={(v) => update("funds.reserveStart", clampNonNeg(v))} />
          </div>
          <div>
            <Label>Laekumised</Label>
            <NumberInput value={data.funds.reserveIn} onChange={(v) => update("funds.reserveIn", clampNonNeg(v))} />
          </div>
          <div>
            <Label>Kasutamine</Label>
            <NumberInput value={data.funds.reserveOut} onChange={(v) => update("funds.reserveOut", clampNonNeg(v))} />
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Lõppjääk (eeldatav)</div>
            <div className="text-lg font-semibold">{euro(fundsDerived.reserveEnd)}</div>
            <div className="mt-1 text-xs text-slate-600">Miinimum: {euro(reserveMinimum)}</div>
            {errors.reserve_min ? <div className="mt-2 text-xs text-amber-800">{errors.reserve_min}</div> : <Pill tone="ok">OK</Pill>}
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          Aasta eeldatavad kulud (plaan): <b>{euro(annualCostsPlanned)}</b> → seaduslik miinimum 1/12: <b>{euro(reserveMinimum)}</b>.
        </div>
      </Section>

      <Section title="B. Remondifond" subtitle="Remondifondist kaetakse planeeritud tööd (ja muud remondikulud, kui lisad).">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <Label>Algjääk</Label>
            <NumberInput value={data.funds.repairStart} onChange={(v) => update("funds.repairStart", clampNonNeg(v))} />
          </div>
          <div>
            <Label>Laekumised</Label>
            <NumberInput value={data.funds.repairIn} onChange={(v) => update("funds.repairIn", clampNonNeg(v))} />
          </div>
          <div>
            <Label>Planeeritud tööd (automaatne)</Label>
            <div className="rounded-xl bg-slate-50 px-3 py-2">{euro(plannedWorksTotal)}</div>
            <div className="mt-1 text-xs text-slate-500">Võetakse “Maja tervis” töödest.</div>
          </div>
          <div>
            <Label>Muu kasutamine (valikuline)</Label>
            <NumberInput value={data.funds.repairOutOther} onChange={(v) => update("funds.repairOutOther", clampNonNeg(v))} />
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Lõppjääk (eeldatav)</div>
            <div className="text-lg font-semibold">{euro(fundsDerived.repairEnd)}</div>
            <div className="mt-1 text-xs text-slate-600">Kasutus kokku: {euro(fundsDerived.repairOut)}</div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function PageEnergy({ data, updateRow, energyDerived }) {
  return (
    <div className="space-y-4">
      <Section
        title="A. Soojusenergia (kuude kaupa)"
        subtitle="Sisesta prognoositav kogus (MWh) ja ühikuhind (€/MWh). Maksumus arvutatakse automaatselt."
        right={<Pill tone="info">Aasta kokku: {euro(energyDerived.heatTotal)}</Pill>}
      >
        <div className="overflow-auto">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Kuu</th>
                <th className="py-2 pr-3">Kogus (MWh)</th>
                <th className="py-2 pr-3">Hind (€/MWh)</th>
                <th className="py-2 pr-3">Maksumus (auto)</th>
                <th className="py-2 pr-3">Eelmine aasta (€)</th>
                <th className="py-2 pr-3">Muutus</th>
              </tr>
            </thead>
            <tbody>
              {energyDerived.heatRows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3 font-medium">{r.month}</td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.qtyMWh} onChange={(v) => updateRow("energy.heatMonths", r.id, { qtyMWh: clampNonNeg(v) })} />
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.pricePerMWh} onChange={(v) => updateRow("energy.heatMonths", r.id, { pricePerMWh: clampNonNeg(v) })} />
                  </td>
                  <td className="py-2 pr-3 font-medium">{euro(r.cost)}</td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.prevCost} onChange={(v) => updateRow("energy.heatMonths", r.id, { prevCost: clampNonNeg(v) })} />
                  </td>
                  <td className="py-2 pr-3">{euro(r.change)}</td>
                </tr>
              ))}
              <tr className="border-t bg-slate-50">
                <td className="py-2 pr-3 font-semibold">KOKKU</td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3 font-semibold">{euro(energyDerived.heatTotal)}</td>
                <td className="py-2 pr-3 font-semibold">{euro(energyDerived.heatPrevTotal)}</td>
                <td className="py-2 pr-3 font-semibold">{euro(energyDerived.heatChange)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="B. Muud energialiigid ja teenused (aastane)"
        subtitle="Sisesta kogus ja ühikuhind. Maksumus arvutatakse automaatselt."
        right={<Pill tone="info">Aasta kokku: {euro(energyDerived.otherTotal)}</Pill>}
      >
        <div className="overflow-auto">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Teenuse nimetus</th>
                <th className="py-2 pr-3">Ühik</th>
                <th className="py-2 pr-3">Kogus</th>
                <th className="py-2 pr-3">Hind</th>
                <th className="py-2 pr-3">Maksumus (auto)</th>
                <th className="py-2 pr-3">Eelmine aasta (€)</th>
                <th className="py-2 pr-3">Muutus</th>
              </tr>
            </thead>
            <tbody>
              {energyDerived.otherRows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3 font-medium">{r.label}</td>
                  <td className="py-2 pr-3">{r.unit}</td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.qty} onChange={(v) => updateRow("energy.other", r.id, { qty: clampNonNeg(v) })} />
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.price} onChange={(v) => updateRow("energy.other", r.id, { price: clampNonNeg(v) })} />
                  </td>
                  <td className="py-2 pr-3 font-medium">{euro(r.cost)}</td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.prevCost} onChange={(v) => updateRow("energy.other", r.id, { prevCost: clampNonNeg(v) })} />
                  </td>
                  <td className="py-2 pr-3">{euro(r.change)}</td>
                </tr>
              ))}
              <tr className="border-t bg-slate-50">
                <td className="py-2 pr-3 font-semibold">KOKKU</td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3 font-semibold">{euro(energyDerived.otherTotal)}</td>
                <td className="py-2 pr-3 font-semibold">{euro(energyDerived.otherPrevTotal)}</td>
                <td className="py-2 pr-3 font-semibold">{euro(energyDerived.otherChange)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function PageConfirm({
  data,
  update,
  incomeTotals,
  runningTotals,
  investTotals,
  budgetResult,
  shareDiagnostics,
  fundsDerived,
  reserveMinimum,
  energyDerived,
  printPdf,
}) {
  const retro = data.confirmation.retroactive === "jah";

  return (
    <div className="space-y-4">
      <Section
        title="Majanduskava kinnitusleht"
        subtitle="Täida pärast üldkoosoleku otsust (või jäta mustandina)."
        right={<Btn onClick={printPdf}>Prindi / salvesta PDF</Btn>}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label>Koosoleku kuupäev</Label>
            <Input value={data.confirmation.meetingDate} onChange={(v) => update("confirmation.meetingDate", v)} placeholder="pp.kk.aaaa" />
          </div>
          <div className="md:col-span-2">
            <Label>Koosoleku koht (aadress / videolink)</Label>
            <Input value={data.confirmation.meetingPlace} onChange={(v) => update("confirmation.meetingPlace", v)} placeholder="..." />
          </div>

          <div>
            <Label>Hääled poolt</Label>
            <Input value={data.confirmation.votesFor} onChange={(v) => update("confirmation.votesFor", v)} placeholder="arv" />
          </div>
          <div>
            <Label>Hääled vastu</Label>
            <Input value={data.confirmation.votesAgainst} onChange={(v) => update("confirmation.votesAgainst", v)} placeholder="arv" />
          </div>
          <div>
            <Label>Erapooletu</Label>
            <Input value={data.confirmation.votesAbstain} onChange={(v) => update("confirmation.votesAbstain", v)} placeholder="arv" />
          </div>

          <div>
            <Label>Otsus protokollitud nr</Label>
            <Input value={data.confirmation.protocolNo} onChange={(v) => update("confirmation.protocolNo", v)} placeholder="..." />
          </div>
          <div>
            <Label>Kehtima hakkamise kuupäev</Label>
            <Input value={data.confirmation.effectiveFrom} onChange={(v) => update("confirmation.effectiveFrom", v)} placeholder="pp.kk.aaaa" />
          </div>
          <div>
            <Label>Kas tagasiulatuvalt?</Label>
            <Select
              value={data.confirmation.retroactive}
              onChange={(v) => update("confirmation.retroactive", v)}
              options={[
                { value: "ei", label: "Ei" },
                { value: "jah", label: "Jah" },
              ]}
            />
          </div>
          {retro ? (
            <div className="md:col-span-3">
              <Label>Tagasiulatuva kehtestamise alus (kui jah)</Label>
              <Input value={data.confirmation.retroactiveReason} onChange={(v) => update("confirmation.retroactiveReason", v)} placeholder="Põhjendus..." />
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-semibold">Õiguslik viide (kuvatakse kinnituslehel)</div>
          <ul className="mt-1 list-disc pl-5">
            <li>Majanduskava kehtestab üldkoosolek häälteenamusega tavapärase valitsemise raames (KrtS §§ 35 lg 1, 41 lg 3).</li>
            <li>Kindla suurusega perioodiliste maksete puhul võib ühistu nõuda ka tulevikus sissenõutavaks muutuvate maksete täitmist (TsMS § 369).</li>
            <li>Tagasiulatuvalt kehtestamisel muutuvad nõuded sissenõutavaks kõige varem otsuse tegemise kuupäevast (VÕS § 82 lg 7).</li>
          </ul>
        </div>
      </Section>

      <Section title="Kiirülevaade (enne printi)" subtitle="Kontrolli, kas kõik põhisummad ja jaotused näevad loogilised välja.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Mini label="Tulud (plaan)" value={euro(incomeTotals.plan)} />
          <Mini label="Jooksvad kulud (plaan)" value={euro(runningTotals.plan)} />
          <Mini label="Investeeringud (plaan)" value={euro(investTotals.plan)} />
          <Mini label="Tulemus (plaan)" value={euro(budgetResult.plan)} tone={budgetResult.plan > 0 ? "ok" : budgetResult.plan < 0 ? "bad" : "warn"} />
          <Mini label="Reserv lõpus" value={euro(fundsDerived.reserveEnd)} tone={fundsDerived.reserveEnd + 1e-9 < reserveMinimum ? "warn" : "ok"} />
          <Mini label="Reserv miinimum (1/12)" value={euro(reserveMinimum)} />
          <Mini label="Osakaalude summa" value={`${shareDiagnostics.sumShares}/${shareDiagnostics.denom}`} tone={shareDiagnostics.ok ? "ok" : "warn"} />
          <Mini label="Soojus kokku (aasta)" value={euro(energyDerived.heatTotal)} />
        </div>
      </Section>
    </div>
  );
}

function Mini({ label, value, tone = "neutral" }) {
  const bg = {
    neutral: "bg-slate-50 border-slate-200",
    ok: "bg-emerald-50 border-emerald-200",
    warn: "bg-amber-50 border-amber-200",
    bad: "bg-rose-50 border-rose-200",
  }[tone];

  return (
    <div className={`rounded-2xl border p-3 ${bg}`}>
      <div className="text-xs text-slate-600">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

// ------------------------- Print summary -------------------------
function PrintSummary({
  data,
  plannedWorksTotal,
  incomeTotals,
  runningTotals,
  investTotals,
  budgetResult,
  shareDiagnostics,
  fundsDerived,
  reserveMinimum,
  energyDerived,
  payments,
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="page">
        <div className="text-xl font-semibold">KORTERIÜHISTU MAJANDUSKAVA (KrtS § 41 lg 1)</div>
        <div className="mt-1 text-sm text-slate-700">
          {data.meta.name} • reg {data.meta.regCode} • {data.meta.address}
        </div>
        <div className="mt-2 text-sm">
          Majandusaasta: <b>{data.meta.year}</b> • Periood: <b>{data.meta.periodStart || "—"} – {data.meta.periodEnd || "—"}</b> • Üldkoosolek: <b>{data.meta.meetingDate || "—"}</b>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border p-3">
            <div className="font-semibold">Maja andmed</div>
            <div className="mt-1">Kortereid: {data.building.aptCount || "—"}</div>
            <div>Kaasomandi osade nimetaja: {data.building.shareDenom || "—"}</div>
            <div>Kogupind: {data.building.totalArea || "—"} m²</div>
            <div>Ehitusaasta: {data.building.buildYear || "—"}</div>
            <div>Korruseid: {data.building.floors || "—"}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="font-semibold">Eelarve kokkuvõte</div>
            <div className="mt-1">Tulud (plaan): {euro(incomeTotals.plan)}</div>
            <div>Jooksvad kulud (plaan): {euro(runningTotals.plan)}</div>
            <div>Investeeringud (plaan): {euro(investTotals.plan)}</div>
            <div className="mt-1 font-semibold">Tulemus: {euro(budgetResult.plan)}</div>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Kaasomandi eseme seisukord ja planeeritud tööd</div>
        <div className="mt-2 rounded-xl border p-3 text-sm">
          <div className="font-semibold">Seisukorra ülevaade</div>
          <ul className="mt-2 list-disc pl-5">
            {data.condition.map((c) => (
              <li key={c.id}>
                {c.label}: <b>{c.status === "hea" ? "Hea" : c.status === "jalgida" ? "Vajab jälgimist" : "Vajab remonti"}</b>
                {c.notes ? ` — ${c.notes}` : ""}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-3 rounded-xl border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Planeeritud tööd</div>
            <div className="font-semibold">Kokku: {euro(plannedWorksTotal)}</div>
          </div>
          <ol className="mt-2 list-decimal pl-5">
            {data.plannedWorks.map((w) => (
              <li key={w.id}>
                <b>{w.desc || "—"}</b> ({w.type}) • {w.period || "—"} • {euro(w.cost)} • rahastus: {w.funding}
              </li>
            ))}
          </ol>
          {data.notes.worksNotes ? <div className="mt-2 text-slate-700"><b>Märkused:</b> {data.notes.worksNotes}</div> : null}
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Korteriomanike kohustused (KrtS § 40, § 41 lg 1 p 3)</div>
        <div className="mt-2 text-sm">
          Osakaalude summa: <b>{shareDiagnostics.sumShares}/{shareDiagnostics.denom}</b> {shareDiagnostics.ok ? "(OK)" : "(VAJAB PARANDUST)"}
        </div>

        <div className="mt-3 overflow-auto rounded-xl border p-3">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Korter</th>
                <th className="py-2 pr-3">Omanik</th>
                <th className="py-2 pr-3">Osa</th>
                <th className="py-2 pr-3">Osakaal</th>
                <th className="py-2 pr-3">Aastas</th>
                <th className="py-2 pr-3">Kuus</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-2 pr-3">{p.unit}</td>
                  <td className="py-2 pr-3">{p.owner || "—"}</td>
                  <td className="py-2 pr-3">{p.shareNum}/{shareDiagnostics.denom}</td>
                  <td className="py-2 pr-3">{pct(p.sharePct, 3)}</td>
                  <td className="py-2 pr-3">{euro(p.yearTotal)}</td>
                  <td className="py-2 pr-3">{euro(p.monthTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Reservkapital ja remondifond (KrtS § 48; § 41 lg 1 p 4)</div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border p-3">
            <div className="font-semibold">Reservkapital</div>
            <div>Alg: {euro(data.funds.reserveStart)} • Laek: {euro(data.funds.reserveIn)} • Kasut: {euro(data.funds.reserveOut)}</div>
            <div className="mt-1 font-semibold">Lõpp: {euro(fundsDerived.reserveEnd)}</div>
            <div>Miinimum (1/12): {euro(reserveMinimum)}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="font-semibold">Remondifond</div>
            <div>Alg: {euro(data.funds.repairStart)} • Laek: {euro(data.funds.repairIn)}</div>
            <div>Kasutus: planeeritud tööd {euro(plannedWorksTotal)} + muu {euro(data.funds.repairOutOther)}</div>
            <div className="mt-1 font-semibold">Lõpp: {euro(fundsDerived.repairEnd)}</div>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Energia prognoos (KrtS § 41 lg 1 p 5)</div>
        <div className="mt-2 rounded-xl border p-3 text-sm">
          <div className="font-semibold">Soojus kokku: {euro(energyDerived.heatTotal)}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {energyDerived.heatRows.map((r) => (
              <div key={r.id} className="rounded-xl border p-2">
                <div className="text-xs text-slate-600">{r.month}</div>
                <div>{num(r.qtyMWh)} MWh × {euro(num(r.pricePerMWh))}/MWh = <b>{euro(r.cost)}</b></div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 rounded-xl border p-3 text-sm">
          <div className="font-semibold">Muud teenused kokku: {euro(energyDerived.otherTotal)}</div>
          <ul className="mt-2 list-disc pl-5">
            {energyDerived.otherRows.map((r) => (
              <li key={r.id}>
                {r.label}: {num(r.qty)} {r.unit} × {euro(num(r.price))} = <b>{euro(r.cost)}</b>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Majanduskava kinnitus</div>
        <div className="mt-2 rounded-xl border p-3 text-sm">
          <div>Koosoleku kuupäev: {data.confirmation.meetingDate || "—"}</div>
          <div>Koht: {data.confirmation.meetingPlace || "—"}</div>
          <div>Hääled: poolt {data.confirmation.votesFor || "—"} / vastu {data.confirmation.votesAgainst || "—"} / erapooletu {data.confirmation.votesAbstain || "—"}</div>
          <div>Protokoll nr: {data.confirmation.protocolNo || "—"}</div>
          <div>Kehtima hakkab: {data.confirmation.effectiveFrom || "—"}</div>
          <div>Tagasiulatuv: {data.confirmation.retroactive || "—"} {data.confirmation.retroactive === "jah" ? `— alus: ${data.confirmation.retroactiveReason || "—"}` : ""}</div>

          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <div className="font-semibold">Õiguslik viide</div>
            <div className="mt-1">
              Majanduskava kehtestab üldkoosolek häälteenamusega (KrtS §§ 35, 41). Tulevikumaksete nõue: TsMS § 369.
              Tagasiulatuv kehtestamine: VÕS § 82 lg 7.
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="rounded-xl border p-3">
              <div className="text-xs text-slate-600">Juhatuse liige</div>
              <div className="mt-6 border-t pt-2">allkiri</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-xs text-slate-600">Koosoleku esimees</div>
              <div className="mt-6 border-t pt-2">allkiri</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-xs text-slate-600">Protokollija</div>
              <div className="mt-6 border-t pt-2">allkiri</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}