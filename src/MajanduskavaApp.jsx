import React, { useEffect, useMemo, useRef, useState } from "react";
import { evaluateMajanduskava } from "./coreClient";

/**
 * MajanduskavaApp.jsx (refaktoritud MVP – kõik kokkulepitud parandused sees)
 * - Bränd: ainult "Majanduskava"
 * - Sammud / sõnastused uuendatud
 * - Hooneosad (EHR loogika) + maksete jaotus pindala alusel (standardmudel)
 * - Reeglid/hoiatused: mitteblokeeriv reserv < miinimum; blokeeriv jaotusbaas=0 või summa=0
 * - Eelarvetabelid: ridasid saab lisada/kustutada, vaba tekst rida nimeks
 * - Numbrid: sisestus lubab "," ja "."; tühjad väljad (ei näita "0"); kuvamine "10 000.00 eurot"
 * - Tagasi/Edasi nupud all (sidebar jääb)
 * - PDF/print väljund lõpeb allkirjastamise plokiga
 * - EI SISALDA Claude API integratsiooni
 */

// ------------------------- utils -------------------------
const LS_KEY = "solvere_majanduskava_v2";

const num = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const cleaned = String(v).replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const clampNonNeg = (v) => {
  const x = num(v);
  return x < 0 ? 0 : x;
};

const round2 = (n) => Math.round(num(n) * 100) / 100;

function formatNumberSpaceDot(n, digits = 2) {
  const x = Number.isFinite(n) ? n : 0;
  // en-US gives 10,000.00 -> replace commas with spaces
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(x)
    .replace(/,/g, " ");
}

const eurot = (n) => `${formatNumberSpaceDot(num(n), 2)} eurot`;

const pct = (n, digits = 3) => {
  const x = Number.isFinite(n) ? n : 0;
  return `${x.toFixed(digits)}%`;
};

const uid = () => Math.random().toString(36).slice(2, 10);

function sum(arr, pick = (x) => x) {
  return arr.reduce((acc, it) => acc + num(pick(it)), 0);
}

function diff(plan, prev) {
  return num(plan) - num(prev);
}

// ------------------------- defaults -------------------------

const DEFAULT_CONDITION = [
  {
    id: "roof",
    label: "Katus ja katusekate",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt lekked puuduvad / vihmaveesüsteemi seisukord kontrollitud ...",
  },
  {
    id: "facade",
    label: "Välisseinad ja fassaad",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt pragusid ei tähelda / vajab vuukide kontrolli ...",
  },
  {
    id: "windows",
    label: "Aknad ja välisuksed",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt tihendid kulunud / vahetusvajadus osaline ...",
  },
  {
    id: "foundation",
    label: "Vundament / kelder",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt niiskusnähtusid ei ole / drenaaž vajab auditit ...",
  },
  {
    id: "stair",
    label: "Trepikojad ja üldruumid",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt valgustus töötab / seinapinnad vajavad värskendust ...",
  },
  {
    id: "heating",
    label: "Küttesüsteem (sõlmed/torustik/radiaatorid)",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt tasakaalustamine tehtud / lekkeid ei tuvastatud ...",
  },
  {
    id: "hotwater",
    label: "Soe tarbevesi",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt boileri/soojussõlme hooldus tehtud ...",
  },
  {
    id: "water",
    label: "Vesi ja kanalisatsioon",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt püstakute seisukord / ummistused / lekked ...",
  },
  {
    id: "electric",
    label: "Elektrisüsteem ja valgustus",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt peakilbi audit / avariivalgustus ...",
  },
  {
    id: "vent",
    label: "Ventilatsioon",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt puhastus/õhuhulkade mõõtmine ...",
  },
  {
    id: "lift",
    label: "Lift (kui on)",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt hooldusleping / rikked viimase 12 kuu jooksul ...",
  },
  {
    id: "yard",
    label: "Krunt ja väliala (teed, haljastus, piirded)",
    status: "hea",
    last: "",
    next: "",
    notes: "",
    noteHint: "nt lumekoristus/katendid/haljastuse hooldus ...",
  },
];

const DEFAULT_INCOME = [
  { id: "advances", label: "Majandamiskulude ettemaksed korteriomanikelt (KrtS § 40 lg 1)", prev: "", plan: "" },
  { id: "repairFundIn", label: "Remondifondi laekumised (KrtS § 41 lg 1 p 4)", prev: "", plan: "" },
  { id: "reserveFundIn", label: "Reservkapitali laekumised (KrtS § 48)", prev: "", plan: "" },
  { id: "rent", label: "Renditulud (ühisruumide üür vms)", prev: "", plan: "" },
  { id: "subsidy", label: "Toetused ja sihtfinantseerimine", prev: "", plan: "" },
];

const DEFAULT_RUNNING = [
  { id: "heat", label: "Soojusenergia (küttekulud)", prev: "", plan: "", group: "Energia" },
  { id: "electricCommon", label: "Elekter (üldruumid/õuevalgustus)", prev: "", plan: "", group: "Energia" },
  { id: "waterSewer", label: "Vesi ja kanalisatsioon (üldtarbimine)", prev: "", plan: "", group: "Vesi" },
  { id: "waste", label: "Prügivedu ja jäätmekäitlus", prev: "", plan: "", group: "Hooldus" },
  { id: "insurance", label: "Kindlustus (hoone/vastutus)", prev: "", plan: "", group: "Hooldus" },
  { id: "manager", label: "Valitseja/halduslepingu tasu", prev: "", plan: "", group: "Teenused" },
  { id: "accounting", label: "Raamatupidamisteenus", prev: "", plan: "", group: "Teenused" },
  { id: "bankFees", label: "Pangakulud ja tehingutasud", prev: "", plan: "", group: "Teenused" },
  { id: "legal", label: "Juriidilised ja notariteenused", prev: "", plan: "", group: "Teenused" },
];

const DEFAULT_INVEST = [
  { id: "plannedWorks", label: "Remondifondist finantseeritavad tööd (vt “Tehniline seisukord ja kavandatavad tööd”)", prev: "", plan: "" },
  { id: "loanPrincipal", label: "Laenu põhiosa tagasimaksed", prev: "", plan: "" },
  { id: "loanInterest", label: "Laenu intressimaksed", prev: "", plan: "" },
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
].map((m) => ({ id: uid(), month: m, qtyMWh: "", pricePerMWh: "", prevCost: "" }));

