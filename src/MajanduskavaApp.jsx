import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * SOLVERE MAJANDUSKAVA v2.0
 * - Struktuur 0–7 vastavalt sinu specs'ile
 * - Jaotusbaas: pind (m²) või kaasomandi osa (alternatiiv)
 * - Investeeringud tulevad AINULT planeeritud töödest (samm 2)
 * - Aastapõhine eelarve + kuupõhine rahavoog
 * - Kontrollid + hoiatused (KrtS § 40 lg 2; KrtS § 41 lg 3; KrtS § 48)
 * - Väljundid: Print/PDF (window.print) + JSON export
 *
 * NB! LLM selgitus on UI-plokk: saad hiljem ühendada oma core/LLM teenusega.
 */

// ------------------------- utils -------------------------
const LS_KEY = "solvere_majanduskava_v2_0";

const uid = () => Math.random().toString(36).slice(2, 10);

const num = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const cleaned = String(v).replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Math.round(num(n) * 100) / 100;

function formatNumberSpaceDot(n, digits = 2) {
  const x = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(x)
    .replace(/,/g, " ");
}

const euro = (n) => `${formatNumberSpaceDot(num(n), 2)} €`;

const pct = (n, digits = 2) => `${(Number.isFinite(n) ? n : 0).toFixed(digits)}%`;

function sum(arr, pick = (x) => x) {
  return arr.reduce((acc, it) => acc + num(pick(it)), 0);
}

const MONTHS = [
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
];

// ------------------------- defaults -------------------------
const DEFAULT_SYSTEMS = [
  { id: "roof", label: "Katus", status: "hea" },
  { id: "facade", label: "Fassaad / välisseinad", status: "hea" },
  { id: "heating", label: "Küttesüsteem", status: "hea" },
  { id: "water", label: "Vesi ja kanalisatsioon", status: "hea" },
  { id: "electric", label: "Elektrisüsteem", status: "hea" },
  { id: "vent", label: "Ventilatsioon", status: "hea" },
  { id: "common", label: "Üldruumid / trepikojad", status: "hea" },
];

const DEFAULT_INCOME = [
  { id: "maintenance_fee", label: "Hooldustasu", amount: "" },
  { id: "repair_fund", label: "Remondifond", amount: "" },
  { id: "other_income", label: "Muud tulud", amount: "" },
];

const DEFAULT_RUNNING = [
  { id: "admin", label: "Haldus", amount: "" },
  { id: "insurance", label: "Kindlustus", amount: "" },
  { id: "maintenance", label: "Hooldus", amount: "" },
  { id: "energy_other", label: "Energia (muu kui soojus, nt üldelekter)", amount: "" },
];

const makeEnergyForecast = () => ({
  // aastapõhine energia prognoos (3.2.1)
  consumption: "", // nt kWh või MWh
  unit: "MWh",
  price: "", // €/ühik
  lastYearCost: "", // eelmine aasta energiakulu
});

const makeInitial = () => ({
  // 0. Projekti raam ja staatus
  meta: {
    kuName: "",
    regCode: "",
    address: "",
    fiscalYear: String(new Date().getFullYear()),
    createdAt: new Date().toISOString().slice(0, 10), // yyyy-mm-dd
    createdBy: "",
  },
  status: {
    state: "mustand", // mustand | esitatud | kinnitatud | muudetud
    submittedAt: "",
    approvedAt: "",
    changedAt: "",
    protocolDate: "",
    protocolNo: "",
    protocolRef: "",
  },

  // 1. Jaotusloogika
  allocation: {
    base: "area", // area | coownership
    // vastuolu/põhikiri (KrtS § 40 lg 2)
    bylawsDifferent: "ei", // ei | jah | ei-tea
    bylawsNote: "",
  },
  units: [
    {
      id: uid(),
      partNo: "1",
      type: "Eluruum",
      area: "",
      // kaasomandi osa alternatiivina (lihtsustatud): sisesta murd või osa protsendina
      coOwnershipShare: "", // nt 0.12345 või 12.345 (%), kasutame heuristikat
      owner: "",
      include: true,
    },
    {
      id: uid(),
      partNo: "2",
      type: "Eluruum",
      area: "",
      coOwnershipShare: "",
      owner: "",
      include: true,
    },
  ],

  // 2. Tehniline seisukord ja tööde plaan
  systems: DEFAULT_SYSTEMS,
  works: [
    // tühi by default; jätan näite nulliks
  ],

  // 3. Strateegiline eelarve (aastapõhine)
  budget: {
    income: DEFAULT_INCOME,
    running: DEFAULT_RUNNING,
    energyForecast: makeEnergyForecast(),
    reserve: {
      plannedEnd: "", // planeeritud jääk
      note: "",
    },
  },

  // 4. Operatiivne rahavoog (kuupõhine)
  cashflow: {
    incomePolicy: "even", // even | seasonal
    expensePolicy: "even", // even | seasonal
    // energia hooajaline profiil (sum = 1)
    energyMonthlyWeights: MONTHS.map((m) => ({ id: uid(), month: m, weight: "" })),
  },

  // 5. Maksearvutus
  payments: {
    monthlyPolicy: "even", // even | seasonal
    llm: {
      explanation: "",
      drivers: "",
      scenarios: "",
    },
  },
});