const DEFAULT_OTHER_ENERGY = [
  { id: "elec", label: "Elekter (üldruumid)", unit: "kWh", qty: "", price: "", prevCost: "" },
  { id: "waterCold", label: "Vesi (külm)", unit: "m³", qty: "", price: "", prevCost: "" },
  { id: "waterHot", label: "Vesi (soe)", unit: "m³", qty: "", price: "", prevCost: "" },
  { id: "sewer", label: "Kanalisatsioon", unit: "m³", qty: "", price: "", prevCost: "" },
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

  // EHR / ehitise üldinfo (valikuline, eeltäidetav tulevikus)
  building: {
    ehrCode: "",
    firstUseYear: "",
    cadastral: "",
    purposeArea: "", // kasutamise otstarbe pind (m²)
    floors: "", // korruselisus
  },

  condition: DEFAULT_CONDITION,

  plannedWorks: [], // alguses tühi (ei tule näiteid)

  notes: { worksNotes: "" },

  budget: {
    income: DEFAULT_INCOME,
    running: DEFAULT_RUNNING,
    invest: DEFAULT_INVEST,
  },

  // Hooneosad (EHR loogika) – eeltäidetav tulevikus, praegu käsitsi
  units: [
    { id: uid(), partNo: "1", type: "Eluruum", rooms: "", entryFloor: "", area: "", includeInAllocation: true, owner: "" },
    { id: uid(), partNo: "2", type: "Eluruum", rooms: "", entryFloor: "", area: "", includeInAllocation: true, owner: "" },
  ],

  funds: {
    reserveStart: "",
    reserveIn: "",
    reserveOut: "",
    repairStart: "",
    repairIn: "",
    repairOutOther: "",
    // otsuse paindlikkus: üldkoosolek võib otsustada reservi suurendamise üle (mitte lihtsalt miinimum)
    reserveTarget: "", // valikuline eesmärk
    reserveTargetReason: "", // valikuline selgitus protokolli jaoks
  },

  allocation: {
    // Standard: pindala alusel (lihtne, EHR-ist tulev). Juriidiline märkus: peab vastama kaasomandi osadele / kokkuleppele.
    confirmMatchesCoOwnership: false,
    overrideExists: "ei", // "ei" | "jah"
    overrideNote: "",
  },

  energy: {
    heatMonths: DEFAULT_HEAT_MONTHS,
    other: DEFAULT_OTHER_ENERGY,
  },

  confirmation: {
    meetingType: "fyysiline", // fyysiline | elektrooniline | kirjalik
    meetingDate: "",
    meetingPlace: "",
    votesTotalOwners: "",
    votesPresent: "",
    votesFor: "",
    votesAgainst: "",
    votesAbstain: "",
    protocolNo: "",
    effectiveFrom: "",
    effectiveTo: "",
    retroactive: "ei",
    retroactiveReason: "",
    decisionText: "",
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
  // we keep it as text to allow "," or "." input freely
  return (
    <Input
      type="text"
      value={value ?? ""}
      onChange={(v) => {
        // allow empty
        if (v === "") return onChange("");
        // allow digits, spaces, comma, dot, minus (minus will be clamped by caller if needed)
        const cleaned = String(v).replace(/[^\d.,\s-]/g, "");
        onChange(cleaned);
      }}
      placeholder={placeholder}
      className={className}
      inputMode="decimal"
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

function Checkbox({ checked, onChange, label }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300"
      />
      <span className="text-slate-700">{label}</span>
    </label>
  );
}

// ------------------------- main app -------------------------
export default function MajanduskavaApp() {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return makeInitial();
      const parsed = JSON.parse(raw);
      return { ...makeInitial(), ...parsed };
    } catch {
      return makeInitial();
    }
  });

  const [step, setStep] = useState(0);
  const [savedAt, setSavedAt] = useState(null);
  const [coreOutcome, setCoreOutcome] = useState(null);
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
      { title: "Üldandmed", subtitle: "Korteriühistu ja ehitise põhiandmed (eeltäidetav registritest)" },
      { title: "Tehniline seisukord ja kavandatavad tööd", subtitle: "Seisukord + planeeritud tööd (KrtS § 41 lg 1 p 1)" },
      { title: "Raha plaan", subtitle: "Tulud ja kulud (KrtS § 41 lg 1 p 2)" },
      { title: "Hooneosad ja maksed", subtitle: "Jaotus pindala alusel (standardmudel) + kontrollid" },
      { title: "Reserv ja remondifond", subtitle: "Fondid (KrtS § 48; KrtS § 41 lg 1 p 4)" },
      { title: "Energia prognoos", subtitle: "Kuu- ja aastaprognoos (KrtS § 41 lg 1 p 5)" },
      { title: "Kinnitus", subtitle: "Üldkoosoleku otsuse andmed + PDF allkirjastamiseks (KrtS § 41 lg 3)" },
    ],
    []
  );

  // ------------------------- derived calculations -------------------------

  const plannedWorksTotal = useMemo(() => round2(sum(data.plannedWorks, (w) => w.cost)), [data.plannedWorks]);

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
    const repairOut = round2(plannedWorksTotal + num(data.funds.repairOutOther));
    const repairEnd = round2(num(data.funds.repairStart) + num(data.funds.repairIn) - repairOut);
    return { reserveEnd, repairOut, repairEnd };
  }, [data.funds, plannedWorksTotal]);

  // Hooneosade (pind) diagnostika ja jaotus
  const unitDiagnostics = useMemo(() => {
    const included = data.units.filter((u) => u.includeInAllocation);
    const totalAreaIncluded = round2(sum(included, (u) => u.area));
    const ok = totalAreaIncluded > 0.0000001;
    return { totalAreaIncluded, ok, includedCount: included.length, totalCount: data.units.length };
  }, [data.units]);

  const payments = useMemo(() => {
    if (!unitDiagnostics.ok) return [];
    const totalCostYear = round2(runningTotals.plan + investTotals.plan);

    return data.units
      .filter((u) => u.includeInAllocation)
      .map((u) => {
        const area = num(u.area);
        const share = unitDiagnostics.totalAreaIncluded ? area / unitDiagnostics.totalAreaIncluded : 0;
        const yearTotal = round2(totalCostYear * share);
        const monthTotal = round2(yearTotal / 12);
        const monthRun = round2((runningTotals.plan * share) / 12);
        const monthInvest = round2((investTotals.plan * share) / 12);

        return {
          ...u,
          sharePct: share * 100,
          yearTotal,
          monthTotal,
          monthRun,
          monthInvest,
        };
      });
  }, [data.units, unitDiagnostics.ok, unitDiagnostics.totalAreaIncluded, runningTotals.plan, investTotals.plan]);

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

    // Step 0: meta
    if (!data.meta.name.trim()) e.meta_name = "Palun sisesta korteriühistu nimi.";
    if (!data.meta.regCode.trim()) e.meta_reg = "Palun sisesta registrikood.";
    if (!data.meta.address.trim()) e.meta_addr = "Palun sisesta aadress.";
    if (!data.meta.meetingDate.trim()) e.meta_meeting = "Palun sisesta üldkoosoleku kuupäev (või plaanitav kuupäev).";

    // Step 3: allocation base (area)
    if (!unitDiagnostics.ok) e.alloc_base = "Jaotuse aluseks oleva pindala summa peab olema > 0 (vali hooneosad ja sisesta pindalad).";

    // Step 4: reserve minimum check (informatiivne, mitte blokeeriv)
    if (fundsDerived.reserveEnd + 1e-9 < reserveMinimum) {
      e.reserve_min = `Hoiatus: reservkapital perioodi lõpus (${eurot(fundsDerived.reserveEnd)}) on väiksem kui seaduslik miinimum 1/12 aasta kuludest (${eurot(reserveMinimum)}) (KrtS § 48).`;
    }

    // Standardmudeli juriidiline kinnitus (informatiivne, kuid soovitatav)
    if (!data.allocation.confirmMatchesCoOwnership) {
      e.alloc_confirm = "Soovitus: kinnita, et pindalapõhine jaotus vastab ühistu kaasomandi osadele või kehtivale kokkuleppele.";
    }

    return e;
  }, [data, unitDiagnostics.ok, fundsDerived.reserveEnd, reserveMinimum]);

  const stepHasBlockingErrors = (s) => {
    if (s === 0) return Boolean(errors.meta_name || errors.meta_reg || errors.meta_addr || errors.meta_meeting);
    if (s === 3) return Boolean(errors.alloc_base);
    return false;
  };

  // ------------------------- handlers -------------------------
  const update = (path, value) => {
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

  const printPdf = () => window.print();

  // ------------------------- render -------------------------
  const toneForResult = (n) => {
    if (n > 0.009) return "ok";
    if (n < -0.009) return "bad";
    return "warn";
  };

  const topBadges = (
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone={toneForResult(budgetResult.plan)}>Tulemus (plaan): {eurot(budgetResult.plan)}</Pill>
      <Pill tone={fundsDerived.reserveEnd + 1e-9 < reserveMinimum ? "warn" : "ok"}>
        Reserv lõpus: {eurot(fundsDerived.reserveEnd)} • miin {eurot(reserveMinimum)}
      </Pill>
      <Pill tone={unitDiagnostics.ok ? "ok" : "warn"}>
        Jaotusbaas (pind): {unitDiagnostics.ok ? `${formatNumberSpaceDot(unitDiagnostics.totalAreaIncluded, 2)} m²` : "—"}
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
          a[href]:after { content: ""; } /* keep clean */
        }
      `}</style>

      <div className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">Majanduskava</div>
            <div className="text-xs text-slate-600">Struktureeritud vorm • automaatarvutused • PDF allkirjastamiseks</div>
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
          <div className="no-print">
            <h1 className="text-xl font-semibold">{steps[step].title}</h1>
            <p className="text-sm text-slate-600">{steps[step].subtitle}</p>
          </div>

          {step === 0 && <PageGeneral data={data} update={update} errors={errors} />}

          {step === 1 && (
            <PageTechWorks
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
              addRow={addRow}
              removeRow={removeRow}
              plannedWorksTotal={plannedWorksTotal}
              incomeTotals={incomeTotals}
              runningTotals={runningTotals}
              investTotals={investTotals}
              budgetResult={budgetResult}
            />
          )}

          {step === 3 && (
            <PageUnitsPayments
              data={data}
              updateRow={updateRow}
              addRow={addRow}
              removeRow={removeRow}
              unitDiagnostics={unitDiagnostics}
              payments={payments}
              runningTotals={runningTotals}
              investTotals={investTotals}
              errors={errors}
              update={update}
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

          {step === 5 && <PageEnergy data={data} updateRow={updateRow} energyDerived={energyDerived} />}

          {step === 6 && (
            <PageConfirm
              data={data}
              update={update}
              incomeTotals={incomeTotals}
              runningTotals={runningTotals}
              investTotals={investTotals}
              budgetResult={budgetResult}
              unitDiagnostics={unitDiagnostics}
              fundsDerived={fundsDerived}
              reserveMinimum={reserveMinimum}
              energyDerived={energyDerived}
              printPdf={printPdf}
            />
          )}

          {/* Bottom navigation (no-print) */}
          <div className="no-print sticky bottom-4 z-10">
            <div className="rounded-2xl border bg-white/90 p-3 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <Btn tone="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                  Tagasi
                </Btn>
                <div className="text-xs text-slate-600">
                  Samm {step + 1} / {steps.length}
                </div>
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
              {stepHasBlockingErrors(step) ? (
                <div className="mt-2 text-xs text-rose-600">
                  Palun täida sammu kohustuslikud väljad enne edasi liikumist.
                </div>
              ) : null}
            </div>
          </div>

          {/* Print-only summary */}
          <div className="print-only hidden">
            <PrintSummary
              data={data}
              plannedWorksTotal={plannedWorksTotal}
              incomeTotals={incomeTotals}
              runningTotals={runningTotals}
              investTotals={investTotals}
              budgetResult={budgetResult}
              unitDiagnostics={unitDiagnostics}
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

function PageGeneral({ data, update, errors }) {
  return (
    <div className="space-y-4">
      <Section title="A. Korteriühistu andmed" subtitle="Andmed on eeltäidetavad Äriregistrist (käsitsi saab alati parandada).">
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
            <Input value={data.meta.board} onChange={(v) => update("meta.board", v)} placeholder="nt nimi, telefon, e-post" />
          </div>
        </div>
      </Section>

      <Section title="B. Majandusaasta" subtitle="Millise perioodi kohta kava kehtib?">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label>Majandusaasta (aasta)</Label>
            <NumberInput value={String(data.meta.year ?? "")} onChange={(v) => update("meta.year", v === "" ? "" : clampNonNeg(v))} />
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
          <div className="font-semibold">Õiguslik info</div>
          <ul className="mt-1 list-disc pl-5">
            <li>Majanduskava on eelarve KrtS § 41 lg 1 p 1–5 tähenduses.</li>
            <li>Kehtestab üldkoosolek häälteenamusega (KrtS § 41 lg 3).</li>
            <li>Kui uut kava ei kehtestata, kehtib eelmine kava (KrtS § 41 lg 5).</li>
          </ul>
        </div>
      </Section>

      <Section title="C. Ehitise üldinfo" subtitle="Andmed on eeltäidetavad Ehitisregistrist (valikuline). Käsitsi saab parandada.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label>Ehitisregistri kood</Label>
            <Input value={data.building.ehrCode} onChange={(v) => update("building.ehrCode", v)} placeholder="nt 123456789" />
          </div>
          <div>
            <Label>Esmase kasutuselevõtu aasta</Label>
            <Input value={data.building.firstUseYear} onChange={(v) => update("building.firstUseYear", v)} placeholder="nt 1986" />
          </div>
          <div>
            <Label>Katastritunnus</Label>
            <Input value={data.building.cadastral} onChange={(v) => update("building.cadastral", v)} placeholder="nt 78401:..." />
          </div>
          <div className="md:col-span-2">
            <Label>Kasutamise otstarbe pind (m²)</Label>
            <NumberInput value={data.building.purposeArea} onChange={(v) => update("building.purposeArea", v)} placeholder="nt 436.30" />
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

function PageTechWorks({ data, updateRow, addRow, removeRow, update, plannedWorksTotal }) {
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
      <Section title="I. Hoone üldseisukord">
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
                  <Label>Viimane ülevaatus (valikuline)</Label>
                  <Input value={row.last} onChange={(v) => updateRow("condition", row.id, { last: v })} placeholder="kk.aaaa" />
                </div>
                <div>
                  <Label>Järgmine ülevaatus (valikuline)</Label>
                  <Input value={row.next} onChange={(v) => updateRow("condition", row.id, { next: v })} placeholder="kk.aaaa" />
                </div>
                <div className="md:col-span-5">
                  <Label>Märkused (valikuline)</Label>
                  <Input
                    value={row.notes}
                    onChange={(v) => updateRow("condition", row.id, { notes: v })}
                    placeholder={row.noteHint || "Märkus..."}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="II. Kavandatavad tööd ja toimingud"
        subtitle="Lisa tööd, ajakava, eeldatav maksumus ja rahastusallikas."
        right={<Pill tone="info">Kokku: {eurot(plannedWorksTotal)}</Pill>}
      >
        <div className="space-y-3">
          {data.plannedWorks.length === 0 ? (
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              Tööd puuduvad. Lisa vajadusel vähemalt üks rida.
            </div>
          ) : null}

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
                  <Label>Maksumus</Label>
                  <NumberInput value={w.cost} onChange={(v) => updateRow("plannedWorks", w.id, { cost: v })} placeholder="nt 3500.00" />
                </div>
                <div>
                  <Label>Rahastus</Label>
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
                addRow("plannedWorks", { id: uid(), desc: "", type: "remont", period: "", cost: "", funding: "remondifond" })
              }
            >
              + Lisa töö
            </Btn>
          </div>
        </div>

        <div className="mt-4">
          <Label>Täiendavad märkused / selgitused (valikuline)</Label>
          <textarea
            value={data.notes.worksNotes}
            onChange={(e) => update("notes.worksNotes", e.target.value)}
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2"
            rows={4}
            placeholder="Kirjelda riskid, prioriteedid, olulised eeldused, pooleliolevad tööd..."
          />
        </div>
      </Section>
    </div>
  );
}

function BudgetTableEditable({ title, rows, onChangeRow, onAddRow, onRemoveRow, totals, lockPlanId, lockPlanValue }) {
  return (
    <Section title={title} right={<Pill tone="info">Plaan kokku: {eurot(totals.plan)}</Pill>}>
      <div className="overflow-auto">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="text-left text-xs text-slate-600">
            <tr>
              <th className="py-2 pr-3">Rida</th>
              <th className="py-2 pr-3">Eelmine aasta tegelik</th>
              <th className="py-2 pr-3">Kavandatav</th>
              <th className="py-2 pr-3">Muutus</th>
              <th className="py-2 pr-3"></th>
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
                    <Input
                      value={r.label}
                      onChange={(v) => onChangeRow(r.id, { label: v })}
                      placeholder="Rida nimetus"
                      className="min-w-[320px]"
                      disabled={planLocked}
                    />
                    {r.group ? <div className="mt-1 text-xs text-slate-500">{r.group}</div> : null}
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.prev} onChange={(v) => onChangeRow(r.id, { prev: v })} placeholder="0.00" />
                  </td>
                  <td className="py-2 pr-3">
                    {planLocked ? (
                      <div className="rounded-xl bg-slate-50 px-3 py-2">{eurot(planValue)}</div>
                    ) : (
                      <NumberInput value={r.plan} onChange={(v) => onChangeRow(r.id, { plan: v })} placeholder="0.00" />
                    )}
                    {planLocked ? <div className="mt-1 text-xs text-slate-500">Võetakse automaatselt kavandatud tööde summast.</div> : null}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-medium">{eurot(d)}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {planLocked ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <Btn tone="danger" onClick={() => onRemoveRow(r.id)}>Kustuta</Btn>
                    )}
                  </td>
                </tr>
              );
            })}

            <tr className="border-t bg-slate-50">
              <td className="py-2 pr-3 font-semibold">KOKKU</td>
              <td className="py-2 pr-3 font-semibold">{eurot(totals.prev)}</td>
              <td className="py-2 pr-3 font-semibold">{eurot(totals.plan)}</td>
              <td className="py-2 pr-3 font-semibold">{eurot(totals.diff)}</td>
              <td className="py-2 pr-3"></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <Btn tone="ghost" onClick={onAddRow}>+ Lisa rida</Btn>
      </div>
    </Section>
  );
}

function PageBudget({ data, updateRow, addRow, removeRow, plannedWorksTotal, incomeTotals, runningTotals, investTotals, budgetResult }) {
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
            <Pill tone="info">Tulud: {eurot(incomeTotals.plan)}</Pill>
            <Pill tone="info">Jooksvad kulud: {eurot(runningTotals.plan)}</Pill>
            <Pill tone="info">Investeeringud: {eurot(investTotals.plan)}</Pill>
            <Pill tone={budgetResult.plan > 0 ? "ok" : budgetResult.plan < 0 ? "bad" : "warn"}>Tulemus: {eurot(budgetResult.plan)}</Pill>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-600">
          Investeeringute real “Remondifondist finantseeritavad tööd” võetakse summa automaatselt kavandatud töödest ({eurot(plannedWorksTotal)}).
        </div>
      </div>

      <BudgetTableEditable
        title="A. Tulud (KrtS § 41 lg 1 p 2)"
        rows={data.budget.income}
        onChangeRow={onIncome}
        totals={incomeTotals}
        onAddRow={() => addRow("budget.income", { id: uid(), label: "", prev: "", plan: "" })}
        onRemoveRow={(id) => removeRow("budget.income", id)}
      />

      <BudgetTableEditable
        title="B. Jooksvad majandamiskulud"
        rows={data.budget.running}
        onChangeRow={onRunning}
        totals={runningTotals}
        onAddRow={() => addRow("budget.running", { id: uid(), label: "", prev: "", plan: "", group: "" })}
        onRemoveRow={(id) => removeRow("budget.running", id)}
      />

      <BudgetTableEditable
        title="C. Remondi- ja investeerimiskulud"
        rows={investRows}
        onChangeRow={onInvest}
        totals={{ prev: investTotals.prev, plan: investTotals.plan, diff: investTotals.diff }}
        lockPlanId="plannedWorks"
        lockPlanValue={plannedWorksTotal}
        onAddRow={() => addRow("budget.invest", { id: uid(), label: "", prev: "", plan: "" })}
        onRemoveRow={(id) => removeRow("budget.invest", id)}
      />

      <Section title="D. Tulemi selgitus" subtitle="Tulemus = Tulud – Jooksvad kulud – Investeeringud">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Tulud (plaan)</div>
            <div className="text-lg font-semibold">{eurot(incomeTotals.plan)}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Kulud (plaan)</div>
            <div className="text-lg font-semibold">{eurot(runningTotals.plan + investTotals.plan)}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Tulemus (plaan)</div>
            <div className="text-lg font-semibold">{eurot(budgetResult.plan)}</div>
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

function PageUnitsPayments({ data, updateRow, addRow, removeRow, unitDiagnostics, payments, runningTotals, investTotals, errors, update }) {
  const monthlyRunningTotal = round2(runningTotals.plan / 12);
  const monthlyInvestTotal = round2(investTotals.plan / 12);

  const typeOptions = [
    { value: "Eluruum", label: "Eluruum" },
    { value: "Mitteeluruum", label: "Mitteeluruum" },
    { value: "Üldkasutatav pind", label: "Üldkasutatav pind" },
    { value: "Tehnopind", label: "Tehnopind" },
  ];

  return (
    <div className="space-y-4">
      <Section title="A. Kulu kokkuvõte" subtitle="Need summad jaotatakse hooneosade vahel valitud jaotusbaasi alusel.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Jooksvad kulud / kuu</div>
            <div className="text-lg font-semibold">{eurot(monthlyRunningTotal)}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Investeeringud / kuu</div>
            <div className="text-lg font-semibold">{eurot(monthlyInvestTotal)}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Kokku / kuu</div>
            <div className="text-lg font-semibold">{eurot(monthlyRunningTotal + monthlyInvestTotal)}</div>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-semibold">Standardmudel (A): jaotus pindala alusel</div>
          <div className="mt-1">
            See vorm kasutab standardmudelit, kus majandamiskulud jaotatakse hooneosade pindala proportsioonis.
            Kui põhikirjas või korteriomanike kokkuleppes on teistsugune jaotus (KrtS § 40 lg 2), siis kasuta eraldi lahendust / lisa protokolli selgitus.
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <Checkbox
            checked={data.allocation.confirmMatchesCoOwnership}
            onChange={(v) => update("allocation.confirmMatchesCoOwnership", v)}
            label="Kinnitan, et pindalapõhine jaotus vastab ühistu kaasomandi osadele või kehtivale kokkuleppele."
          />
          {errors.alloc_confirm ? <div className="text-xs text-amber-800">{errors.alloc_confirm}</div> : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>Kas põhikirjas/kokkuleppes on teistsugune jaotus? (KrtS § 40 lg 2)</Label>
              <Select
                value={data.allocation.overrideExists}
                onChange={(v) => update("allocation.overrideExists", v)}
                options={[
                  { value: "ei", label: "Ei" },
                  { value: "jah", label: "Jah" },
                ]}
              />
            </div>
            <div>
              <Label>Märkus (valikuline)</Label>
              <Input
                value={data.allocation.overrideNote}
                onChange={(v) => update("allocation.overrideNote", v)}
                placeholder="nt jaotus tarbimise/põhikirja alusel – standardmudelit ei kasutata täies ulatuses"
              />
            </div>
          </div>
        </div>

        {errors.alloc_base ? (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{errors.alloc_base}</div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone="info">
              Jaotusbaas (arvestuses): {formatNumberSpaceDot(unitDiagnostics.totalAreaIncluded, 2)} m²
            </Pill>
            <Pill tone="info">Hooneosi arvestuses: {unitDiagnostics.includedCount}/{unitDiagnostics.totalCount}</Pill>
          </div>
        )}
      </Section>

      <Section
        title="B. Hooneosad (EHR loogika) ja maksed"
        subtitle="Hooneosad on eeltäidetavad Ehitisregistrist. Käsitsi saad lisada, muuta ja valida, kas hooneosa läheb jaotuses arvesse."
        right={
          <Btn
            tone="ghost"
            onClick={() =>
              addRow("units", {
                id: uid(),
                partNo: String(data.units.length + 1),
                type: "Eluruum",
                rooms: "",
                entryFloor: "",
                area: "",
                includeInAllocation: true,
                owner: "",
              })
            }
          >
            + Lisa hooneosa
          </Btn>
        }
      >
        <div className="overflow-auto">
          <table className="min-w-[1300px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Osa nr</th>
                <th className="py-2 pr-3">Hooneosa tüüp</th>
                <th className="py-2 pr-3">Tubade arv (valikuline)</th>
                <th className="py-2 pr-3">Sissepääsu korrus (valikuline)</th>
                <th className="py-2 pr-3">Hooneosa pind (m²)</th>
                <th className="py-2 pr-3">Arvestada jaotuses</th>
                <th className="py-2 pr-3">Omanik (valikuline)</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.units.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="py-2 pr-3">
                    <Input value={u.partNo} onChange={(v) => updateRow("units", u.id, { partNo: v })} placeholder="1" className="max-w-[80px]" />
                  </td>
                  <td className="py-2 pr-3">
                    <Select value={u.type} onChange={(v) => updateRow("units", u.id, { type: v })} options={typeOptions} />
                  </td>
                  <td className="py-2 pr-3">
                    <Input value={u.rooms} onChange={(v) => updateRow("units", u.id, { rooms: v })} placeholder="nt 2" className="max-w-[140px]" />
                  </td>
                  <td className="py-2 pr-3">
                    <Input value={u.entryFloor} onChange={(v) => updateRow("units", u.id, { entryFloor: v })} placeholder="nt 1" className="max-w-[160px]" />
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={u.area} onChange={(v) => updateRow("units", u.id, { area: v })} placeholder="nt 64.60" className="max-w-[160px]" />
                  </td>
                  <td className="py-2 pr-3">
                    <Select
                      value={u.includeInAllocation ? "jah" : "ei"}
                      onChange={(v) => updateRow("units", u.id, { includeInAllocation: v === "jah" })}
                      options={[
                        { value: "jah", label: "Jah" },
                        { value: "ei", label: "Ei" },
                      ]}
                      className="max-w-[120px]"
                    />
                    {!u.includeInAllocation && (u.type === "Eluruum" || u.type === "Mitteeluruum") ? (
                      <div className="mt-1 text-xs text-amber-800">Hoiatus: eluruum/mitteeluruum on jäetud jaotusest välja.</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <Input value={u.owner} onChange={(v) => updateRow("units", u.id, { owner: v })} placeholder="valikuline" />
                  </td>
                  <td className="py-2 pr-3">
                    <Btn tone="danger" onClick={() => removeRow("units", u.id)}>Kustuta</Btn>
                  </td>
                </tr>
              ))}
              <tr className="border-t bg-slate-50">
                <td className="py-2 pr-3 font-semibold" colSpan={4}>KOKKU (arvestuses)</td>
                <td className="py-2 pr-3 font-semibold">{formatNumberSpaceDot(unitDiagnostics.totalAreaIncluded, 2)} m²</td>
                <td className="py-2 pr-3 font-semibold">{unitDiagnostics.includedCount}/{unitDiagnostics.totalCount}</td>
                <td className="py-2 pr-3" colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold">Maksete jaotus (aastas / kuus)</div>
          <div className="mt-2 overflow-auto">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="text-left text-xs text-slate-600">
                <tr>
                  <th className="py-2 pr-3">Osa nr</th>
                  <th className="py-2 pr-3">Tüüp</th>
                  <th className="py-2 pr-3">Pind</th>
                  <th className="py-2 pr-3">Osakaal</th>
                  <th className="py-2 pr-3">Aastas</th>
                  <th className="py-2 pr-3">Kuus</th>
                  <th className="py-2 pr-3">sh jooksev / kuu</th>
                  <th className="py-2 pr-3">sh invest / kuu</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-2 pr-3">{p.partNo}</td>
                    <td className="py-2 pr-3">{p.type}</td>
                    <td className="py-2 pr-3">{formatNumberSpaceDot(num(p.area), 2)} m²</td>
                    <td className="py-2 pr-3 font-medium">{pct(p.sharePct, 3)}</td>
                    <td className="py-2 pr-3 font-medium">{eurot(p.yearTotal)}</td>
                    <td className="py-2 pr-3 font-medium">{eurot(p.monthTotal)}</td>
                    <td className="py-2 pr-3">{eurot(p.monthRun)}</td>
                    <td className="py-2 pr-3">{eurot(p.monthInvest)}</td>
                  </tr>
                ))}
                {payments.length ? (
                  <tr className="border-t bg-slate-50">
                    <td className="py-2 pr-3 font-semibold" colSpan={4}>KOKKU</td>
                    <td className="py-2 pr-3 font-semibold">{eurot(sum(payments, (x) => x.yearTotal))}</td>
                    <td className="py-2 pr-3 font-semibold">{eurot(sum(payments, (x) => x.monthTotal))}</td>
                    <td className="py-2 pr-3 font-semibold">{eurot(sum(payments, (x) => x.monthRun))}</td>
                    <td className="py-2 pr-3 font-semibold">{eurot(sum(payments, (x) => x.monthInvest))}</td>
                  </tr>
                ) : (
                  <tr className="border-t">
                    <td className="py-3 pr-3 text-slate-500" colSpan={8}>Maksete arvutamiseks sisesta hooneosade pindalad ja vali, mis läheb jaotuses arvesse.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <div className="font-semibold">Õiguslik märkus</div>
            <div className="mt-1">
              KrtS § 40 lg 1: korteriomanikud teevad perioodilisi ettemakseid vastavalt oma kaasomandi osa suurusele.
              Teistsugune jaotus võib tuleneda põhikirjast või korteriomanike kokkuleppest (KrtS § 40 lg 2).
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function PageFunds({ data, update, plannedWorksTotal, annualCostsPlanned, reserveMinimum, fundsDerived, errors }) {
  return (
    <div className="space-y-4">
      <Section
        title="A. Reservkapital (KrtS § 48)"
        subtitle="Reserv peab olema vähemalt 1/12 aasta eeldatavatest kuludest. Üldkoosolek võib otsustada ka suurema sihttaseme."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <Label>Algjääk</Label>
            <NumberInput value={data.funds.reserveStart} onChange={(v) => update("funds.reserveStart", v)} placeholder="0.00" />
          </div>
          <div>
            <Label>Laekumised</Label>
            <NumberInput value={data.funds.reserveIn} onChange={(v) => update("funds.reserveIn", v)} placeholder="0.00" />
          </div>
          <div>
            <Label>Kasutamine</Label>
            <NumberInput value={data.funds.reserveOut} onChange={(v) => update("funds.reserveOut", v)} placeholder="0.00" />
          </div>
          <div>
            <Label>Sihttase (valikuline)</Label>
            <NumberInput value={data.funds.reserveTarget} onChange={(v) => update("funds.reserveTarget", v)} placeholder="nt 5000.00" />
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Lõppjääk (eeldatav)</div>
            <div className="text-lg font-semibold">{eurot(fundsDerived.reserveEnd)}</div>
            <div className="mt-1 text-xs text-slate-600">Miinimum (1/12): {eurot(reserveMinimum)}</div>
            {errors.reserve_min ? <div className="mt-2 text-xs text-amber-800">{errors.reserve_min}</div> : <Pill tone="ok">OK</Pill>}
          </div>
        </div>

        <div className="mt-3">
          <Label>Sihttaseme põhjendus (valikuline, protokolli jaoks)</Label>
          <Input
            value={data.funds.reserveTargetReason}
            onChange={(v) => update("funds.reserveTargetReason", v)}
            placeholder="nt riskipuhver, ootamatud avariitööd, kindlustuse omavastutus..."
          />
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          Aasta eeldatavad kulud (plaan): <b>{eurot(annualCostsPlanned)}</b> → seaduslik miinimum 1/12: <b>{eurot(reserveMinimum)}</b> (KrtS § 48).
        </div>
      </Section>

      <Section
        title="B. Remondifond (KrtS § 41 lg 1 p 4)"
        subtitle="Remondifond on sihtotstarbeline fond. Üldkoosolek saab fondi kasutust ja reegleid otsustega reguleerida."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <Label>Algjääk</Label>
            <NumberInput value={data.funds.repairStart} onChange={(v) => update("funds.repairStart", v)} placeholder="0.00" />
          </div>
          <div>
            <Label>Laekumised</Label>
            <NumberInput value={data.funds.repairIn} onChange={(v) => update("funds.repairIn", v)} placeholder="0.00" />
          </div>
          <div>
            <Label>Kavandatavad tööd (automaatne)</Label>
            <div className="rounded-xl bg-slate-50 px-3 py-2">{eurot(plannedWorksTotal)}</div>
            <div className="mt-1 text-xs text-slate-500">Võetakse sammust “Tehniline seisukord ja kavandatavad tööd”.</div>
          </div>
          <div>
            <Label>Muu kasutamine (valikuline)</Label>
            <NumberInput value={data.funds.repairOutOther} onChange={(v) => update("funds.repairOutOther", v)} placeholder="0.00" />
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Lõppjääk (eeldatav)</div>
            <div className="text-lg font-semibold">{eurot(fundsDerived.repairEnd)}</div>
            <div className="mt-1 text-xs text-slate-600">Kasutus kokku: {eurot(fundsDerived.repairOut)}</div>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          Märkus: remondifondi kasutus ei pea piirduma ainult loetelus olevate töödega – üldkoosolek võib otsustada fondi kasutuse ja tingimused (KrtS § 41 lg 1 p 4).
        </div>
      </Section>

      <Section
        title="C. Laenud (informatiivne)"
        subtitle="Laenuotsused kuuluvad üldkoosoleku pädevusse ning võivad vajada erikorda (KrtS § 35 lg 2 p 6; KrtS § 36)."
      >
        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          Kui eelarves on laenumaksed, veendu, et üldkoosoleku otsus, laenulepingu tingimused ja mõju igakuisele maksele on selgelt protokollis kirjeldatud.
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
        subtitle="Sisesta prognoositav kogus (MWh) ja ühikuhind (eurot/MWh). Maksumus arvutatakse automaatselt (KrtS § 41 lg 1 p 5)."
        right={<Pill tone="info">Aasta kokku: {eurot(energyDerived.heatTotal)}</Pill>}
      >
        <div className="overflow-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Kuu</th>
                <th className="py-2 pr-3">Kogus (MWh)</th>
                <th className="py-2 pr-3">Hind (eurot/MWh)</th>
                <th className="py-2 pr-3">Maksumus (auto)</th>
                <th className="py-2 pr-3">Eelmine aasta (eurot)</th>
                <th className="py-2 pr-3">Muutus</th>
              </tr>
            </thead>
            <tbody>
              {energyDerived.heatRows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3 font-medium">{r.month}</td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.qtyMWh} onChange={(v) => updateRow("energy.heatMonths", r.id, { qtyMWh: v })} placeholder="0.00" />
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.pricePerMWh} onChange={(v) => updateRow("energy.heatMonths", r.id, { pricePerMWh: v })} placeholder="0.00" />
                  </td>
                  <td className="py-2 pr-3 font-medium">{eurot(r.cost)}</td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.prevCost} onChange={(v) => updateRow("energy.heatMonths", r.id, { prevCost: v })} placeholder="0.00" />
                  </td>
                  <td className="py-2 pr-3">{eurot(r.change)}</td>
                </tr>
              ))}
              <tr className="border-t bg-slate-50">
                <td className="py-2 pr-3 font-semibold">KOKKU</td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3 font-semibold">{eurot(energyDerived.heatTotal)}</td>
                <td className="py-2 pr-3 font-semibold">{eurot(energyDerived.heatPrevTotal)}</td>
                <td className="py-2 pr-3 font-semibold">{eurot(energyDerived.heatChange)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="B. Elekter / vesi / teenused (aastane)"
        subtitle="Sisesta kogus ja ühikuhind. Maksumus arvutatakse automaatselt (KrtS § 41 lg 1 p 5)."
        right={<Pill tone="info">Aasta kokku: {eurot(energyDerived.otherTotal)}</Pill>}
      >
        <div className="overflow-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Teenuse nimetus</th>
                <th className="py-2 pr-3">Ühik</th>
                <th className="py-2 pr-3">Kogus</th>
                <th className="py-2 pr-3">Hind (eurot/ühik)</th>
                <th className="py-2 pr-3">Maksumus (auto)</th>
                <th className="py-2 pr-3">Eelmine aasta (eurot)</th>
                <th className="py-2 pr-3">Muutus</th>
              </tr>
            </thead>
            <tbody>
              {energyDerived.otherRows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3 font-medium">{r.label}</td>
                  <td className="py-2 pr-3">{r.unit}</td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.qty} onChange={(v) => updateRow("energy.other", r.id, { qty: v })} placeholder="0.00" />
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.price} onChange={(v) => updateRow("energy.other", r.id, { price: v })} placeholder="0.00" />
                  </td>
                  <td className="py-2 pr-3 font-medium">{eurot(r.cost)}</td>
                  <td className="py-2 pr-3">
                    <NumberInput value={r.prevCost} onChange={(v) => updateRow("energy.other", r.id, { prevCost: v })} placeholder="0.00" />
                  </td>
                  <td className="py-2 pr-3">{eurot(r.change)}</td>
                </tr>
              ))}
              <tr className="border-t bg-slate-50">
                <td className="py-2 pr-3 font-semibold">KOKKU</td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3"></td>
                <td className="py-2 pr-3 font-semibold">{eurot(energyDerived.otherTotal)}</td>
                <td className="py-2 pr-3 font-semibold">{eurot(energyDerived.otherPrevTotal)}</td>
                <td className="py-2 pr-3 font-semibold">{eurot(energyDerived.otherChange)}</td>
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
  unitDiagnostics,
  fundsDerived,
  reserveMinimum,
  energyDerived,
  printPdf,
}) {
  const retro = data.confirmation.retroactive === "jah";

  const meetingTypeOptions = [
    { value: "fyysiline", label: "Füüsiline koosolek" },
    { value: "elektrooniline", label: "Elektrooniline koosolek" },
    { value: "kirjalik", label: "Kirjalik hääletus" },
  ];

  return (
    <div className="space-y-4">
      <Section
        title="Üldkoosoleku otsuse andmed"
        subtitle="Majanduskava esitatakse tutvumiseks koos koosoleku kutsega. Kinnitamine toimub otsusega pärast koosolekut (KrtS § 41 lg 3)."
        right={<Btn onClick={printPdf}>Prindi / salvesta PDF</Btn>}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label>Koosoleku liik</Label>
            <Select value={data.confirmation.meetingType} onChange={(v) => update("confirmation.meetingType", v)} options={meetingTypeOptions} />
          </div>
          <div>
            <Label>Koosoleku kuupäev</Label>
            <Input value={data.confirmation.meetingDate} onChange={(v) => update("confirmation.meetingDate", v)} placeholder="pp.kk.aaaa" />
          </div>
          <div>
            <Label>Protokolli number</Label>
            <Input value={data.confirmation.protocolNo} onChange={(v) => update("confirmation.protocolNo", v)} placeholder="..." />
          </div>

          <div className="md:col-span-3">
            <Label>Koosoleku koht / link (valikuline)</Label>
            <Input value={data.confirmation.meetingPlace} onChange={(v) => update("confirmation.meetingPlace", v)} placeholder="..." />
          </div>

          <div>
            <Label>Korteriomanike koguarv</Label>
            <NumberInput value={data.confirmation.votesTotalOwners} onChange={(v) => update("confirmation.votesTotalOwners", v)} placeholder="arv" />
          </div>
          <div>
            <Label>Osalejate / hääletanute arv</Label>
            <NumberInput value={data.confirmation.votesPresent} onChange={(v) => update("confirmation.votesPresent", v)} placeholder="arv" />
          </div>
          <div />

          <div>
            <Label>Hääled poolt</Label>
            <NumberInput value={data.confirmation.votesFor} onChange={(v) => update("confirmation.votesFor", v)} placeholder="arv" />
          </div>
          <div>
            <Label>Hääled vastu</Label>
            <NumberInput value={data.confirmation.votesAgainst} onChange={(v) => update("confirmation.votesAgainst", v)} placeholder="arv" />
          </div>
          <div>
            <Label>Erapooletu</Label>
            <NumberInput value={data.confirmation.votesAbstain} onChange={(v) => update("confirmation.votesAbstain", v)} placeholder="arv" />
          </div>

          <div className="md:col-span-3">
            <Label>Otsuse sõnastus (vabatekst)</Label>
            <textarea
              value={data.confirmation.decisionText}
              onChange={(e) => update("confirmation.decisionText", e.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2"
              rows={4}
              placeholder="Kirjuta otsuse tekst. Nt: 'Kinnitada majanduskava perioodiks ...' + maksete suurus / jaotus / fondid..."
            />
          </div>

          <div>
            <Label>Kehtivuse algus</Label>
            <Input value={data.confirmation.effectiveFrom} onChange={(v) => update("confirmation.effectiveFrom", v)} placeholder="pp.kk.aaaa" />
          </div>
          <div>
            <Label>Kehtivuse lõpp</Label>
            <Input value={data.confirmation.effectiveTo} onChange={(v) => update("confirmation.effectiveTo", v)} placeholder="pp.kk.aaaa" />
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
              <Label>Tagasiulatuva kehtestamise põhjendus (kui jah)</Label>
              <Input
                value={data.confirmation.retroactiveReason}
                onChange={(v) => update("confirmation.retroactiveReason", v)}
                placeholder="Põhjendus..."
              />
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-semibold">Õiguslik viide</div>
          <ul className="mt-1 list-disc pl-5">
            <li>Majanduskava kinnitatakse üldkoosoleku otsusega (KrtS § 41 lg 3).</li>
            <li>Perioodiliste maksete nõude erisus (TsMS § 369).</li>
            <li>Tagasiulatuv kehtestamine: sissenõutavaks muutumine vähemalt otsuse tegemise kuupäevast (VÕS § 82 lg 7).</li>
          </ul>
        </div>
      </Section>

      <Section title="Kiirülevaade (enne printi)" subtitle="Kontrolli, kas põhisummad ja jaotusbaas on loogilised.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Mini label="Tulud (plaan)" value={eurot(incomeTotals.plan)} />
          <Mini label="Jooksvad kulud (plaan)" value={eurot(runningTotals.plan)} />
          <Mini label="Investeeringud (plaan)" value={eurot(investTotals.plan)} />
          <Mini label="Tulemus (plaan)" value={eurot(budgetResult.plan)} tone={budgetResult.plan > 0 ? "ok" : budgetResult.plan < 0 ? "bad" : "warn"} />
          <Mini label="Reserv lõpus" value={eurot(fundsDerived.reserveEnd)} tone={fundsDerived.reserveEnd + 1e-9 < reserveMinimum ? "warn" : "ok"} />
          <Mini label="Reserv miinimum (1/12)" value={eurot(reserveMinimum)} />
          <Mini label="Jaotusbaas (pind)" value={unitDiagnostics.ok ? `${formatNumberSpaceDot(unitDiagnostics.totalAreaIncluded, 2)} m²` : "—"} tone={unitDiagnostics.ok ? "ok" : "warn"} />
          <Mini label="Soojus kokku (aasta)" value={eurot(energyDerived.heatTotal)} />
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
  unitDiagnostics,
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
          Majandusaasta: <b>{data.meta.year || "—"}</b> • Periood:{" "}
          <b>{data.meta.periodStart || "—"} – {data.meta.periodEnd || "—"}</b> • Üldkoosolek:{" "}
          <b>{data.meta.meetingDate || "—"}</b>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border p-3">
            <div className="font-semibold">Ehitise üldinfo (valikuline)</div>
            <div className="mt-1">EHR kood: {data.building.ehrCode || "—"}</div>
            <div>Esmane kasutus: {data.building.firstUseYear || "—"}</div>
            <div>Katastritunnus: {data.building.cadastral || "—"}</div>
            <div>Kasutamise otstarbe pind: {data.building.purposeArea ? `${formatNumberSpaceDot(num(data.building.purposeArea), 2)} m²` : "—"}</div>
            <div>Korruselisus: {data.building.floors || "—"}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="font-semibold">Eelarve kokkuvõte</div>
            <div className="mt-1">Tulud (plaan): {eurot(incomeTotals.plan)}</div>
            <div>Jooksvad kulud (plaan): {eurot(runningTotals.plan)}</div>
            <div>Investeeringud (plaan): {eurot(investTotals.plan)}</div>
            <div className="mt-1 font-semibold">Tulemus: {eurot(budgetResult.plan)}</div>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Kaasomandi eseme seisukord ja kavandatavad tööd</div>

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
            <div className="font-semibold">Kavandatavad tööd</div>
            <div className="font-semibold">Kokku: {eurot(plannedWorksTotal)}</div>
          </div>

          {data.plannedWorks.length ? (
            <ol className="mt-2 list-decimal pl-5">
              {data.plannedWorks.map((w) => (
                <li key={w.id}>
                  <b>{w.desc || "—"}</b> ({w.type}) • {w.period || "—"} • {eurot(w.cost)} • rahastus: {w.funding}
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-2 text-slate-600">Töid ei ole lisatud.</div>
          )}

          {data.notes.worksNotes ? (
            <div className="mt-2 text-slate-700">
              <b>Märkused:</b> {data.notes.worksNotes}
            </div>
          ) : null}
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Hooneosad ja maksed</div>

        <div className="mt-2 text-sm">
          Jaotusbaas (pind):{" "}
          <b>{unitDiagnostics.ok ? `${formatNumberSpaceDot(unitDiagnostics.totalAreaIncluded, 2)} m²` : "—"}</b>
        </div>

        <div className="mt-3 overflow-auto rounded-xl border p-3">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Osa nr</th>
                <th className="py-2 pr-3">Tüüp</th>
                <th className="py-2 pr-3">Pind</th>
                <th className="py-2 pr-3">Osakaal</th>
                <th className="py-2 pr-3">Aastas</th>
                <th className="py-2 pr-3">Kuus</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-2 pr-3">{p.partNo}</td>
                  <td className="py-2 pr-3">{p.type}</td>
                  <td className="py-2 pr-3">{formatNumberSpaceDot(num(p.area), 2)} m²</td>
                  <td className="py-2 pr-3">{pct(p.sharePct, 3)}</td>
                  <td className="py-2 pr-3">{eurot(p.yearTotal)}</td>
                  <td className="py-2 pr-3">{eurot(p.monthTotal)}</td>
                </tr>
              ))}
              {payments.length ? (
                <tr className="border-t bg-slate-50">
                  <td className="py-2 pr-3 font-semibold" colSpan={4}>KOKKU</td>
                  <td className="py-2 pr-3 font-semibold">{eurot(sum(payments, (x) => x.yearTotal))}</td>
                  <td className="py-2 pr-3 font-semibold">{eurot(sum(payments, (x) => x.monthTotal))}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 rounded-xl border p-3 text-sm">
          <div className="font-semibold">Õiguslik märkus</div>
          <div className="mt-1">
            KrtS § 40 lg 1: perioodilised ettemaksed vastavalt kaasomandi osale. Teistsugune jaotus võib tuleneda põhikirjast või kokkuleppest (KrtS § 40 lg 2).
          </div>
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Reservkapital ja remondifond</div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border p-3">
            <div className="font-semibold">Reservkapital (KrtS § 48)</div>
            <div>Alg: {eurot(data.funds.reserveStart)} • Laek: {eurot(data.funds.reserveIn)} • Kasut: {eurot(data.funds.reserveOut)}</div>
            <div className="mt-1 font-semibold">Lõpp: {eurot(fundsDerived.reserveEnd)}</div>
            <div>Miinimum (1/12): {eurot(reserveMinimum)}</div>
            {data.funds.reserveTarget ? <div>Sihttase: {eurot(data.funds.reserveTarget)}</div> : null}
          </div>
          <div className="rounded-xl border p-3">
            <div className="font-semibold">Remondifond (KrtS § 41 lg 1 p 4)</div>
            <div>Alg: {eurot(data.funds.repairStart)} • Laek: {eurot(data.funds.repairIn)}</div>
            <div>Kasutus: tööd {eurot(plannedWorksTotal)} + muu {eurot(data.funds.repairOutOther)}</div>
            <div className="mt-1 font-semibold">Lõpp: {eurot(fundsDerived.repairEnd)}</div>
            <div className="mt-1 text-slate-700">Remondifondi kasutust reguleerib üldkoosolek (KrtS § 41 lg 1 p 4).</div>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Energia prognoos</div>
        <div className="mt-2 rounded-xl border p-3 text-sm">
          <div className="font-semibold">Soojus kokku: {eurot(energyDerived.heatTotal)}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {energyDerived.heatRows.map((r) => (
              <div key={r.id} className="rounded-xl border p-2">
                <div className="text-xs text-slate-600">{r.month}</div>
                <div>
                  {formatNumberSpaceDot(num(r.qtyMWh), 2)} MWh × {formatNumberSpaceDot(num(r.pricePerMWh), 2)} eurot/MWh = <b>{eurot(r.cost)}</b>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 rounded-xl border p-3 text-sm">
          <div className="font-semibold">Elekter/vesi/teenused kokku: {eurot(energyDerived.otherTotal)}</div>
          <ul className="mt-2 list-disc pl-5">
            {energyDerived.otherRows.map((r) => (
              <li key={r.id}>
                {r.label}: {formatNumberSpaceDot(num(r.qty), 2)} {r.unit} × {formatNumberSpaceDot(num(r.price), 2)} eurot = <b>{eurot(r.cost)}</b>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-slate-600">
            Märkus: prognoos on osa majanduskava sisust (KrtS § 41 lg 1 p 5).
          </div>
        </div>
      </div>

      <div className="page">
        <div className="text-lg font-semibold">Majanduskava kinnitus</div>
        <div className="mt-2 rounded-xl border p-3 text-sm">
          <div>Koosoleku liik: {data.confirmation.meetingType || "—"}</div>
          <div>Koosoleku kuupäev: {data.confirmation.meetingDate || "—"}</div>
          <div>Koht / link: {data.confirmation.meetingPlace || "—"}</div>
          <div>Protokoll nr: {data.confirmation.protocolNo || "—"}</div>

          <div className="mt-2">
            Hääled: omanike koguarv {data.confirmation.votesTotalOwners || "—"} / osales {data.confirmation.votesPresent || "—"} / poolt {data.confirmation.votesFor || "—"} / vastu {data.confirmation.votesAgainst || "—"} / erapooletu {data.confirmation.votesAbstain || "—"}
          </div>

          <div className="mt-2">Kehtivus: {data.confirmation.effectiveFrom || "—"} – {data.confirmation.effectiveTo || "—"}</div>
          <div>Tagasiulatuv: {data.confirmation.retroactive || "—"} {data.confirmation.retroactive === "jah" ? `— põhjendus: ${data.confirmation.retroactiveReason || "—"}` : ""}</div>

          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <div className="font-semibold">Otsuse sõnastus</div>
            <div className="mt-1 whitespace-pre-wrap">{data.confirmation.decisionText || "—"}</div>
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <div className="font-semibold">Õiguslik viide</div>
            <div className="mt-1">
              KrtS § 41 lg 3 • TsMS § 369 • VÕS § 82 lg 7
            </div>
          </div>

          <div className="mt-4">
            <div className="font-semibold">Allkirjastamine</div>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <div className="rounded-xl border p-3">
                <div className="text-xs text-slate-600">Kuupäev</div>
                <div className="mt-6 border-t pt-2">__________________________</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-xs text-slate-600">Korteriühistu esindaja</div>
                <div className="mt-6 border-t pt-2">__________________________</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-xs text-slate-600">Allkiri</div>
              <div className="mt-6 border-t pt-2">__________________________</div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            Dokument on koostatud õigusaktide kehtiva redaktsiooni alusel dokumendi koostamise kuupäeva seisuga.
          </div>
        </div>
      </div>
    </div>
  );
}