// ------------------------- UI atoms -------------------------
function Section({ title, subtitle, right, children }) {
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

function Input({ value, onChange, placeholder, className = "", type = "text", ...rest }) {
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

function NumberInput({ value, onChange, placeholder, className = "", ...rest }) {
  return (
    <Input
      type="text"
      value={value ?? ""}
      onChange={(v) => {
        if (v === "") return onChange("");
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
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-3 py-2 text-sm font-medium transition ${map[tone]} ${className}`}
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

// ------------------------- main -------------------------
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
  const saveTimer = useRef(null);

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
      { title: "0. Projekti raam ja staatus", subtitle: "Üldandmed + staatuse elutsükkel" },
      { title: "1. Jaotusloogika", subtitle: "Jaotusbaas + hooneosad" },
      { title: "2. Tehniline seisukord ja tööde plaan", subtitle: "Süsteemid + planeeritud tööd" },
      { title: "3. Strateegiline eelarve (aastapõhine)", subtitle: "Tulud, kulud, investeeringud, tulemus, reserv" },
      { title: "4. Operatiivne rahavoog (kuupõhine)", subtitle: "Kuu neto + kumulatiivne saldo" },
      { title: "5. Maksearvutus", subtitle: "Aastane ja kuine makse hooneosade kaupa + LLM selgitus" },
      { title: "6. Kontrollid enne kinnitamist", subtitle: "Kohustuslikud kontrollid + hoiatused" },
      { title: "7. Väljundid", subtitle: "Print/PDF + JSON eksport" },
    ],
    []
  );

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
    if (!confirm("Kas lähtestan kogu majanduskava v2.0? (salvestus kustub)")) return;
    localStorage.removeItem(LS_KEY);
    setData(makeInitial());
    setStep(0);
  };

  const printPdf = () => window.print();

  const exportJson = () => {
    const payload = {
      ...data,
      exportedAt: new Date().toISOString(),
      version: "2.0",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `majanduskava_v2_${data.meta.fiscalYear || "aasta"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ------------------------- derived: status warnings -------------------------
  const statusWarnings = useMemo(() => {
    const w = [];
    if (data.status.state === "kinnitatud") {
      const hasProtocol = (data.status.protocolNo || "").trim() && (data.status.protocolDate || "").trim();
      if (!hasProtocol) {
        w.push("⚠ Hoiatus: kinnitatud ilma protokollita (KrtS § 41 lg 3)");
      }
    }
    return w;
  }, [data.status]);

  // ------------------------- derived: allocation shares -------------------------
  const includedUnits = useMemo(() => data.units.filter((u) => u.include), [data.units]);

  const allocationTotals = useMemo(() => {
    const totalArea = round2(sum(includedUnits, (u) => u.area));
    // coOwnershipShare heuristika:
    // - kui sisestatakse <= 1: käsitleme kui murd (0..1)
    // - kui sisestatakse > 1: käsitleme kui protsent (nt 12.3 => 12.3%)
    const weights = includedUnits.map((u) => {
      const raw = num(u.coOwnershipShare);
      const w = raw <= 1 ? raw : raw / 100;
      return w;
    });
    const totalCo = round2(weights.reduce((a, b) => a + b, 0));
    return { totalArea, totalCo };
  }, [includedUnits]);

  const allocationBaseOk = useMemo(() => {
    if (data.allocation.base === "area") return allocationTotals.totalArea > 0.000001;
    return allocationTotals.totalCo > 0.000001;
  }, [data.allocation.base, allocationTotals]);

  const allocationBylawsWarning = useMemo(() => {
    if (data.allocation.bylawsDifferent === "jah") {
      return "⚠ Hoiatus: põhikirjas või kokkuleppes on teistsugune jaotus (KrtS § 40 lg 2) — kontrolli, kas valitud jaotusbaas on kooskõlas.";
    }
    if (data.allocation.bylawsDifferent === "ei-tea") {
      return "⚠ Hoiatus: jaotuse aluseks olev reegel pole selge (KrtS § 40 lg 2) — soovitus: kontrolli põhikirja/kokkulepet.";
    }
    return "";
  }, [data.allocation.bylawsDifferent]);

  const unitShares = useMemo(() => {
    if (!allocationBaseOk) return [];
    if (data.allocation.base === "area") {
      const total = allocationTotals.totalArea;
      return includedUnits.map((u) => {
        const a = num(u.area);
        const share = total ? a / total : 0;
        return { id: u.id, share, sharePct: share * 100 };
      });
    }
    const weights = includedUnits.map((u) => {
      const raw = num(u.coOwnershipShare);
      const w = raw <= 1 ? raw : raw / 100;
      return { id: u.id, w };
    });
    const total = weights.reduce((acc, x) => acc + x.w, 0);
    return weights.map((x) => {
      const share = total ? x.w / total : 0;
      return { id: x.id, share, sharePct: share * 100 };
    });
  }, [allocationBaseOk, data.allocation.base, allocationTotals, includedUnits]);

  const shareOf = (unitId) => unitShares.find((s) => s.id === unitId)?.share ?? 0;
  const sharePctOf = (unitId) => unitShares.find((s) => s.id === unitId)?.sharePct ?? 0;

  // ------------------------- derived: works & investments -------------------------
  const worksTotal = useMemo(() => round2(sum(data.works, (w) => w.cost)), [data.works]);

  // ------------------------- derived: annual budget -------------------------
  const incomeTotal = useMemo(() => round2(sum(data.budget.income, (r) => r.amount)), [data.budget.income]);
  const runningTotal = useMemo(() => round2(sum(data.budget.running, (r) => r.amount)), [data.budget.running]);

  const energyAnnualCost = useMemo(() => {
    const c = num(data.budget.energyForecast.consumption);
    const p = num(data.budget.energyForecast.price);
    return round2(c * p);
  }, [data.budget.energyForecast]);

  const energyChangePct = useMemo(() => {
    const prev = num(data.budget.energyForecast.lastYearCost);
    const now = energyAnnualCost;
    if (prev <= 0) return null;
    return ((now - prev) / prev) * 100;
  }, [data.budget.energyForecast.lastYearCost, energyAnnualCost]);

  // Strateegiline investeering = ainult planeeritud töödest (samm 2)
  const investmentsTotal = worksTotal;

  // eelarve tulemus (3.4)
  const budgetResult = useMemo(() => {
    const totalCosts = runningTotal + energyAnnualCost + investmentsTotal;
    return round2(incomeTotal - totalCosts);
  }, [incomeTotal, runningTotal, energyAnnualCost, investmentsTotal]);

  // reserv miinimum (KrtS § 48) — sinu spec: 1/12 jooksvatest (st running + energia loogiliselt jooksev)
  const reserveMinimum = useMemo(() => round2((runningTotal + energyAnnualCost) / 12), [runningTotal, energyAnnualCost]);

  const reservePlannedEnd = useMemo(() => num(data.budget.reserve.plannedEnd), [data.budget.reserve.plannedEnd]);

  // ------------------------- derived: monthly cashflow -------------------------
  const energyWeights = useMemo(() => {
    // kui kõik tühjad, teeme lihtsa default profiili: talv kõrgem
    const raw = data.cashflow.energyMonthlyWeights.map((r) => ({ ...r, w: num(r.weight) }));
    const any = raw.some((x) => x.w > 0);
    if (!any) {
      // talv (nov–märts) kõrgem
      const def = MONTHS.map((m) => {
        const winter = ["November", "Detsember", "Jaanuar", "Veebruar", "Märts"].includes(m);
        return winter ? 1.6 : 0.7;
      });
      const total = def.reduce((a, b) => a + b, 0);
      return def.map((x) => x / total);
    }
    const total = raw.reduce((a, b) => a + b.w, 0);
    return raw.map((x) => (total ? x.w / total : 0));
  }, [data.cashflow.energyMonthlyWeights]);

  const monthlyCashflowRows = useMemo(() => {
    // tulu jaotus
    const incomeMonthly = data.cashflow.incomePolicy === "even"
      ? MONTHS.map(() => incomeTotal / 12)
      : MONTHS.map((_, i) => {
          // lihtne hooajaline näide: jaanuar/märts/juuli/oktoober suurem (nt kvartali laekumised)
          const peaks = [0, 2, 6, 9].includes(i);
          return peaks ? incomeTotal * 0.18 : incomeTotal * (1 - 0.18 * 4) / 8;
        });

    // jooksvad kulud kuus
    const runningMonthly = data.cashflow.expensePolicy === "even"
      ? MONTHS.map(() => runningTotal / 12)
      : MONTHS.map((_, i) => {
          // hooajaline: suvel väiksem, talvel suurem (admin/hooldus on tavaliselt ühtlane, aga jätan võimaluse)
          const winter = [0, 1, 2, 10, 11].includes(i);
          return winter ? (runningTotal / 12) * 1.1 : (runningTotal / 12) * 0.93;
        });

    // energia kuude kaupa
    const energyMonthly = MONTHS.map((_, i) => energyAnnualCost * (energyWeights[i] ?? 0));

    // investeeringud: ajastuse alusel (samm 2 tööde ajastus)
    // Ajastus sisestatakse kujul "MM" või "MM-YYYY" või "Jaanuar" jne. Kui ei leia, siis 0 jaotust ei tee.
    const inv = Array(12).fill(0);
    for (const w of data.works) {
      const cost = num(w.cost);
      const t = (w.timing || "").toLowerCase().trim();
      let idx = -1;

      // proovime kuu numbrit
      const m = t.match(/\b(0?[1-9]|1[0-2])\b/);
      if (m) idx = Math.max(0, Math.min(11, Number(m[1]) - 1));

      // proovime kuu nime eesti keeles
      if (idx === -1) {
        const map = {
          jaanuar: 0,
          veebruar: 1,
          märts: 2,
          aprill: 3,
          mai: 4,
          juuni: 5,
          juuli: 6,
          august: 7,
          september: 8,
          oktoober: 9,
          november: 10,
          detsember: 11,
        };
        for (const key of Object.keys(map)) {
          if (t.includes(key)) {
            idx = map[key];
            break;
          }
        }
      }

      if (idx >= 0) inv[idx] += cost;
    }

    let cum = 0;
    return MONTHS.map((m, i) => {
      const inc = round2(incomeMonthly[i]);
      const out = round2(runningMonthly[i] + energyMonthly[i] + inv[i]);
      const net = round2(inc - out);
      cum = round2(cum + net);
      return {
        month: m,
        income: inc,
        expense: out,
        net,
        cumulative: cum,
      };
    });
  }, [data.cashflow.incomePolicy, data.cashflow.expensePolicy, data.works, incomeTotal, runningTotal, energyAnnualCost, energyWeights]);

  const hasNegativeMonth = useMemo(() => monthlyCashflowRows.some((r) => r.net < -0.009), [monthlyCashflowRows]);

  // ------------------------- derived: payment calculation -------------------------
  const annualCostTotal = useMemo(() => round2(runningTotal + energyAnnualCost + investmentsTotal), [runningTotal, energyAnnualCost, investmentsTotal]);

  const unitPaymentRows = useMemo(() => {
    if (!allocationBaseOk) return [];
    return includedUnits.map((u) => {
      const s = shareOf(u.id);
      const yearTotal = round2(annualCostTotal * s);
      const monthTotal = round2(yearTotal / 12);
      const monthRunning = round2(((runningTotal + energyAnnualCost) * s) / 12);
      const monthInvest = round2((investmentsTotal * s) / 12);
      return {
        ...u,
        sharePct: sharePctOf(u.id),
        yearTotal,
        monthTotal,
        monthRunning,
        monthInvest,
      };
    });
  }, [allocationBaseOk, includedUnits, annualCostTotal, runningTotal, energyAnnualCost, investmentsTotal, unitShares]);

  // ------------------------- checks (6) -------------------------
  const checks = useMemo(() => {
    const mandatory = [];
    const warnings = [];

    // Kohustuslikud
    mandatory.push({
      id: "alloc_base",
      label: "Jaotusbaas määratud ja arvutatav",
      ok: allocationBaseOk,
      whyBad: "Valitud jaotusbaasi summa peab olema > 0 (pind või kaasomandi osa).",
    });

    mandatory.push({
      id: "unit_area_exists",
      label: "≥ 1 hooneosa pindalaga",
      ok: data.units.some((u) => num(u.area) > 0),
      whyBad: "Lisa vähemalt ühele hooneosale pind.",
    });

    mandatory.push({
      id: "energy_filled",
      label: "Energia prognoos täidetud",
      ok: num(data.budget.energyForecast.consumption) > 0 && num(data.budget.energyForecast.price) > 0,
      whyBad: "Sisesta tarbimine ja hind (3.2.1).",
    });

    mandatory.push({
      id: "invest_only_from_works",
      label: "Investeeringud ainult töödest",
      ok: true, // meie mudelis investeering = worksTotal, seega alati ok
      whyBad: "",
    });

    // Hoiatused
    if (reservePlannedEnd + 1e-9 < reserveMinimum) {
      warnings.push({
        id: "reserve_low",
        label: "Reserv alla soovitusliku miinimumi",
        text: `Reserv ${euro(reservePlannedEnd)} < miinimum ${euro(reserveMinimum)} (KrtS § 48).`,
      });
    }

    if (budgetResult < -0.009) {
      warnings.push({
        id: "budget_negative",
        label: "Negatiivne eelarve tulemus",
        text: `Tulemus on negatiivne (${euro(budgetResult)}).`,
      });
    }

    if (hasNegativeMonth) {
      warnings.push({
        id: "cashflow_negative_month",
        label: "Negatiivne rahavoog kuus",
        text: "Vähemalt ühes kuus on neto negatiivne.",
      });
    }

    if (data.status.state === "kinnitatud") {
      const hasProtocol = (data.status.protocolNo || "").trim() && (data.status.protocolDate || "").trim();
      if (!hasProtocol) {
        warnings.push({
          id: "approved_without_protocol",
          label: "Kinnitatud ilma protokollita",
          text: "KrtS § 41 lg 3: kinnitamine peaks olema protokollitud (kuupäev + number).",
        });
      }
    }

    if (allocationBylawsWarning) {
      warnings.push({
        id: "bylaws_warning",
        label: "Jaotus võib olla vastuolus põhikirjaga",
        text: allocationBylawsWarning.replace(/^⚠\s*/, ""),
      });
    }

    return { mandatory, warnings };
  }, [
    allocationBaseOk,
    data.units,
    data.budget.energyForecast,
    reservePlannedEnd,
    reserveMinimum,
    budgetResult,
    hasNegativeMonth,
    data.status,
    allocationBylawsWarning,
  ]);

  const blockingErrors = useMemo(() => checks.mandatory.filter((x) => !x.ok), [checks.mandatory]);

  const topBadges = useMemo(() => {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={budgetResult >= 0 ? "ok" : "bad"}>Eelarve tulemus: {euro(budgetResult)}</Pill>
        <Pill tone={reservePlannedEnd + 1e-9 < reserveMinimum ? "warn" : "ok"}>
          Reserv: {euro(reservePlannedEnd)} • miin {euro(reserveMinimum)}
        </Pill>
        <Pill tone={allocationBaseOk ? "ok" : "warn"}>
          Jaotusbaas:{" "}
          {data.allocation.base === "area"
            ? allocationTotals.totalArea > 0
              ? `${formatNumberSpaceDot(allocationTotals.totalArea, 2)} m²`
              : "—"
            : allocationTotals.totalCo > 0
            ? `${pct(allocationTotals.totalCo * 100, 3)} (sum)`
            : "—"}
        </Pill>
      </div>
    );
  }, [budgetResult, reservePlannedEnd, reserveMinimum, allocationBaseOk, data.allocation.base, allocationTotals]);

  // ------------------------- render -------------------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .page { break-inside: avoid; }
          a[href]:after { content: ""; }
        }
      `}</style>

      <div className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">🏛 SOLVERE MAJANDUSKAVA v2.0</div>
            <div className="text-xs text-slate-600">
              Struktureeritud eelarve • rahavoog • maksearvutus • kontrollid • PDF/JSON
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Btn tone="ghost" onClick={printPdf}>Prindi / salvesta PDF</Btn>
            <Btn tone="ghost" onClick={exportJson}>Ekspordi JSON</Btn>
            <Btn tone="ghost" onClick={resetAll}>Lähtesta</Btn>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-6 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <div className="no-print space-y-3">
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">Navigeerimine</div>
            <div className="mt-1 text-xs text-slate-600">Sammud 0–7</div>

            <div className="mt-4 space-y-1">
              {steps.map((s, i) => {
                const active = i === step;
                const blocked = i === 6 ? false : false; // samm 6 on kontroll, mitte sisestuse blokeerija
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
                      <div className="font-medium">{s.title}</div>
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

          {statusWarnings.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-semibold">Staatus</div>
              <ul className="mt-1 list-disc pl-5">
                {statusWarnings.map((x, idx) => <li key={idx}>{x}</li>)}
              </ul>
            </div>
          ) : null}

          {blockingErrors.length ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <div className="font-semibold">Blokeerivad puudused</div>
              <ul className="mt-1 list-disc pl-5">
                {blockingErrors.map((x) => <li key={x.id}>{x.label}: {x.whyBad}</li>)}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Main */}
        <div className="space-y-4">
          <div className="no-print">
            <h1 className="text-xl font-semibold">{steps[step].title}</h1>
            <p className="text-sm text-slate-600">{steps[step].subtitle}</p>
          </div>

          {step === 0 && <Page0 meta={data.meta} status={data.status} update={update} />}
          {step === 1 && (
            <Page1
              allocation={data.allocation}
              units={data.units}
              update={update}
              updateRow={updateRow}
              addRow={addRow}
              removeRow={removeRow}
              allocationTotals={allocationTotals}
              allocationBaseOk={allocationBaseOk}
              allocationBylawsWarning={allocationBylawsWarning}
              unitPaymentPreview={unitPaymentRows}
              sharePctOf={sharePctOf}
            />
          )}
          {step === 2 && (
            <Page2
              systems={data.systems}
              works={data.works}
              updateRow={updateRow}
              addRow={addRow}
              removeRow={removeRow}
              worksTotal={worksTotal}
            />
          )}
          {step === 3 && (
            <Page3
              budget={data.budget}
              works={data.works}
              update={update}
              updateRow={updateRow}
              addRow={addRow}
              removeRow={removeRow}
              incomeTotal={incomeTotal}
              runningTotal={runningTotal}
              energyAnnualCost={energyAnnualCost}
              energyChangePct={energyChangePct}
              investmentsTotal={investmentsTotal}
              budgetResult={budgetResult}
              reserveMinimum={reserveMinimum}
            />
          )}
          {step === 4 && (
            <Page4
              cashflow={data.cashflow}
              budget={data.budget}
              works={data.works}
              incomeTotal={incomeTotal}
              runningTotal={runningTotal}
              energyAnnualCost={energyAnnualCost}
              investmentsTotal={investmentsTotal}
              energyWeights={energyWeights}
              monthlyRows={monthlyCashflowRows}
              update={update}
              updateRow={updateRow}
            />
          )}
          {step === 5 && (
            <Page5
              allocation={data.allocation}
              payments={data.payments}
              units={data.units}
              allocationBaseOk={allocationBaseOk}
              allocationTotals={allocationTotals}
              unitRows={unitPaymentRows}
              annualCostTotal={annualCostTotal}
              runningAnnual={runningTotal + energyAnnualCost}
              investAnnual={investmentsTotal}
              update={update}
            />
          )}
          {step === 6 && <Page6 checks={checks} />}
          {step === 7 && (
            <Page7
              data={data}
              printPdf={printPdf}
              exportJson={exportJson}
              checks={checks}
            />
          )}

          {/* Bottom navigation */}
          <div className="no-print sticky bottom-4 z-10">
            <div className="rounded-2xl border bg-white/90 p-3 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <Btn tone="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                  Tagasi
                </Btn>
                <div className="text-xs text-slate-600">
                  Samm {step + 1} / {steps.length}
                </div>
                <Btn tone="primary" onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))} disabled={step === steps.length - 1}>
                  Edasi
                </Btn>
              </div>
            </div>
          </div>

          {/* Print-only: lihtne koond */}
          <div className="print-only hidden">
            <PrintSummaryV2
              data={data}
              incomeTotal={incomeTotal}
              runningTotal={runningTotal}
              energyAnnualCost={energyAnnualCost}
              investmentsTotal={investmentsTotal}
              budgetResult={budgetResult}
              reserveMinimum={reserveMinimum}
              unitPaymentRows={unitPaymentRows}
              monthlyRows={monthlyCashflowRows}
              checks={checks}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------- Pages -------------------------

function Page0({ meta, status, update }) {
  const statusOptions = [
    { value: "mustand", label: "Mustand" },
    { value: "esitatud", label: "Esitatud" },
    { value: "kinnitatud", label: "Kinnitatud" },
    { value: "muudetud", label: "Muudetud" },
  ];

  return (
    <div className="space-y-4">
      <Section title="0.1 Üldandmed" subtitle="KÜ nimi, registrikood, aadress + majandusaasta ja koostamise info">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>KÜ nimi</Label>
            <Input value={meta.kuName} onChange={(v) => update("meta.kuName", v)} placeholder="nt KÜ Päikese 12" />
          </div>
          <div>
            <Label>Registrikood</Label>
            <Input value={meta.regCode} onChange={(v) => update("meta.regCode", v)} placeholder="nt 12345678" />
          </div>
          <div>
            <Label>Aadress</Label>
            <Input value={meta.address} onChange={(v) => update("meta.address", v)} placeholder="nt Päikese tn 12, Tallinn" />
          </div>
          <div>
            <Label>Majandusaasta</Label>
            <Input value={meta.fiscalYear} onChange={(v) => update("meta.fiscalYear", v)} placeholder="2026" />
          </div>
          <div>
            <Label>Koostamise kuupäev</Label>
            <Input value={meta.createdAt} onChange={(v) => update("meta.createdAt", v)} placeholder="yyyy-mm-dd" />
          </div>
          <div className="md:col-span-2">
            <Label>Koostaja</Label>
            <Input value={meta.createdBy} onChange={(v) => update("meta.createdBy", v)} placeholder="nimi / roll / kontakt" />
          </div>
        </div>
      </Section>

      <Section
        title="0.2 Staatus"
        subtitle="Mustand → Esitatud → Kinnitatud → Muudetud. Kinnitamisel lisa protokolli kuupäev ja number."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label>Staatus</Label>
            <Select value={status.state} onChange={(v) => update("status.state", v)} options={statusOptions} />
          </div>
          <div>
            <Label>Esitatud (kuupäev)</Label>
            <Input value={status.submittedAt} onChange={(v) => update("status.submittedAt", v)} placeholder="yyyy-mm-dd" />
          </div>
          <div>
            <Label>Kinnitatud (kuupäev)</Label>
            <Input value={status.approvedAt} onChange={(v) => update("status.approvedAt", v)} placeholder="yyyy-mm-dd" />
          </div>
          <div>
            <Label>Muudetud (kuupäev)</Label>
            <Input value={status.changedAt} onChange={(v) => update("status.changedAt", v)} placeholder="yyyy-mm-dd" />
          </div>
          <div>
            <Label>Protokolli kuupäev</Label>
            <Input value={status.protocolDate} onChange={(v) => update("status.protocolDate", v)} placeholder="yyyy-mm-dd" />
          </div>
          <div>
            <Label>Protokolli number</Label>
            <Input value={status.protocolNo} onChange={(v) => update("status.protocolNo", v)} placeholder="nt 3-2026" />
          </div>
          <div className="md:col-span-2">
            <Label>Viide (link / fail / kirjeldus)</Label>
            <Input value={status.protocolRef} onChange={(v) => update("status.protocolRef", v)} placeholder="nt dokumendi viide" />
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-semibold">Õiguslik märkus</div>
          <div className="mt-1">Kui majanduskava on kinnitatud, peab see olema protokollitud (KrtS § 41 lg 3).</div>
        </div>
      </Section>
    </div>
  );
}

function Page1({
  allocation,
  units,
  update,
  updateRow,
  addRow,
  removeRow,
  allocationTotals,
  allocationBaseOk,
  allocationBylawsWarning,
  unitPaymentPreview,
  sharePctOf,
}) {
  return (
    <div className="space-y-4">
      <Section title="1.1 Jaotusbaas" subtitle="Vali jaotusbaas: pind (vaikimisi) või kaasomandi osa (alternatiiv).">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label>Jaotusbaas</Label>
            <Select
              value={allocation.base}
              onChange={(v) => update("allocation.base", v)}
              options={[
                { value: "area", label: "Pind (m²) — vaikimisi" },
                { value: "coownership", label: "Kaasomandi osa — alternatiiv" },
              ]}
            />
          </div>
          <div>
            <Label>Põhikirjas/kokkuleppes teistsugune jaotus? (KrtS § 40 lg 2)</Label>
            <Select
              value={allocation.bylawsDifferent}
              onChange={(v) => update("allocation.bylawsDifferent", v)}
              options={[
                { value: "ei", label: "Ei" },
                { value: "jah", label: "Jah" },
                { value: "ei-tea", label: "Ei tea" },
              ]}
            />
          </div>
          <div>
            <Label>Märkus (valikuline)</Label>
            <Input value={allocation.bylawsNote} onChange={(v) => update("allocation.bylawsNote", v)} placeholder="selgitus / viide" />
          </div>
        </div>

        {allocationBylawsWarning ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {allocationBylawsWarning}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone={allocationBaseOk ? "ok" : "warn"}>
            {allocation.base === "area"
              ? `Pindade summa (arvestuses): ${formatNumberSpaceDot(allocationTotals.totalArea, 2)} m²`
              : `Kaasomandi osade summa (arvestuses): ${pct(allocationTotals.totalCo * 100, 3)}`}
          </Pill>
        </div>
      </Section>

      <Section
        title="1.2 Hooneosad"
        subtitle="Osa nr, tüüp, pind, % osakaal, omanik. Valitud jaotusbaasi järgi arvutatakse osakaal automaatselt."
        right={
          <Btn
            tone="ghost"
            onClick={() =>
              addRow("units", {
                id: uid(),
                partNo: String(units.length + 1),
                type: "Eluruum",
                area: "",
                coOwnershipShare: "",
                owner: "",
                include: true,
              })
            }
          >
            + Lisa hooneosa
          </Btn>
        }
      >
        <div className="overflow-auto">
          <table className="min-w-[1200px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Osa nr</th>
                <th className="py-2 pr-3">Tüüp</th>
                <th className="py-2 pr-3">Pind (m²)</th>
                <th className="py-2 pr-3">Kaasomandi osa (alt)</th>
                <th className="py-2 pr-3">% osakaal</th>
                <th className="py-2 pr-3">Omanik</th>
                <th className="py-2 pr-3">Arvestuses</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="py-2 pr-3">
                    <Input value={u.partNo} onChange={(v) => updateRow("units", u.id, { partNo: v })} className="max-w-[90px]" />
                  </td>
                  <td className="py-2 pr-3">
                    <Select
                      value={u.type}
                      onChange={(v) => updateRow("units", u.id, { type: v })}
                      options={[
                        { value: "Eluruum", label: "Eluruum" },
                        { value: "Mitteeluruum", label: "Mitteeluruum" },
                        { value: "Üldpind", label: "Üldpind" },
                        { value: "Tehnopind", label: "Tehnopind" },
                      ]}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={u.area} onChange={(v) => updateRow("units", u.id, { area: v })} placeholder="nt 64.60" className="max-w-[160px]" />
                  </td>
                  <td className="py-2 pr-3">
                    <NumberInput value={u.coOwnershipShare} onChange={(v) => updateRow("units", u.id, { coOwnershipShare: v })} placeholder="nt 0.123 või 12.3" className="max-w-[160px]" />
                  </td>
                  <td className="py-2 pr-3 font-medium">{pct(sharePctOf(u.id), 3)}</td>
                  <td className="py-2 pr-3">
                    <Input value={u.owner} onChange={(v) => updateRow("units", u.id, { owner: v })} placeholder="valikuline" />
                  </td>
                  <td className="py-2 pr-3">
                    <Select
                      value={u.include ? "jah" : "ei"}
                      onChange={(v) => updateRow("units", u.id, { include: v === "jah" })}
                      options={[
                        { value: "jah", label: "Jah" },
                        { value: "ei", label: "Ei" },
                      ]}
                      className="max-w-[120px]"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Btn tone="danger" onClick={() => removeRow("units", u.id)}>Kustuta</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!allocationBaseOk ? (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            ⚠ Jaotusbaasi summa peab olema &gt; 0 (sisesta pind või kaasomandi osad ja vali arvestuses olevad hooneosad).
          </div>
        ) : null}

        {allocationBaseOk && unitPaymentPreview.length ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <div className="font-semibold">Kiirvaade</div>
            <div className="mt-1">Osakaalud arvutatakse automaatselt ja neid kasutatakse maksete jaotamisel (samm 5).</div>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function Page2({ systems, works, updateRow, addRow, removeRow, worksTotal }) {
  const statusOptions = [
    { value: "hea", label: "Hea" },
    { value: "hooldus", label: "Hooldus" },
    { value: "remont", label: "Remont" },
    { value: "kaasajastamine", label: "Kaasajastamine" },
  ];

  const priorityOptions = [
    { value: "korge", label: "Kõrge" },
    { value: "keskmine", label: "Keskmine" },
    { value: "madal", label: "Madal" },
  ];

  const fundingOptions = [
    { value: "jooksev", label: "Jooksev" },
    { value: "remondifond", label: "Remondifond" },
    { value: "reserv", label: "Reserv" },
    { value: "laen", label: "Laen" },
    { value: "toetus", label: "Toetus" },
  ];

  return (
    <div className="space-y-4">
      <Section title="2.1 Süsteemide seisukord" subtitle="Hea / Hooldus / Remont / Kaasajastamine">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {systems.map((s) => (
            <div key={s.id} className="rounded-2xl border p-3">
              <div className="text-sm font-medium">{s.label}</div>
              <div className="mt-2">
                <Label>Seisukord</Label>
                <Select value={s.status} onChange={(v) => updateRow("systems", s.id, { status: v })} options={statusOptions} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="2.2 Planeeritud tööd"
        subtitle="Nimi, süsteem, prioriteet, ajastus, maksumus, rahastusallikas"
        right={<Pill tone="info">Kokku: {euro(worksTotal)}</Pill>}
      >
        {works.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            Töid pole lisatud. Investeeringute summa (samm 3.3) tekib ainult siit.
          </div>
        ) : null}

        <div className="space-y-3">
          {works.map((w) => (
            <div key={w.id} className="rounded-2xl border p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="md:col-span-2">
                  <Label>Nimi</Label>
                  <Input value={w.name} onChange={(v) => updateRow("works", w.id, { name: v })} placeholder="nt Trepikoja värvimine" />
                </div>
                <div>
                  <Label>Süsteem</Label>
                  <Input value={w.system} onChange={(v) => updateRow("works", w.id, { system: v })} placeholder="nt Üldruumid" />
                </div>
                <div>
                  <Label>Prioriteet</Label>
                  <Select value={w.priority} onChange={(v) => updateRow("works", w.id, { priority: v })} options={priorityOptions} />
                </div>
                <div>
                  <Label>Ajastus</Label>
                  <Input value={w.timing} onChange={(v) => updateRow("works", w.id, { timing: v })} placeholder="nt 04.2026 / Aprill / 4" />
                </div>
                <div>
                  <Label>Maksumus</Label>
                  <NumberInput value={w.cost} onChange={(v) => updateRow("works", w.id, { cost: v })} placeholder="0.00" />
                </div>
                <div>
                  <Label>Rahastus</Label>
                  <Select value={w.funding} onChange={(v) => updateRow("works", w.id, { funding: v })} options={fundingOptions} />
                </div>
                <div className="md:col-span-6 flex justify-end">
                  <Btn tone="danger" onClick={() => removeRow("works", w.id)}>Kustuta</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <Btn
            tone="ghost"
            onClick={() =>
              addRow("works", {
                id: uid(),
                name: "",
                system: "",
                priority: "keskmine",
                timing: "",
                cost: "",
                funding: "remondifond",
              })
            }
          >
            + Lisa töö
          </Btn>
        </div>
      </Section>

      <Section title="2.3 Kokkuvõte" subtitle="Summa, arv, aastate jaotus (lihtsustatud)">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Tööde arv</div>
            <div className="text-lg font-semibold">{works.length}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Tööde summa</div>
            <div className="text-lg font-semibold">{euro(worksTotal)}</div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Märkus</div>
            <div className="text-sm text-slate-700">Aastate jaotus tuleb rahavoos ajastuse kaudu (samm 4).</div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Page3({
  budget,
  works,
  update,
  updateRow,
  addRow,
  removeRow,
  incomeTotal,
  runningTotal,
  energyAnnualCost,
  energyChangePct,
  investmentsTotal,
  budgetResult,
  reserveMinimum,
}) {
  return (
    <div className="space-y-4">
      <Section title="3.1 Tulud" subtitle="Hooldustasu, remondifond, muud">
        <SimpleMoneyTable
          rows={budget.income}
          onChangeRow={(id, patch) => updateRow("budget.income", id, patch)}
          onAdd={() => addRow("budget.income", { id: uid(), label: "", amount: "" })}
          onRemove={(id) => removeRow("budget.income", id)}
        />
        <div className="mt-3 flex gap-2">
          <Pill tone="info">Tulud kokku: {euro(incomeTotal)}</Pill>
        </div>
      </Section>

      <Section title="3.2 Jooksvad kulud" subtitle="Haldus, kindlustus, hooldus, energia">
        <SimpleMoneyTable
          rows={budget.running}
          onChangeRow={(id, patch) => updateRow("budget.running", id, patch)}
          onAdd={() => addRow("budget.running", { id: uid(), label: "", amount: "" })}
          onRemove={(id) => removeRow("budget.running", id)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone="info">Jooksvad kulud kokku: {euro(runningTotal)}</Pill>
        </div>
      </Section>

      <Section title="3.2.1 Energia prognoos" subtitle="Tarbimine, hind, aastakulu, muutus %">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label>Tarbimine</Label>
            <NumberInput
              value={budget.energyForecast.consumption}
              onChange={(v) => update("budget.energyForecast.consumption", v)}
              placeholder="nt 120"
            />
          </div>
          <div>
            <Label>Ühik</Label>
            <Select
              value={budget.energyForecast.unit}
              onChange={(v) => update("budget.energyForecast.unit", v)}
              options={[
                { value: "MWh", label: "MWh" },
                { value: "kWh", label: "kWh" },
                { value: "m³", label: "m³" },
              ]}
            />
          </div>
          <div>
            <Label>Hind (€/ühik)</Label>
            <NumberInput
              value={budget.energyForecast.price}
              onChange={(v) => update("budget.energyForecast.price", v)}
              placeholder="nt 85"
            />
          </div>
          <div>
            <Label>Eelmine aasta energiakulu (€)</Label>
            <NumberInput
              value={budget.energyForecast.lastYearCost}
              onChange={(v) => update("budget.energyForecast.lastYearCost", v)}
              placeholder="nt 8000"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone="info">Aastakulu: {euro(energyAnnualCost)}</Pill>
          <Pill tone={energyChangePct === null ? "neutral" : energyChangePct >= 0 ? "warn" : "ok"}>
            Muutus: {energyChangePct === null ? "—" : pct(energyChangePct, 1)}
          </Pill>
        </div>
      </Section>

      <Section
        title="3.3 Investeeringud"
        subtitle="Ainult planeeritud töödest (samm 2)."
        right={<Pill tone="info">Investeeringud kokku: {euro(investmentsTotal)}</Pill>}
      >
        {works.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">Planeeritud töid pole — investeeringud on 0.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="text-left text-xs text-slate-600">
                <tr>
                  <th className="py-2 pr-3">Nimi</th>
                  <th className="py-2 pr-3">Süsteem</th>
                  <th className="py-2 pr-3">Ajastus</th>
                  <th className="py-2 pr-3">Maksumus</th>
                  <th className="py-2 pr-3">Rahastus</th>
                </tr>
              </thead>
              <tbody>
                {works.map((w) => (
                  <tr key={w.id} className="border-t">
                    <td className="py-2 pr-3">{w.name || "—"}</td>
                    <td className="py-2 pr-3">{w.system || "—"}</td>
                    <td className="py-2 pr-3">{w.timing || "—"}</td>
                    <td className="py-2 pr-3 font-medium">{euro(w.cost)}</td>
                    <td className="py-2 pr-3">{w.funding || "—"}</td>
                  </tr>
                ))}
                <tr className="border-t bg-slate-50">
                  <td className="py-2 pr-3 font-semibold" colSpan={3}>KOKKU</td>
                  <td className="py-2 pr-3 font-semibold">{euro(investmentsTotal)}</td>
                  <td className="py-2 pr-3"></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="3.4 Eelarve tulemus" subtitle="Tulud – kulud – investeeringud = tulemus">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Kpi label="Tulud" value={euro(incomeTotal)} />
          <Kpi label="Jooksvad kulud" value={euro(runningTotal + energyAnnualCost)} />
          <Kpi label="Investeeringud" value={euro(investmentsTotal)} />
          <div className="rounded-2xl border bg-slate-50 p-3">
            <div className="text-xs text-slate-600">Tulemus</div>
            <div className="text-lg font-semibold">{euro(budgetResult)}</div>
            <div className="mt-1">
              <Pill tone={budgetResult >= 0 ? "ok" : "bad"}>
                {budgetResult >= 0 ? "Ülejääk" : "Puudujääk"}
              </Pill>
              {budgetResult < -0.009 ? (
                <div className="mt-2 text-xs text-rose-700">⚠ Hoiatus: negatiivne tulemus.</div>
              ) : null}
            </div>
          </div>
        </div>
      </Section>

      <Section title="3.5 Reserv (KrtS § 48)" subtitle="Soovituslik miinimum 1/12 jooksvatest. Planeeritud jääk + hoiatus alla miinimumi.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Kpi label="Soovituslik miinimum (1/12)" value={euro(reserveMinimum)} />
          <div>
            <Label>Planeeritud jääk</Label>
            <NumberInput value={budget.reserve.plannedEnd} onChange={(v) => update("budget.reserve.plannedEnd", v)} placeholder="0.00" />
            {num(budget.reserve.plannedEnd) + 1e-9 < reserveMinimum ? (
              <div className="mt-1 text-xs text-amber-800">⚠ Hoiatus: alla miinimumi.</div>
            ) : null}
          </div>
          <div>
            <Label>Märkus (valikuline)</Label>
            <Input value={budget.reserve.note} onChange={(v) => update("budget.reserve.note", v)} placeholder="nt miks ajutiselt alla miinimumi" />
          </div>
        </div>
      </Section>
    </div>
  );
}

function Page4({
  cashflow,
  budget,
  works,
  incomeTotal,
  runningTotal,
  energyAnnualCost,
  investmentsTotal,
  energyWeights,
  monthlyRows,
  update,
  updateRow,
}) {
  return (
    <div className="space-y-4">
      <Section title="4.1 Tulude jaotus" subtitle="Ühtlane või hooajaline">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Tulude jaotus</Label>
            <Select
              value={cashflow.incomePolicy}
              onChange={(v) => update("cashflow.incomePolicy", v)}
              options={[
                { value: "even", label: "Ühtlane (12 kuud)" },
                { value: "seasonal", label: "Hooajaline (lihtsustatud)" },
              ]}
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <div className="font-semibold">Infoks</div>
            <div className="mt-1">Hooajaline on praegu lihtsustatud mudel — saad hiljem teha täpse profiili (nt määrata kuu kaupa).</div>
          </div>
        </div>
      </Section>

      <Section title="4.2 Kulude jaotus" subtitle="Jooksvad kulud kuus, energia hooajaline profiil, investeeringud ajastuse alusel">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Jooksvate kulude jaotus</Label>
            <Select
              value={cashflow.expensePolicy}
              onChange={(v) => update("cashflow.expensePolicy", v)}
              options={[
                { value: "even", label: "Ühtlane" },
                { value: "seasonal", label: "Hooajaline (lihtsustatud)" },
              ]}
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <div className="font-semibold">Investeeringud</div>
            <div className="mt-1">Investeeringud jaotatakse tööde ajastuse järgi (samm 2: ajastus).</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm font-semibold">Energia hooajaline profiil (kaalud)</div>
          <div className="mt-2 overflow-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="text-left text-xs text-slate-600">
                <tr>
                  <th className="py-2 pr-3">Kuu</th>
                  <th className="py-2 pr-3">Kaal (valikuline)</th>
                  <th className="py-2 pr-3">Kasutatav osakaal</th>
                </tr>
              </thead>
              <tbody>
                {cashflow.energyMonthlyWeights.map((r, i) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-3">{r.month}</td>
                    <td className="py-2 pr-3">
                      <NumberInput
                        value={r.weight}
                        onChange={(v) => updateRow("cashflow.energyMonthlyWeights", r.id, { weight: v })}
                        placeholder="nt 1.5"
                        className="max-w-[140px]"
                      />
                    </td>
                    <td className="py-2 pr-3">{pct((energyWeights[i] ?? 0) * 100, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            Kui jätad kõik kaalud tühjaks, kasutatakse vaikimisi talve-kõrgemat profiili.
          </div>
        </div>
      </Section>

      <Section title="4.3 Rahavoo tabel" subtitle="Kuu | Sissetulek | Väljaminek | Neto | Kumulatiivne (hoiatus negatiivse kuu korral)">
        <div className="flex flex-wrap gap-2">
          <Pill tone="info">Aasta tulud: {euro(incomeTotal)}</Pill>
          <Pill tone="info">Aasta kulud (jooksev+energia): {euro(runningTotal + energyAnnualCost)}</Pill>
          <Pill tone="info">Aasta investeeringud: {euro(investmentsTotal)}</Pill>
        </div>

        <div className="mt-3 overflow-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Kuu</th>
                <th className="py-2 pr-3">Sissetulek</th>
                <th className="py-2 pr-3">Väljaminek</th>
                <th className="py-2 pr-3">Neto</th>
                <th className="py-2 pr-3">Kumulatiivne</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map((r) => (
                <tr key={r.month} className="border-t">
                  <td className="py-2 pr-3">{r.month}</td>
                  <td className="py-2 pr-3">{euro(r.income)}</td>
                  <td className="py-2 pr-3">{euro(r.expense)}</td>
                  <td className="py-2 pr-3 font-medium">
                    <span className={r.net < -0.009 ? "text-rose-700" : ""}>{euro(r.net)}</span>
                    {r.net < -0.009 ? <span className="ml-2 text-xs text-rose-700">⚠</span> : null}
                  </td>
                  <td className="py-2 pr-3">{euro(r.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {monthlyRows.some((r) => r.net < -0.009) ? (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            ⚠ Hoiatus: vähemalt ühes kuus on rahavoog negatiivne.
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function Page5({
  allocation,
  payments,
  units,
  allocationBaseOk,
  allocationTotals,
  unitRows,
  annualCostTotal,
  runningAnnual,
  investAnnual,
  update,
}) {
  return (
    <div className="space-y-4">
      <Section title="5.1 Aastane makse hooneosa kohta" subtitle="Jooksev + investeering = kokku">
        <div className="flex flex-wrap gap-2">
          <Pill tone="info">Aastane jooksev (sh energia): {euro(runningAnnual)}</Pill>
          <Pill tone="info">Aastane invest: {euro(investAnnual)}</Pill>
          <Pill tone="info">Aastane kokku: {euro(annualCostTotal)}</Pill>
        </div>

        {!allocationBaseOk ? (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            ⚠ Maksearvutuseks peab jaotusbaas olema arvutatav (samm 1).
          </div>
        ) : null}
      </Section>

      <Section title="5.2 Kuumakse" subtitle="Ühtlane või hooajaline poliitika (UI placeholder)">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Poliitika</Label>
            <Select
              value={payments.monthlyPolicy}
              onChange={(v) => update("payments.monthlyPolicy", v)}
              options={[
                { value: "even", label: "Ühtlane kuumakse" },
                { value: "seasonal", label: "Hooajaline (tulevikus detailne)" },
              ]}
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            Hooajalise kuumakse loogika on lihtsustatud — soovitus: seosta rahavooga (samm 4) või lisa kuu kaupa reeglid.
          </div>
        </div>
      </Section>

      <Section title="5.3 Hooneosade kaupa" subtitle={`Osa | pind | % | jooksev/kuu | invest/kuu | kokku • jaotusbaas: ${allocation.base}`}>
        <div className="overflow-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Osa</th>
                <th className="py-2 pr-3">Pind</th>
                <th className="py-2 pr-3">% osakaal</th>
                <th className="py-2 pr-3">Jooksev/kuu</th>
                <th className="py-2 pr-3">Invest/kuu</th>
                <th className="py-2 pr-3">Kokku/kuu</th>
                <th className="py-2 pr-3">Aastas</th>
              </tr>
            </thead>
            <tbody>
              {unitRows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3">{r.partNo}</td>
                  <td className="py-2 pr-3">{formatNumberSpaceDot(num(r.area), 2)} m²</td>
                  <td className="py-2 pr-3 font-medium">{pct(r.sharePct, 3)}</td>
                  <td className="py-2 pr-3">{euro(r.monthRunning)}</td>
                  <td className="py-2 pr-3">{euro(r.monthInvest)}</td>
                  <td className="py-2 pr-3 font-medium">{euro(r.monthTotal)}</td>
                  <td className="py-2 pr-3 font-medium">{euro(r.yearTotal)}</td>
                </tr>
              ))}
              {allocationBaseOk && unitRows.length ? (
                <tr className="border-t bg-slate-50">
                  <td className="py-2 pr-3 font-semibold" colSpan={3}>KOKKU</td>
                  <td className="py-2 pr-3 font-semibold">{euro(sum(unitRows, (x) => x.monthRunning))}</td>
                  <td className="py-2 pr-3 font-semibold">{euro(sum(unitRows, (x) => x.monthInvest))}</td>
                  <td className="py-2 pr-3 font-semibold">{euro(sum(unitRows, (x) => x.monthTotal))}</td>
                  <td className="py-2 pr-3 font-semibold">{euro(sum(unitRows, (x) => x.yearTotal))}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {allocation.base === "coownership" ? (
          <div className="mt-3 text-xs text-slate-600">
            Märkus: kaasomandi osa sisendit käsitletakse kas murdosana (≤ 1) või protsendina (&gt; 1).
          </div>
        ) : (
          <div className="mt-3 text-xs text-slate-600">
            Märkus: pindade summa (arvestuses) = {formatNumberSpaceDot(allocationTotals.totalArea, 2)} m².
          </div>
        )}
      </Section>

      <Section title="5.4 LLM selgitus (v2.0 uus)" subtitle="Miks selline makse • suurimad mõjurid • 3 parandusstsenaariumi">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-3">
            <Label>Miks selline makse (selgitus)</Label>
            <textarea
              value={payments.llm.explanation}
              onChange={(e) => update("payments.llm.explanation", e.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2"
              rows={4}
              placeholder="LLM või analüütiline kokkuvõte..."
            />
          </div>
          <div className="md:col-span-3">
            <Label>Suurimad mõjurid</Label>
            <textarea
              value={payments.llm.drivers}
              onChange={(e) => update("payments.llm.drivers", e.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2"
              rows={3}
              placeholder="nt energia prognoos, tööde ajastus, reservi eesmärk..."
            />
          </div>
          <div className="md:col-span-3">
            <Label>3 parandusstsenaariumi</Label>
            <textarea
              value={payments.llm.scenarios}
              onChange={(e) => update("payments.llm.scenarios", e.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-200 focus:ring-2"
              rows={4}
              placeholder="1) ... 2) ... 3) ..."
            />
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-semibold">Soovitus integratsiooniks</div>
          <div className="mt-1">
            Siia saad ühendada Solvere tuuma / LLM-i, mis loeb eelarve, rahavoo ja tööde plaani ning kirjutab põhjenduse + parandusvariandid.
          </div>
        </div>
      </Section>
    </div>
  );
}

function Page6({ checks }) {
  return (
    <div className="space-y-4">
      <Section title="6. Kontrollid enne kinnitamist" subtitle="Kohustuslikud kontrollid + hoiatused">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border p-3">
            <div className="text-sm font-semibold">Kohustuslikud</div>
            <ul className="mt-2 space-y-2 text-sm">
              {checks.mandatory.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 rounded-xl bg-slate-50 p-2">
                  <span>
                    {c.ok ? "✅ " : "⛔ "} {c.label}
                    {!c.ok ? <div className="mt-1 text-xs text-rose-700">{c.whyBad}</div> : null}
                  </span>
                  <Pill tone={c.ok ? "ok" : "bad"}>{c.ok ? "OK" : "Puudub"}</Pill>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border p-3">
            <div className="text-sm font-semibold">Hoiatused</div>
            {checks.warnings.length === 0 ? (
              <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">Hoiatusi ei ole.</div>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {checks.warnings.map((w) => (
                  <li key={w.id} className="rounded-xl bg-amber-50 p-2 text-amber-900">
                    ⚠ <span className="font-medium">{w.label}</span>
                    <div className="mt-1 text-xs">{w.text}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}

function Page7({ data, printPdf, exportJson, checks }) {
  const blocked = checks.mandatory.some((x) => !x.ok);

  return (
    <div className="space-y-4">
      <Section
        title="7.1 PDF"
        subtitle="Jaotusbaas, hooneosad, eelarve, tööd, reserv, rahavoog, maksearvutus, staatus, allkirjaväli"
        right={<Btn onClick={printPdf}>Prindi / salvesta PDF</Btn>}
      >
        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          PDF-i jaoks kasutan praegu browseri printi. Kui tahad “päris PDF-i”, saan lisada eraldi PDF renderi (nt react-pdf või serveripool).
        </div>

        <div className="mt-4 rounded-2xl border p-4">
          <div className="text-sm font-semibold">Allkirjad</div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border p-3">
              <div className="text-xs text-slate-600">Koostaja</div>
              <div className="mt-8 border-t pt-2 text-sm">Allkiri / kuupäev</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-xs text-slate-600">Kinnitajad (juhatus / üldkoosolek)</div>
              <div className="mt-8 border-t pt-2 text-sm">Allkiri / kuupäev</div>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="7.2 JSON"
        subtitle="Täielik andmestruktuur, staatus, failiviited"
        right={<Btn tone="ghost" onClick={exportJson}>Ekspordi JSON</Btn>}
      >
        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          JSON sobib Solvere tuuma jaoks: salvestus, versioonihaldus, audit-trail, import/export.
        </div>

        {blocked ? (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            ⚠ Märkus: kohustuslikud kontrollid pole kõik “OK”. JSON eksport töötab, aga kinnitamiseks soovitus: tee samm 6 roheliseks.
          </div>
        ) : null}

        <div className="mt-3 text-xs text-slate-600">
          Versioon: 2.0 • Staatus: {data.status.state}
        </div>
      </Section>
    </div>
  );
}

// ------------------------- Small components -------------------------

function Kpi({ label, value }) {
  return (
    <div className="rounded-2xl border bg-slate-50 p-3">
      <div className="text-xs text-slate-600">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function SimpleMoneyTable({ rows, onChangeRow, onAdd, onRemove }) {
  return (
    <div className="overflow-auto">
      <table className="min-w-[900px] w-full text-sm">
        <thead className="text-left text-xs text-slate-600">
          <tr>
            <th className="py-2 pr-3">Rida</th>
            <th className="py-2 pr-3">Summa (€)</th>
            <th className="py-2 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-2 pr-3">
                <Input value={r.label} onChange={(v) => onChangeRow(r.id, { label: v })} placeholder="nimetus" />
              </td>
              <td className="py-2 pr-3">
                <NumberInput value={r.amount} onChange={(v) => onChangeRow(r.id, { amount: v })} placeholder="0.00" className="max-w-[180px]" />
              </td>
              <td className="py-2 pr-3">
                <Btn tone="danger" onClick={() => onRemove(r.id)}>Kustuta</Btn>
              </td>
            </tr>
          ))}
          <tr className="border-t bg-slate-50">
            <td className="py-2 pr-3" colSpan={3}>
              <Btn tone="ghost" onClick={onAdd}>+ Lisa rida</Btn>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ------------------------- Print summary -------------------------

function PrintSummaryV2({
  data,
  incomeTotal,
  runningTotal,
  energyAnnualCost,
  investmentsTotal,
  budgetResult,
  reserveMinimum,
  unitPaymentRows,
  monthlyRows,
  checks,
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="page rounded-2xl border p-4">
        <div className="text-lg font-semibold">SOLVERE MAJANDUSKAVA v2.0</div>
        <div className="mt-2 text-sm text-slate-700">
          <div><b>KÜ:</b> {data.meta.kuName || "—"} ({data.meta.regCode || "—"})</div>
          <div><b>Aadress:</b> {data.meta.address || "—"}</div>
          <div><b>Majandusaasta:</b> {data.meta.fiscalYear || "—"}</div>
          <div><b>Staatus:</b> {data.status.state}</div>
          <div><b>Protokoll:</b> {data.status.protocolDate || "—"} / {data.status.protocolNo || "—"}</div>
        </div>
      </div>

      <div className="page rounded-2xl border p-4">
        <div className="text-base font-semibold">Eelarve kokku</div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div>Tulud: <b>{euro(incomeTotal)}</b></div>
          <div>Jooksvad (sh energia): <b>{euro(runningTotal + energyAnnualCost)}</b></div>
          <div>Investeeringud (tööd): <b>{euro(investmentsTotal)}</b></div>
          <div>Tulemus: <b>{euro(budgetResult)}</b></div>
          <div>Reserv miinimum (1/12 jooksvatest): <b>{euro(reserveMinimum)}</b></div>
          <div>Reserv planeeritud: <b>{euro(data.budget.reserve.plannedEnd)}</b></div>
        </div>
      </div>

      <div className="page rounded-2xl border p-4">
        <div className="text-base font-semibold">Rahavoog (kuud)</div>
        <div className="mt-2 overflow-auto">
          <table className="min-w-[700px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Kuu</th>
                <th className="py-2 pr-3">Sissetulek</th>
                <th className="py-2 pr-3">Väljaminek</th>
                <th className="py-2 pr-3">Neto</th>
                <th className="py-2 pr-3">Kumulatiivne</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map((r) => (
                <tr key={r.month} className="border-t">
                  <td className="py-2 pr-3">{r.month}</td>
                  <td className="py-2 pr-3">{euro(r.income)}</td>
                  <td className="py-2 pr-3">{euro(r.expense)}</td>
                  <td className="py-2 pr-3">{euro(r.net)}</td>
                  <td className="py-2 pr-3">{euro(r.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="page rounded-2xl border p-4">
        <div className="text-base font-semibold">Maksearvutus (hooneosad)</div>
        <div className="mt-2 overflow-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-2 pr-3">Osa</th>
                <th className="py-2 pr-3">Pind</th>
                <th className="py-2 pr-3">% osakaal</th>
                <th className="py-2 pr-3">Kuus</th>
                <th className="py-2 pr-3">Aastas</th>
              </tr>
            </thead>
            <tbody>
              {unitPaymentRows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3">{r.partNo}</td>
                  <td className="py-2 pr-3">{formatNumberSpaceDot(num(r.area), 2)} m²</td>
                  <td className="py-2 pr-3">{pct(r.sharePct, 3)}</td>
                  <td className="py-2 pr-3">{euro(r.monthTotal)}</td>
                  <td className="py-2 pr-3">{euro(r.yearTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="page rounded-2xl border p-4">
        <div className="text-base font-semibold">Kontrollid</div>
        <div className="mt-2 text-sm">
          <div className="font-semibold">Kohustuslikud</div>
          <ul className="mt-1 list-disc pl-5">
            {checks.mandatory.map((c) => (
              <li key={c.id}>
                {c.ok ? "OK" : "PUUDUB"} — {c.label}
              </li>
            ))}
          </ul>

          <div className="mt-3 font-semibold">Hoiatused</div>
          {checks.warnings.length ? (
            <ul className="mt-1 list-disc pl-5">
              {checks.warnings.map((w) => <li key={w.id}>{w.label}: {w.text}</li>)}
            </ul>
          ) : (
            <div className="mt-1">Hoiatusi ei ole.</div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-600">Allkiri</div>
            <div className="mt-10 border-t pt-2 text-sm">Kuupäev</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-600">Allkiri</div>
            <div className="mt-10 border-t pt-2 text-sm">Kuupäev</div>
          </div>
        </div>
      </div>
    </div>
  );
}