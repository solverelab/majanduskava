import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * MajanduskavaApp.jsx
 * - Sammud 1–8
 * - Nupud (Tagasi/Edasi) on lehe lõpus (sisu-paneeli all)
 * - Print/PDF sisaldab KOGU majanduskava (PrintAll)
 * - PDF-ist eemaldatakse tühjad väljad/ridad (ei näita “—”, ei näita näiteid)
 */

const LS_KEY = "majanduskava_vnext";

// ------------------------- utils -------------------------
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

const num = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const x =
    typeof v === "number"
      ? v
      : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const eurot = (n) => {
  const x = round2(num(n));
  return `${x.toLocaleString("et-EE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} eurot`;
};

const uid = () => Math.random().toString(36).slice(2, 10);

const clone = (obj) => {
  try {
    // eslint-disable-next-line no-undef
    return structuredClone(obj);
  } catch {
    return JSON.parse(JSON.stringify(obj));
  }
};
const deepMerge = (base, patch) => {
  if (Array.isArray(base) && Array.isArray(patch)) return patch; // arrays: patch wins
  if (base && typeof base === "object" && patch && typeof patch === "object") {
    const out = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = deepMerge(base[k], patch[k]);
    }
    return out;
  }
  return patch === undefined ? base : patch;
};

const UNIT_OPTIONS = ["MWh", "kWh", "m³", "m²", "tk", "kord", "inimene"];

const parseUnitFromName = (s) => {
  const str = String(s || "").trim();
  const m = str.match(/\(([^)]+)\)\s*$/);
  if (!m) return { name: str, unit: "" };
  const unit = String(m[1] || "").trim();
  const name = str.replace(/\s*\([^)]+\)\s*$/, "").trim();
  // accept only known-ish units to avoid stripping meaningful parentheses
  if (!UNIT_OPTIONS.includes(unit)) return { name: str, unit: "" };
  return { name, unit };
};

const formatDateEt = (iso) => {
  const s = String(iso || "").trim();
  if (!s) return "";
  // if already dd.mm.yyyy
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  // ISO yyyy-mm-dd
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}.${m[2]}.${m[1]}`;
};


const isValidRegCode = (s) => /^\d{8}$/.test(String(s || "").trim());

const isoToDate = (iso) => {
  const s = String(iso || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : null;
};

const isAfterIso = (aIso, bIso) => {
  const a = isoToDate(aIso);
  const b = isoToDate(bIso);
  if (!a || !b) return null;
  return b.getTime() > a.getTime();
};

const daysBetweenIso = (aIso, bIso) => {
  const a = isoToDate(aIso);
  const b = isoToDate(bIso);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
};

const serviceFull = (r) => {
  const name = (r && (r.name ?? r.service)) ? String(r.name ?? r.service) : "";
  const unit = r && r.unit ? String(r.unit) : "";
  return unit ? `${name} (${unit})` : name;
};


const hasText = (s) => String(s ?? "").trim().length > 0;
const hasNum = (v) => Math.abs(num(v)) > 0.0000001;
const anyTruthy = (obj) =>
  Object.entries(obj ?? {}).some(([, v]) => !!v);

// path setter (supports dot + numeric indices)
function setByPath(obj, path, value) {
  const keys = String(path)
    .split(".")
    .filter(Boolean)
    .map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

// ------------------------- initial state -------------------------
function makeInitial() {
  return {
    general: {
      name: "",
      regCode: "",
      address: "",
      periodStart: "",
      periodEnd: "",
      meetingDate: "",
      approvedBy: "",
      validFrom: "",
    },

    buildingMin: {
      apartmentsCount: "",
      businessUnitsCount: "",
      heatedAreaTotal: "",
    },

    distribution: {
      base: "kaasomandi", // kaasomandi | pindala_proxy | kombineeritud
      areaProxyNote: true,

      serviceBasisDefaults: {
        heating: "tarbimine",
        electricity: "kaasomandi",
        water: "tarbimine",
        waste: "kaasomandi",
        insurance: "kaasomandi",
        other: "kaasomandi",
      },

      charterExceptionEnabled: false,
      charterExceptionText: "",
    },

    incomes: {
      adminAdvancePerM2PerMonth: "",
      repairFundPerM2PerMonth: "",
      reservePerMonth: "",
      otherIncomes: [
        { id: uid(), name: "", amountAnnual: "", note: "" },
      ],
    },

    runningCosts: {
      services: [
        {
          id: uid(),
          name: "Küte / veesoojendus",
          unit: "MWh",
          provider: "",
          annualQty: "",
          annualCost: "",
          basis: "tarbimine", // kaasomandi | tarbimine | muu
        },
        {
          id: uid(),
          name: "Elekter (üldkasutatavad pinnad)",
          unit: "kWh",
          provider: "",
          annualQty: "",
          annualCost: "",
          basis: "kaasomandi",
        },
        {
          id: uid(),
          name: "Vesi ja kanalisatsioon",
          unit: "m³",
          provider: "",
          annualQty: "",
          annualCost: "",
          basis: "tarbimine",
        },
      ],
    },

    // Legacy: varem oli eraldi “Investeeringud” sisestus Samm 3-s.
    // Uues UX-is sisestatakse investeeringud ainult Sammus 4 (technical.plannedWorks) ja kuvatakse Sammus 3b read-only.
    investments: {
      rows: [
        {
          id: uid(),
          work: "",
          system: "",
          priority: "keskmine",
          deadline: "",
          cost: "",
          funding: {
            remondifond: true,
            reserv: false,
            laen: false,
            sihtotstarbeline: false,
            uhekordne: false,
            toetus: false,
          },
          note: "",
        },
      ],
    },
loan: {
      enabled: false,
      lender: "",
      amount: "",
      interestPct: "",
      years: "",
    },

    technical: {
      systems: [
        { id: uid(), name: "Katus", status: "hea", note: "" },
        { id: uid(), name: "Fassaad", status: "hea", note: "" },
        { id: uid(), name: "Vesi ja kanalisatsioon", status: "hea", note: "" },
        { id: uid(), name: "Elektrisüsteem", status: "hea", note: "" },
        { id: uid(), name: "Ventilatsioon", status: "hea", note: "" },
        { id: uid(), name: "Üldruumid", status: "hea", note: "" },
      ],
      plannedWorks: [
        {
          id: uid(),
          description: "",
          content: "",
          deadline: "",
          cost: "",
          fundingMulti: {
            remondifond: true,
            reserv: false,
            laen: false,
            sihtotstarbeline: false,
            uhekordne: false,
            toetus: false,
          },
          note: "",
        },
      ],
      riskTable: [
        {
          id: uid(),
          system: "Elektrisüsteem",
          risk: "kõrge",
          maxWait: "0–1 aasta",
          note: "tulekahjurisk",
        },
        {
          id: uid(),
          system: "Katus",
          risk: "kõrge",
          maxWait: "0–1 aasta",
          note: "konstruktsioonikahju risk",
        },
        {
          id: uid(),
          system: "Küttesüsteem",
          risk: "keskmine",
          maxWait: "1–2 aastat",
          note: "",
        },
        {
          id: uid(),
          system: "Kanalisatsioon",
          risk: "keskmine",
          maxWait: "1–2 aastat",
          note: "",
        },
      ],
    },

    units: {
      rows: [
        {
          id: uid(),
          label: "1",
          type: "korter",
          area: "",
          share: "",
          include: true,
          excludeReason: "",
        },
      ],
    },

    result: {
      coverIfNegative: {
        reserve: false,
        repairFund: false,
        loan: false,
        targeted: false,
        oneOff: false,
        adjustAdvances: false,
        note: "",
      },
    },

    sensitivity: {
      enabled: true,
      defaultPct: 3,
      rows: [
        { id: uid(), service: "Küte / veesoojendus", baseAnnual: "" },
        { id: uid(), service: "Vesi ja kanalisatsioon", baseAnnual: "" },
        { id: uid(), service: "Kindlustus", baseAnnual: "" },
      ],
    },

    cashflow: {
      rows: [
        { id: uid(), month: "Jaanuar", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "Veebruar", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "Märts", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "Aprill", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "Mai", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "Juuni", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "Juuli", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "August", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "September", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "Oktoober", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "November", income: "", cost: "", loan: "", invest: "" },
        { id: uid(), month: "Detsember", income: "", cost: "", loan: "", invest: "" },
      ],
    },
    finalize: {
      plannedMeetingDate: "",
      effectiveFrom: "",
      preparer: "",
    }
  };
}

// ------------------------- main -------------------------
export default function MajanduskavaApp() {
  const [data, setData] = useState(() => {
    const base = makeInitial();
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);

      // 1) merge (nested väljad ei kao)
      let merged = deepMerge(base, saved);

      // 2) migratsioon: teenuste ühik eraldi väljana
      if (Array.isArray(merged.runningCosts?.services)) {
        merged.runningCosts.services = merged.runningCosts.services.map((r) => {
          if (r && typeof r === "object") {
            if (r.name !== undefined) return r;
            const parsed = parseUnitFromName(r.service);
            const { service, ...rest } = r;
            return { ...rest, name: parsed.name, unit: parsed.unit };
          }
          return r;
        });
      }

      // 3) migratsioon: vanad investeeringud (Samm 3) -> plannedWorks (Samm 4) kui plannedWorks tühi
      const legacyInvest = (saved?.investments?.rows || []).filter((x) => x && (hasText(x.work) || num(x.cost) > 0));
      const planned = merged?.technical?.plannedWorks || [];
      if (legacyInvest.length && Array.isArray(planned) && planned.length <= 1 && !(hasText(planned?.[0]?.description) || num(planned?.[0]?.cost) > 0)) {
        merged.technical.plannedWorks = legacyInvest.map((r) => ({
          id: uid(),
          description: r.work || "",
          content: r.note || "",
          deadline: r.deadline || "",
          cost: r.cost || "",
          fundingMulti: r.funding || {
            remondifond: true,
            reserv: false,
            laen: false,
            sihtotstarbeline: false,
            uhekordne: false,
            toetus: false,
          },
          note: "",
        }));
      }

      // 4) migratsioon: samm 8 väljad (kinnitamine -> ülevaatus)
      if (merged.finalize === undefined) {
        merged.finalize = {
          plannedMeetingDate: merged.general?.meetingDate || "",
          effectiveFrom: merged.general?.periodStart || "",
          preparer: merged.general?.approvedBy || "",
        };
      }
      if (!merged.finalize) {
        merged.finalize = { plannedMeetingDate: "", effectiveFrom: "", preparer: "" };
      }

      return merged;
    } catch {
      return base;
    }
  });

  const [step, setStep] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState("");
  const saveTimer = useRef(null);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
      } catch {
        // ignore
      }
    }, 250);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [data]);

  const update = (path, value) => {
    setData((prev) => {
      const next = clone(prev);
      setByPath(next, path, value);
      return next;
    });
  };

  const steps = useMemo(
    () => [
      { stepNo: "1", title: "Üldandmed", subtitle: "Korteriühistu andmed + põhiandmed" },
      { stepNo: "2", title: "Kohustuste jaotuse alus", subtitle: "Jaotusloogika + erandid teenustele" },
      { stepNo: "3.1", title: "Jooksvad teenused ja tulud", subtitle: "Tulud + teenused + prognoositavad kogused" },
      { stepNo: "3.2", title: "Investeeringud ja finantsanalüüs", subtitle: "Tulemus + katteallikad + laen + rahavoog + inflatsioon" },
      { stepNo: "4", title: "Tehniline seisukord ja tööde plaan", subtitle: "Süsteemid + planeeritud tööd + riskid" },
      { stepNo: "5", title: "Hooneosad", subtitle: "Korterid/äripinnad ja jaotuse alusandmed" },
      { stepNo: "6", title: "Perioodilised ettemaksed", subtitle: "Kuumaksed eurot/m² + laenu mõju + reserv" },
      { stepNo: "7", title: "Korteripõhine vaade", subtitle: "Maksete tabel omanikele (kontroll)" },
      { stepNo: "8", title: "Ülevaatus ja vormistamine", subtitle: "Kontrollid + PDF genereerimine" },
    ],
    []
  );


  // ------------------------- derived -------------------------
  const unitsIncluded = useMemo(
    () => (data.units.rows || []).filter((r) => !!r.include),
    [data.units.rows]
  );

  const totalIncludedArea = useMemo(
    () => unitsIncluded.reduce((s, r) => s + num(r.area), 0),
    [unitsIncluded]
  );

  const incomeAnnual = useMemo(() => {
    const admin = num(data.incomes.adminAdvancePerM2PerMonth) * totalIncludedArea * 12;
    const repair = num(data.incomes.repairFundPerM2PerMonth) * totalIncludedArea * 12;
    const reserve = num(data.incomes.reservePerMonth) * 12;
    const other = (data.incomes.otherIncomes || []).reduce(
      (s, r) => s + num(r.amountAnnual),
      0
    );
    return { admin, repair, reserve, other, total: admin + repair + reserve + other };
  }, [data.incomes, totalIncludedArea]);

  const runningAnnual = useMemo(() => {
    const total = (data.runningCosts.services || []).reduce((s, r) => s + num(r.annualCost), 0);
    return { total };
  }, [data.runningCosts.services]);

  // NB: hetkel liidame investeeringud + plannedWorks (nagu sinu skeemis)
  const investmentsAnnual = useMemo(() => {
    const fromPlanned = (data.technical.plannedWorks || []).reduce((s, r) => s + num(r.cost), 0);
    return { total: fromPlanned };
  }, [data.technical.plannedWorks]);

  // simple annuity
  const loanDerived = useMemo(() => {
    if (!data.loan.enabled) return { monthly: 0, totalCost: 0, monthlyPerM2: 0 };
    const P = num(data.loan.amount);
    const r = num(data.loan.interestPct) / 100 / 12;
    const n = Math.max(1, Math.round(num(data.loan.years) * 12));
    const monthly = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
    const totalCost = monthly * n;
    const monthlyPerM2 = totalIncludedArea > 0 ? monthly / totalIncludedArea : 0;
    return { monthly, totalCost, monthlyPerM2 };
  }, [data.loan, totalIncludedArea]);

  const budgetResult = useMemo(() => {
    const total = incomeAnnual.total - runningAnnual.total - investmentsAnnual.total;
    return round2(total);
  }, [incomeAnnual, runningAnnual, investmentsAnnual]);

  const needCashflow = useMemo(
    () => data.loan.enabled || budgetResult < -0.009,
    [data.loan.enabled, budgetResult]
  );

  const stepIssues = useMemo(() => {
    /** @type {Array<Array<{level:"error"|"warn"|"info", msg:string, stepIndex:number, fieldPath?:string}>>} */
    const byStep = Array.from({ length: steps.length }, () => []);

    const push = (stepIndex, level, msg, fieldPath) => {
      byStep[stepIndex].push({ level, msg, stepIndex, fieldPath });
    };

    // STEP 1 (index 0): Üldandmed
    if (!hasText(data.general.name)) push(0, "error", "KÜ nimi on kohustuslik.", "general.name");
    if (!isValidRegCode(data.general.regCode))
      push(0, "error", "Registrikood peab olema 8-kohaline number. Palun kontrolli sisestust.", "general.regCode");

    if (!hasText(data.general.periodStart)) push(0, "warn", "Perioodi algus on soovitatav täita.", "general.periodStart");
    if (!hasText(data.general.periodEnd)) push(0, "warn", "Perioodi lõpp on soovitatav täita.", "general.periodEnd");
    const periodOk = isAfterIso(data.general.periodStart, data.general.periodEnd);
    if (periodOk === false)
      push(0, "error", "Perioodi lõppkuupäev ei saa olla varasem kui alguskuupäev.", "general.periodEnd");

    if (num(data.buildingMin.heatedAreaTotal) <= 0)
      push(0, "error", "Köetav pind kokku peab olema suurem kui 0.", "buildingMin.heatedAreaTotal");

    // STEP 2 (index 1): Jaotus
    if (data.distribution.charterExceptionEnabled && !hasText(data.distribution.charterExceptionText))
      push(1, "error", "Kui rakendub põhikirjajärgne erisus, sisesta erisuse kirjeldus.", "distribution.charterExceptionText");

    // STEP 3.1 (index 2): Tulud + teenused
    if (num(data.incomes.adminAdvancePerM2PerMonth) <= 0)
      push(2, "warn", "Haldus ja hooldus (eurot/m² kuus) peaks olema positiivne, et eelarve ei jääks tühjaks.", "incomes.adminAdvancePerM2PerMonth");

    (data.runningCosts.services || []).forEach((r, idx) => {
      const hasRow = hasText(r?.name) || hasText(r?.provider) || hasNum(r?.annualQty) || hasNum(r?.annualCost);
      if (!hasRow) return;
      if (!hasText(r?.name)) push(2, "warn", "Teenuse nimi on puudu.", `runningCosts.services.${idx}.name`);
      if (num(r?.annualCost) <= 0) push(2, "warn", "Teenuse aastakulu on puudu või 0.", `runningCosts.services.${idx}.annualCost`);
    });

    (data.incomes.otherIncomes || []).forEach((r, idx) => {
      const hasRow = hasText(r?.name) || hasNum(r?.amountAnnual) || hasText(r?.note);
      if (!hasRow) return;
      if (!hasText(r?.name)) push(2, "warn", "Muude tulude real on tulu nimetus puudu.", `incomes.otherIncomes.${idx}.name`);
      if (num(r?.amountAnnual) === 0) push(2, "warn", "Muude tulude real on aastasumma puudu või 0.", `incomes.otherIncomes.${idx}.amountAnnual`);
    });

    // STEP 3.2 (index 3): Laen + tulemus + rahavoog + inflatsioon
    if (budgetResult < -0.009) {
      push(3, "warn", `Tähelepanu: Majanduskava aasta tulem on negatiivne (${eurot(budgetResult)}). Kulud ületavad tulusid, palun korrigeeri ettemakseid või kulusid.`, "incomes.adminAdvancePerM2PerMonth");
    }

    if (data.loan.enabled) {
      const missing = [];
      if (num(data.loan.amount) <= 0) missing.push("laenusumma");
      if (num(data.loan.interestPct) <= 0) missing.push("intress");
      if (num(data.loan.years) <= 0) missing.push("periood");
      if (missing.length) push(3, "error", `Laen on märgitud kavandatuks, kuid puuduvad väljad: ${missing.join(", ")}.`, "loan.amount");
    }

    if (data.sensitivity.enabled) {
      const anyBase = (data.sensitivity.rows || []).some((r) => hasNum(r.baseAnnual));
      if (!anyBase) push(3, "info", "Inflatsiooni analüüs on sisse lülitatud, kuid baas-aastakulud on täitmata. Lisa vähemalt 1 rida: teenus + aastakulu.", "sensitivity.rows.0.baseAnnual");
    }

    // STEP 4 (index 4): Planeeritud tööd
    (data.technical.plannedWorks || []).forEach((w, idx) => {
      const hasRow = hasText(w?.description) || hasText(w?.content) || hasText(w?.deadline) || hasNum(w?.cost) || anyTruthy(w?.fundingMulti);
      if (!hasRow) return;

      const anyFunding = anyTruthy(w?.fundingMulti);
      if (!anyFunding) push(4, "error", "Planeeritud tööl peab olema valitud vähemalt üks rahastusallikas.", `technical.plannedWorks.${idx}.fundingMulti`);

      // Risk kõrge: soovitus tähtaeg <= 1 aasta (heuristika: kui töö kirjeldus sisaldab riskitabeli kõrge riski süsteemi nime)
      const highSystems = (data.technical.riskTable || []).filter((r) => String(r?.risk).toLowerCase() === "kõrge").map((r) => String(r?.system || "").trim()).filter(Boolean);
      const desc = String(w?.description || "").toLowerCase();
      const matchesHigh = highSystems.some((s) => s && desc.includes(s.toLowerCase()));
      if (matchesHigh) {
        const d = daysBetweenIso(new Date().toISOString().slice(0, 10), w.deadline);
        if (d === null) push(4, "warn", "Kõrge riskiga süsteemi töö puhul on soovituslik tähtaeg määrata (0–1 aasta).", `technical.plannedWorks.${idx}.deadline`);
        else if (d > 365) push(4, "warn", "Kõrge riskiga süsteemi töö tähtaeg on üle 1 aasta; soovituslik on 0–1 aasta.", `technical.plannedWorks.${idx}.deadline`);
      }
    });

    // STEP 5 (index 5): Hooneosad
    const zeroArea = (data.units.rows || []).filter((u) => u.include && num(u.area) <= 0 && hasText(u.label));
    if (zeroArea.length) {
      push(5, "error", `Hoiatus: Hooneosal on pindala 0 või puudu. Ilma pindalata ei ole võimalik makseid arvutada.`, `units.rows.0.area`);
    }

    const heated = num(data.buildingMin.heatedAreaTotal);
    if (heated > 0 && totalIncludedArea > 0) {
      const diff = Math.abs(heated - totalIncludedArea);
      if (diff > Math.max(1, heated * 0.02)) {
        push(
          5,
          "info",
          `Kontroll: samm 1 köetav pind kokku (${round2(heated).toLocaleString("et-EE")} m²) ei kattu samm 5 jaotuses arvesse mineva pinnaga (${round2(totalIncludedArea).toLocaleString("et-EE")} m²).`,
          "buildingMin.heatedAreaTotal"
        );
      }
    }

    // STEP 8 (index 8): Vormistus
    if (!hasText(data.finalize.preparer))
      push(8, "error", "PDF-i genereerimiseks sisesta koostaja nimi või ametinimetus.", "finalize.preparer");
    if (!hasText(data.finalize.effectiveFrom))
      push(8, "error", "PDF-i genereerimiseks sisesta kavandatav kehtivuse algus.", "finalize.effectiveFrom");

    return byStep;
  }, [
    data,
    steps.length,
    budgetResult,
    totalIncludedArea,
    incomeAnnual.total,
    runningAnnual.total,
    investmentsAnnual.total,
  ]);

  const checks = useMemo(() => stepIssues.flat(), [stepIssues]);

  const canPrint = useMemo(
    () => !checks.some((c) => c.level === "error"),
    [checks]
  );

  const stepStatus = useMemo(() => {
    return stepIssues.map((issues) => {
      const hasErr = issues.some((i) => i.level === "error");
      const hasWarn = issues.some((i) => i.level === "warn");
      const hasInfo = issues.some((i) => i.level === "info");
      if (hasErr) return "error";
      if (hasWarn || hasInfo) return "partial";
      return "ok";
    });
  }, [stepIssues]);



  const payments = useMemo(() => {
    const adminM = num(data.incomes.adminAdvancePerM2PerMonth);
    const repairM = num(data.incomes.repairFundPerM2PerMonth);
    const loanM2 = loanDerived.monthlyPerM2;

    return (data.units.rows || []).map((u) => {
      const area = num(u.area);
      const share = totalIncludedArea > 0 ? area / totalIncludedArea : 0;
      const included = !!u.include;

      const admin = included ? adminM * area : 0;
      const repair = included ? repairM * area : 0;
      const loan = included ? loanM2 * area : 0;

      return {
        id: u.id,
        label: u.label,
        type: u.type,
        area,
        sharePct: included ? share * 100 : 0,
        admin,
        repair,
        loan,
        totalMonthly: admin + repair + loan,
        include: included,
        excludeReason: u.excludeReason || "",
      };
    });
  }, [
    data.units.rows,
    data.incomes.adminAdvancePerM2PerMonth,
    data.incomes.repairFundPerM2PerMonth,
    loanDerived.monthlyPerM2,
    totalIncludedArea,
  ]);

  // ------------------------- actions -------------------------
  const resetAll = () => {
    if (!confirm("Kas lähtestan kogu majanduskava (salvestus kustub)?")) return;
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    setData(makeInitial());
    setStep(0);
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      setToast("Mustand salvestatud.");
      setTimeout(() => setToast(""), 1800);
    } catch {
      setToast("Salvestamine ebaõnnestus (brauseri piirang).");
      setTimeout(() => setToast(""), 2200);
    }
  };

  const goToField = (stepIndex, fieldPath) => {
    setStep(stepIndex);
    if (!fieldPath) return;
    setTimeout(() => {
      const el = document.querySelector(`[data-path="${CSS.escape(fieldPath)}"]`);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        try { el.focus?.(); } catch {}
      }
    }, 80);
  };

  const openPreview = () => setPreviewOpen(true);
  const closePreview = () => setPreviewOpen(false);

  const printPdf = () => window.print();


  // ------------------------- render -------------------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .page { break-inside: avoid; page-break-inside: avoid; margin-bottom: 18px; }
          a[href]:after { content: ""; }
        }
        @media screen {
          .print-only { display: none; }
        }
      `}</style>

      {/* Top bar */}
      <div className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <div className="text-lg font-semibold">Majanduskava</div>
            <div className="text-xs text-slate-600">
              Struktureeritud vorm • automaatarvutused • Prindi/PDF allkirjastamiseks
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Btn tone="ghost" onClick={saveDraft}>
              Salvesta mustand
            </Btn>
            <Btn tone="ghost" onClick={openPreview}>
              Eelvaade
            </Btn>
            {step === steps.length - 1 && (
              <Btn onClick={printPdf} disabled={!canPrint}>
                Prindi / Salvesta PDF
              </Btn>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className="no-print mx-auto max-w-6xl px-4 pt-3">
          <div className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">
            {toast}
          </div>
        </div>
      )}

      {previewOpen && (
        <PreviewModal
          onClose={closePreview}
          canPrint={canPrint}
          onPrint={printPdf}
        >
          <PrintAll
            data={data}
            incomeAnnual={incomeAnnual}
            runningAnnual={runningAnnual}
            investmentsAnnual={investmentsAnnual}
            budgetResult={budgetResult}
            loanDerived={loanDerived}
            payments={payments}
            totalIncludedArea={totalIncludedArea}
            needCashflow={needCashflow}
          />
        </PreviewModal>
      )}

      <div className="mx-auto grid max-w-6xl grid-cols-12 gap-4 px-4 py-4">
        {/* sidebar */}
        <div className="no-print col-span-12 md:col-span-4">
          <div className="rounded-2xl border bg-white p-3">
            <div className="text-sm font-semibold">Sammud</div>
            <div className="mt-2 space-y-1">
              {steps.map((s, i) => (
                <button
                  key={s.title}
                  onClick={() => setStep(i)}
                  className={[
                    "w-full rounded-xl px-3 py-2 text-left transition",
                    i === step ? "bg-slate-900 text-white" : "hover:bg-slate-100",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs">
                      {stepStatus[i] === "ok" ? "✓" : stepStatus[i] === "error" ? "!" : "•"}
                    </span>
                    <span>{s.stepNo}. {s.title}</span>
                  </div>
                  <div
                    className={[
                      "text-xs",
                      i === step ? "text-slate-200" : "text-slate-500",
                    ].join(" ")}
                  >
                    {s.subtitle}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
              <div className="font-semibold">Kiirülevaade</div>
              <div className="mt-1">
                Tulud kokku <b>{eurot(incomeAnnual.total)}</b>
              </div>
              <div>
                Jooksvad kulud <b>{eurot(runningAnnual.total)}</b>
              </div>
              <div>
                Investeeringud/tööd <b>{eurot(investmentsAnnual.total)}</b>
              </div>
              <div className="mt-1">
                Tulemus{" "}
                <b
                  className={
                    budgetResult < -0.009
                      ? "text-rose-600"
                      : budgetResult > 0.009
                      ? "text-emerald-700"
                      : ""
                  }
                >
                  {eurot(budgetResult)}
                </b>
              </div>

              {needCashflow && (
                <div className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900">
                  Vajalik kuupõhine jaotus (laen või negatiivne tulemus).
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 text-xs text-slate-500">
            <button
              className="underline hover:text-slate-700"
              onClick={() => {
                if (confirm("Kas oled kindel? See tegevus kustutab kõik sisestatud andmed ja seda ei saa tagasi võtta.")) {
                  resetAll();
                }
              }}
            >
              Tühjenda vorm
            </button>
          </div>

        </div>

        {/* content */}
        <div className="col-span-12 md:col-span-8">
          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-slate-500">
              Samm {steps[step].stepNo} / {steps[steps.length - 1].stepNo}
            </div>
            <div className="text-xl font-semibold">{steps[step].title}</div>
            <div className="mt-1 text-sm text-slate-600">{steps[step].subtitle}</div>

            {stepIssues[step]?.length > 0 && (
              <div className="mt-4 space-y-2">
                {stepIssues[step].map((it, idx) => (
                  <div
                    key={idx}
                    className={[
                      "rounded-xl border px-3 py-2 text-sm",
                      it.level === "error"
                        ? "border-rose-200 bg-rose-50 text-rose-900"
                        : it.level === "warn"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-slate-200 bg-slate-50 text-slate-800",
                    ].join(" ")}
                  >
                    {it.fieldPath ? (
                      <button
                        type="button"
                        className="text-left underline underline-offset-2"
                        onClick={() => goToField(it.stepIndex, it.fieldPath)}
                      >
                        {it.msg}
                      </button>
                    ) : (
                      it.msg
                    )}
                  </div>
                ))}
              </div>
            )}


            <div className="mt-4">
              {step === 0 && <PageGeneral data={data} update={update} />}
              {step === 1 && <PageDistribution data={data} update={update} />}

              {step === 2 && (
                <PageBudget
                  mode="A"
                  data={data}
                  update={update}
                  budgetResult={budgetResult}
                  incomeAnnual={incomeAnnual}
                  runningAnnual={runningAnnual}
                  investmentsAnnual={investmentsAnnual}
                  needCashflow={needCashflow}
                />
              )}

              {step === 3 && (
                <PageBudget
                  mode="B"
                  data={data}
                  update={update}
                  budgetResult={budgetResult}
                  incomeAnnual={incomeAnnual}
                  runningAnnual={runningAnnual}
                  investmentsAnnual={investmentsAnnual}
                  needCashflow={needCashflow}
                />
              )}

              {step === 4 && (
                <PageTechnical
                  data={data}
                  update={update}
                  investmentsAnnual={investmentsAnnual}
                />
              )}

              {step === 5 && <PageUnits data={data} update={update} totalIncludedArea={totalIncludedArea} />}

              {step === 6 && (
  <PageAdvances
    data={data}
    update={update}
    totalIncludedArea={totalIncludedArea}
    loanDerived={loanDerived}
  />
)}

              {step === 7 && (
  <PagePayments payments={payments} />
)}

              {step === 8 && (
                <PageReview
                  data={data}
                  update={update}
                  budgetResult={budgetResult}
                  incomeAnnual={incomeAnnual}
                  runningAnnual={runningAnnual}
                  investmentsAnnual={investmentsAnnual}
                  checks={checks}
                  canPrint={canPrint}
                  onGo={goToField}
                />
              )}            </div>

            {/* ✅ NUPUD LEHE LÕPUS (sisu-paneeli all) */}
            <div className="no-print mt-8 flex gap-2">
              <Btn
                tone="ghost"
                disabled={step === 0}
                onClick={() => setStep((s) => clamp(s - 1, 0, steps.length - 1))}
              >
                Tagasi
              </Btn>
              <Btn
                disabled={step === steps.length - 1}
                onClick={() => setStep((s) => clamp(s + 1, 0, steps.length - 1))}
              >
                Edasi
              </Btn>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ PRINT: kogu dokument (kõik sammud) */}
      <div className="print-only">
        <PrintAll
          data={data}
          incomeAnnual={incomeAnnual}
          runningAnnual={runningAnnual}
          investmentsAnnual={investmentsAnnual}
          budgetResult={budgetResult}
          loanDerived={loanDerived}
          payments={payments}
          totalIncludedArea={totalIncludedArea}
          needCashflow={needCashflow}
        />
      </div>
    </div>
  );
}

// ------------------------- UI bits -------------------------
function Btn({ children, onClick, disabled, tone = "primary" }) {
  const base =
    "rounded-xl px-3 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
  const cls =
    tone === "primary"
      ? `${base} bg-slate-900 text-white hover:bg-slate-800`
      : tone === "ghost"
      ? `${base} border bg-white hover:bg-slate-50`
      : `${base} bg-slate-100 hover:bg-slate-200`;
  return (
    <button className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}


function PreviewModal({ children, onClose, canPrint, onPrint }) {
  return (
    <div className="no-print fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-4">
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Eelvaade</div>
            <div className="text-xs text-slate-600">
              Näed täpselt sama sisu, mis prinditakse PDF-i.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Btn onClick={onPrint} disabled={!canPrint}>
              Prindi / Salvesta PDF
            </Btn>
            <Btn tone="ghost" onClick={onClose}>
              Sulge
            </Btn>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-50 p-4">
          <div className="mx-auto max-w-4xl rounded-2xl bg-white p-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}


function Field({ label, hint, value, onChange, placeholder, type = "text", disabled = false, path }) {
  return (
    <label className="block">
      <div className="text-sm font-semibold">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      <input
        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm placeholder:text-slate-400"
        data-path={path}
        id={path ? `f_${path}` : undefined}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        disabled={disabled}
      />
    </label>
  );
}

function Textarea({ label, hint, value, onChange, placeholder, rows = 3, path }) {
  return (
    <label className="block">
      <div className="text-sm font-semibold">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      <textarea
        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm placeholder:text-slate-400"
        data-path={path}
        id={path ? `f_${path}` : undefined}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
      />
    </label>
  );
}

function Select({ label, hint, value, onChange, options, path }) {
  return (
    <label className="block">
      <div className="text-sm font-semibold">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      <select
        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
        data-path={path}
        id={path ? `f_${path}` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ label, value, onChange, hint, path }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        className="mt-1 h-4 w-4"
        type="checkbox"
        data-path={path}
        id={path ? `f_${path}` : undefined}
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div>
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
    </label>
  );
}

function H2({ children }) {
  return <div className="mt-8 text-base font-semibold">{children}</div>;
}

function Divider() {
  return <div className="my-4 h-px bg-slate-200" />;
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-sm">
      <div className="text-slate-600">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

// ------------------------- Pages -------------------------
function PageGeneral({ data, update }) {
  return (
    <div className="space-y-6">
      <H2>1.1 Korteriühistu andmed</H2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="KÜ nimi" path="general.name" value={data.general.name} onChange={(v) => update("general.name", v)} placeholder="nt Näidise KÜ" />
        <Field label="Registrikood" path="general.regCode" value={data.general.regCode} onChange={(v) => update("general.regCode", v)} placeholder="nt 12345678" />
        <Field label="Aadress" value={data.general.address} onChange={(v) => update("general.address", v)} placeholder="nt Tänav 1, Linn" />
        <Field label="Üldkoosoleku kuupäev" type="date" value={data.general.meetingDate} onChange={(v) => update("general.meetingDate", v)} />
        <Field label="Perioodi algus" path="general.periodStart" type="date" value={data.general.periodStart} onChange={(v) => update("general.periodStart", v)} />
        <Field label="Perioodi lõpp" path="general.periodEnd" type="date" value={data.general.periodEnd} onChange={(v) => update("general.periodEnd", v)} />
      </div>

      <H2>1.2 Ehitise põhiandmed (supermiinimum)</H2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Korterite arv" value={data.buildingMin.apartmentsCount} onChange={(v) => update("buildingMin.apartmentsCount", v)} placeholder="nt 9" />
        <Field label="Äripindade arv" value={data.buildingMin.businessUnitsCount} onChange={(v) => update("buildingMin.businessUnitsCount", v)} placeholder="nt 1" />
        <Field label="Köetav pind kokku (m²)" path="buildingMin.heatedAreaTotal" value={data.buildingMin.heatedAreaTotal} onChange={(v) => update("buildingMin.heatedAreaTotal", v)} placeholder="nt 436,30" />
      </div>

      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        Need põhiandmed jäävad alles eeltäitmiseks tulevikus. Täismahus ehitise andmed saab lisada hiljem.
      </div>
    </div>
  );
}

function PageDistribution({ data, update }) {
  return (
    <div className="space-y-6">
      <H2>2.1 Jaotuse alus</H2>
      <Select
        label="Perioodiliste ettemaksete alus"
        value={data.distribution.base}
        onChange={(v) => update("distribution.base", v)}
        options={[
          { value: "kaasomandi", label: "Kaasomandi osa (põhireegel)" },
          { value: "pindala_proxy", label: "Pindala (m²) kui arvutuslik vahend" },
          { value: "kombineeritud", label: "Kombineeritud (teenusepõhiselt + põhireegel)" },
        ]}
      />

      <Toggle
        label="Näita selgitus: pindala on arvutuslik vahend (mitte õiguslik asendus)"
        value={data.distribution.areaProxyNote}
        onChange={(v) => update("distribution.areaProxyNote", v)}
        hint="Soovitus: hoia sees, et jaotusloogika oleks läbipaistev."
      />

      <H2>2.2 Tegelik tarbimine (ainult teenustele)</H2>
      <div className="rounded-xl border p-3 text-sm text-slate-700">
        <div className="font-semibold">Lubatud teenustel</div>
        <div className="mt-1 text-slate-600">küte, vesi, individuaalne elekter, era-teenus.</div>
        <div className="mt-2 font-semibold">Ei rakendu</div>
        <div className="mt-1 text-slate-600">remondifond, reserv, üldhaldus (need jäävad põhireegli alla).</div>
      </div>

      <H2>2.3 Põhikirjajärgne erisus (vajadusel)</H2>
      <Toggle
        label="Rakendub põhikirjajärgne erisus"
        value={data.distribution.charterExceptionEnabled}
        onChange={(v) => update("distribution.charterExceptionEnabled", v)}
      />

      {data.distribution.charterExceptionEnabled && (
        <Textarea
          label="Erisuse kirjeldus ja põhjendus" path="distribution.charterExceptionText"
          value={data.distribution.charterExceptionText}
          onChange={(v) => update("distribution.charterExceptionText", v)}
          placeholder="Kirjelda, milles erisus seisneb ja miks see on mõistlik."
          rows={4}
        />
      )}
    </div>
  );
}

function PageBudget({
  mode,
  data,
  update,
  budgetResult,
  incomeAnnual,
  runningAnnual,
  investmentsAnnual,
  loanDerived,
  needCashflow,
}) {
  const cover = data.result.coverIfNegative;
  const isA = mode === "A";
  const isB = mode === "B";

  return (
    <div className="space-y-6">
      {isA && <H2>3a.1 Tulud</H2>}
      {isB && <H2>3b.1 Investeeringud ja finantsanalüüs</H2>}
      {isA && (
      <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Haldus ja hooldus (eurot/m² kuus)" path="incomes.adminAdvancePerM2PerMonth" value={data.incomes.adminAdvancePerM2PerMonth}
          onChange={(v) => update("incomes.adminAdvancePerM2PerMonth", v)}
          placeholder="nt 0,60"
        />
        <Field
          label="Remondifond (eurot/m² kuus)"
          value={data.incomes.repairFundPerM2PerMonth}
          onChange={(v) => update("incomes.repairFundPerM2PerMonth", v)}
          placeholder="nt 0,80"
        />
        <Field
          label="Reserv (eurot kuus, valikuline)"
          value={data.incomes.reservePerMonth}
          onChange={(v) => update("incomes.reservePerMonth", v)}
          placeholder="nt 50"
        />
      </div>

      <div className="rounded-xl border p-3">
        <div className="text-sm font-semibold">Muud tulud</div>
        <div className="mt-2 space-y-2">
          {(data.incomes.otherIncomes || []).map((r, idx) => (
            <div key={r.id} className="grid grid-cols-1 gap-2 md:grid-cols-12">
              <div className="md:col-span-5">
                <Field
                  label="Tulu"
                  value={r.name}
                  onChange={(v) => {
                    const next = clone(data.incomes.otherIncomes);
                    next[idx].name = v;
                    update("incomes.otherIncomes", next);
                  }}
                />
              </div>
              <div className="md:col-span-2">
                <Select
                  label="Ühik"
                  value={r.unit ?? ""}
                  options={[{ value: "", label: "—" }, ...UNIT_OPTIONS.map((u) => ({ value: u, label: u }))]}
                  onChange={(v) => {
                    const next = clone(data.runningCosts.services);
                    next[idx].unit = v;
                    update("runningCosts.services", next);
                  }}
                />
              </div>
              <div className="md:col-span-3">
                <Field
                  label="Aastas (eurot)"
                  value={r.amountAnnual}
                  onChange={(v) => {
                    const next = clone(data.incomes.otherIncomes);
                    next[idx].amountAnnual = v;
                    update("incomes.otherIncomes", next);
                  }}
                />
              </div>
              <div className="md:col-span-3">
                <Field
                  label="Märkus"
                  value={r.note}
                  onChange={(v) => {
                    const next = clone(data.incomes.otherIncomes);
                    next[idx].note = v;
                    update("incomes.otherIncomes", next);
                  }}
                  placeholder="valikuline"
                />
              </div>
              <div className="md:col-span-1 flex items-end">
                <Btn
                  tone="ghost"
                  onClick={() => {
                    const next = (data.incomes.otherIncomes || []).filter((x) => x.id !== r.id);
                    update(
                      "incomes.otherIncomes",
                      next.length ? next : [{ id: uid(), name: "", amountAnnual: "", note: "" }]
                    );
                  }}
                >
                  ✕
                </Btn>
              </div>
            </div>
          ))}
          <Btn
            tone="ghost"
            onClick={() =>
              update("incomes.otherIncomes", [
                ...(data.incomes.otherIncomes || []),
                { id: uid(), name: "", amountAnnual: "", note: "" },
              ])
            }
          >
            + Lisa tulu
          </Btn>
        </div>
      </div>

      <H2>3a.2 Jooksvad kulud</H2>
      <div className="rounded-xl border p-3">
        <div className="text-sm font-semibold">Teenused</div>
        <div className="mt-2 space-y-2">
          {(data.runningCosts.services || []).map((r, idx) => (
            <div key={r.id} className="grid grid-cols-1 gap-2 md:grid-cols-12">
              <div className="md:col-span-4">
                <Field
                  label="Teenus"
                  value={r.name ?? ""}
                  onChange={(v) => {
                    const next = clone(data.runningCosts.services);
                    next[idx].name = v;
                    // kui kasutaja kirjutab kogemata “(kWh)” nime lõppu, proovi parse'ida
                    if (!next[idx].unit) {
                      const parsed = parseUnitFromName(v);
                      if (parsed.unit) {
                        next[idx].name = parsed.name;
                        next[idx].unit = parsed.unit;
                      }
                    }
                    update("runningCosts.services", next);
                  }}
                />
              </div>
              <div className="md:col-span-3">
                <Field
                  label="Teenuse osutaja"
                  value={r.provider}
                  onChange={(v) => {
                    const next = clone(data.runningCosts.services);
                    next[idx].provider = v;
                    update("runningCosts.services", next);
                  }}
                  placeholder="valikuline"
                />
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Kogus aastas"
                  value={r.annualQty}
                  onChange={(v) => {
                    const next = clone(data.runningCosts.services);
                    next[idx].annualQty = v;
                    update("runningCosts.services", next);
                  }}
                  placeholder="valikuline"
                />
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Aastakulu (eurot)"
                  value={r.annualCost}
                  onChange={(v) => {
                    const next = clone(data.runningCosts.services);
                    next[idx].annualCost = v;
                    update("runningCosts.services", next);
                  }}
                />
              </div>
              <div className="md:col-span-1">
                <Select
                  label="Jaotus"
                  value={r.basis}
                  onChange={(v) => {
                    const next = clone(data.runningCosts.services);
                    next[idx].basis = v;
                    update("runningCosts.services", next);
                  }}
                  options={[
                    { value: "kaasomandi", label: "põhireegel" },
                    { value: "tarbimine", label: "tarbimine" },
                    { value: "muu", label: "muu" },
                  ]}
                />
              </div>
            </div>
          ))}
          <Btn
            tone="ghost"
            onClick={() =>
              update("runningCosts.services", [
                ...(data.runningCosts.services || []),
                { id: uid(), service: "", provider: "", annualQty: "", annualCost: "", basis: "kaasomandi" },
              ])
            }
          >
            + Lisa teenus
          </Btn>
        </div>
      </div>

      </>
      )}

      {isB && (
      <>
      <H2>3b.2 Investeeringud ja suuremad tööd</H2>
      <div className="rounded-xl border p-3">
        <div className="text-sm text-slate-700">
          Investeeringud sisestatakse ja hallatakse ainult sammus <b>4</b> (“Tehniline seisukord ja tööde plaan”).
          Siin kuvatakse need read-only kujul, et vältida topeltarvestust.
        </div>

        {(data.technical.plannedWorks || []).filter((r) => hasText(r.description) || hasText(r.deadline) || hasNum(r.cost) || anyTruthy(r.fundingMulti)).length === 0 ? (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Planeeritud töid ei ole veel sisestatud. Lisa tööd sammus 4.
          </div>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left">Töö</th>
                <th className="py-2 text-left">Tähtaeg</th>
                <th className="py-2 text-left">Maksumus</th>
                <th className="py-2 text-left">Rahastus</th>
              </tr>
            </thead>
            <tbody>
              {(data.technical.plannedWorks || [])
                .filter((r) => hasText(r.description) || hasText(r.deadline) || hasNum(r.cost) || anyTruthy(r.fundingMulti))
                .map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-2">{r.description || ""}</td>
                    <td className="py-2">{formatDateEt(r.deadline) || ""}</td>
                    <td className="py-2">{hasNum(r.cost) ? eurot(r.cost) : ""}</td>
                    <td className="py-2">{fundingText(r.fundingMulti)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <H2>3b.3 Tulemus ja katteallikas</H2>
      <div className="rounded-xl border p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <Stat label="Tulud kokku" value={eurot(incomeAnnual.total)} />
          <Stat label="Jooksvad kulud" value={eurot(runningAnnual.total)} />
          <Stat label="Investeeringud ja tööd" value={eurot(investmentsAnnual.total)} />
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <div className="text-sm font-semibold">Aasta tulemus</div>
          <div
            className={[
              "mt-1 text-lg font-semibold",
              budgetResult < -0.009
                ? "text-rose-600"
                : budgetResult > 0.009
                ? "text-emerald-700"
                : "",
            ].join(" ")}
          >
            {eurot(budgetResult)}
          </div>

          {budgetResult < -0.009 && (
            <div className="mt-3">
              <div className="text-sm font-semibold">Katteallikas (kohustuslik)</div>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cover.reserve}
                    onChange={(e) => update("result.coverIfNegative.reserve", e.target.checked)}
                  />
                  Kaetakse reservist
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cover.repairFund}
                    onChange={(e) => update("result.coverIfNegative.repairFund", e.target.checked)}
                  />
                  Kaetakse remondifondist
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cover.loan}
                    onChange={(e) => {
                      update("result.coverIfNegative.loan", e.target.checked);
                      update("loan.enabled", e.target.checked);
                    }}
                  />
                  Laen
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cover.targeted}
                    onChange={(e) => update("result.coverIfNegative.targeted", e.target.checked)}
                  />
                  Sihtotstarbelised maksed
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cover.oneOff}
                    onChange={(e) => update("result.coverIfNegative.oneOff", e.target.checked)}
                  />
                  Ühekordsed maksed
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cover.adjustAdvances}
                    onChange={(e) => update("result.coverIfNegative.adjustAdvances", e.target.checked)}
                  />
                  Perioodiliste maksete korrigeerimine
                </label>
              </div>

              <div className="mt-2">
                <Textarea
                  label="Märkus"
                  value={cover.note}
                  onChange={(v) => update("result.coverIfNegative.note", v)}
                  placeholder="Lühiselgitus, kuidas katteallikas rakendub."
                  rows={3}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <H2>3.5 Laen (kui kohaldub)</H2>
      <Toggle
        label="Laen on kavandatud"
        value={data.loan.enabled}
        onChange={(v) => update("loan.enabled", v)}
        hint="Laenu detailid kuvatakse ka maksete tabelis (kuumakse eurot/m²)."
      />

      {data.loan.enabled && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Pank" value={data.loan.lender} onChange={(v) => update("loan.lender", v)} placeholder="valikuline" />
          <Field label="Laenusumma (eurot)" path="loan.amount" value={data.loan.amount} onChange={(v) => update("loan.amount", v)} />
          <Field label="Intress (protsenti)" value={data.loan.interestPct} onChange={(v) => update("loan.interestPct", v)} />
          <Field label="Periood (aastat)" value={data.loan.years} onChange={(v) => update("loan.years", v)} />

          <div className="md:col-span-4 rounded-xl bg-slate-50 p-3 text-sm">
            <div>
              Kuumakse kokku <b>{eurot(loanDerived.monthly)}</b>
            </div>
            <div>
              Kuumakse eurot/m² <b>{eurot(loanDerived.monthlyPerM2)}</b>
            </div>
            <div>
              Laenu kogukulu perioodil <b>{eurot(loanDerived.totalCost)}</b>
            </div>
          </div>
        </div>
      )}

      <H2>3.6 Kuupõhine jaotus (rahavoog)</H2>
      <div className="rounded-xl border p-3">
        <div className="text-sm text-slate-700">
          {needCashflow ? "Kohustuslik (laen või negatiivne tulemus)." : "Valikuline (soovi korral detailsemaks planeerimiseks)."}
        </div>

        <div className="mt-2 space-y-2">
          {data.cashflow.rows.map((r, idx) => (
            <div key={r.id} className="grid grid-cols-1 gap-2 md:grid-cols-12">
              <div className="md:col-span-2">
                <Field
                  label="Kuu"
                  value={r.month}
                  onChange={(v) => {
                    const next = clone(data.cashflow.rows);
                    next[idx].month = v;
                    update("cashflow.rows", next);
                  }}
                />
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Tulud (eurot)"
                  value={r.income}
                  onChange={(v) => {
                    const next = clone(data.cashflow.rows);
                    next[idx].income = v;
                    update("cashflow.rows", next);
                  }}
                />
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Kulud (eurot)"
                  value={r.cost}
                  onChange={(v) => {
                    const next = clone(data.cashflow.rows);
                    next[idx].cost = v;
                    update("cashflow.rows", next);
                  }}
                />
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Laen (eurot)"
                  value={r.loan}
                  onChange={(v) => {
                    const next = clone(data.cashflow.rows);
                    next[idx].loan = v;
                    update("cashflow.rows", next);
                  }}
                />
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Investeering (eurot)"
                  value={r.invest}
                  onChange={(v) => {
                    const next = clone(data.cashflow.rows);
                    next[idx].invest = v;
                    update("cashflow.rows", next);
                  }}
                />
              </div>
              <div className="md:col-span-2 flex items-end">
                <div className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  Tulemus <b>{eurot(num(r.income) - num(r.cost) - num(r.loan) - num(r.invest))}</b>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <H2>3.7 Inflatsiooni ja tundlikkuse analüüs</H2>
      <Toggle
        label="Kasuta inflatsioonitundlikkuse tabelit"
        value={data.sensitivity.enabled}
        onChange={(v) => update("sensitivity.enabled", v)}
      />
      {data.sensitivity.enabled && (
        <div className="rounded-xl border p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field
              label="Vaikimisi kasv (protsenti)"
              value={data.sensitivity.defaultPct}
              onChange={(v) => update("sensitivity.defaultPct", v)}
              placeholder="3"
            />
          </div>
          <div className="mt-3 space-y-2">
            {data.sensitivity.rows.map((r, idx) => (
              <div key={r.id} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                <div className="md:col-span-4">
                  <Field
                    label="Teenus"
                    value={r.service}
                    onChange={(v) => {
                      const next = clone(data.sensitivity.rows);
                      next[idx].service = v;
                      update("sensitivity.rows", next);
                    }}
                  />
                </div>
                <div className="md:col-span-3">
                  <Field
                    label="Baas aastas (eurot)"
                    value={r.baseAnnual}
                    onChange={(v) => {
                      const next = clone(data.sensitivity.rows);
                      next[idx].baseAnnual = v;
                      update("sensitivity.rows", next);
                    }}
                  />
                </div>
                <div className="md:col-span-5 flex items-end">
                  <div className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    +3% <b>{eurot(num(r.baseAnnual) * 1.03)}</b> • +5%{" "}
                    <b>{eurot(num(r.baseAnnual) * 1.05)}</b>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
      )}
</div>
  );
}

function PageTechnical({ data, update }) {
  const autoSuggest = () => {
    const needs = (data.technical.systems || []).filter((s) => s.status !== "hea");
    if (!needs.length) return;
    const rows = needs.map((s) => ({
      id: uid(),
      description: `${s.name} – ${
        s.status === "vajab_kaasajastamist" ? "kaasajastamine" : "remont"
      }`,
      content: "",
      deadline: "",
      cost: "",
      fundingMulti: {
        remondifond: true,
        reserv: false,
        laen: false,
        sihtotstarbeline: false,
        uhekordne: false,
        toetus: false,
      },
      note: "",
    }));
    update("technical.plannedWorks", rows);
  };

  return (
    <div className="space-y-6">
      <H2>4.1 Süsteemide seisukord</H2>
      <div className="space-y-2">
        {(data.technical.systems || []).map((s, idx) => (
          <div key={s.id} className="grid grid-cols-1 gap-2 md:grid-cols-12">
            <div className="md:col-span-4">
              <Field
                label="Süsteem"
                value={s.name}
                onChange={(v) => {
                  const next = clone(data.technical.systems);
                  next[idx].name = v;
                  update("technical.systems", next);
                }}
              />
            </div>
            <div className="md:col-span-3">
              <Select
                label="Seisukord"
                value={s.status}
                onChange={(v) => {
                  const next = clone(data.technical.systems);
                  next[idx].status = v;
                  update("technical.systems", next);
                }}
                options={[
                  { value: "hea", label: "Hea" },
                  { value: "vajab_kaasajastamist", label: "Vajab kaasajastamist" },
                  { value: "vajab_remonti", label: "Vajab remonti" },
                ]}
              />
            </div>
            <div className="md:col-span-5">
              <Textarea
                label="Märkused"
                value={s.note}
                onChange={(v) => {
                  const next = clone(data.technical.systems);
                  next[idx].note = v;
                  update("technical.systems", next);
                }}
                placeholder="valikuline"
                rows={2}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Btn tone="ghost" onClick={autoSuggest}>
          Soovita töid seisukorra põhjal
        </Btn>
      </div>

      <H2>4.2 Planeeritud tööd</H2>
      <div className="rounded-xl border p-3">
        <div className="text-xs text-slate-600">
          Kõik siin sisestatud tööd arvestatakse eelarves investeeringute/tööde kogusummas.
        </div>
        <div className="mt-2 space-y-2">
          {(data.technical.plannedWorks || []).map((w, idx) => (
            <div key={w.id} className="rounded-xl bg-slate-50 p-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
                <div className="md:col-span-4">
                  <Field
                    label="Töö kirjeldus"
                    value={w.description}
                    onChange={(v) => {
                      const next = clone(data.technical.plannedWorks);
                      next[idx].description = v;
                      update("technical.plannedWorks", next);
                    }}
                  />
                </div>
                <div className="md:col-span-4">
                  <Field
                    label="Töö sisu"
                    value={w.content}
                    onChange={(v) => {
                      const next = clone(data.technical.plannedWorks);
                      next[idx].content = v;
                      update("technical.plannedWorks", next);
                    }}
                    placeholder="valikuline"
                  />
                </div>
                <div className="md:col-span-2">
                  <Field
                    label="Tähtaeg"
                    type="date"
                    value={w.deadline}
                    onChange={(v) => {
                      const next = clone(data.technical.plannedWorks);
                      next[idx].deadline = v;
                      update("technical.plannedWorks", next);
                    }}
                  />
                </div>
                <div className="md:col-span-2">
                  <Field
                    label="Maksumus (eurot)"
                    value={w.cost}
                    onChange={(v) => {
                      const next = clone(data.technical.plannedWorks);
                      next[idx].cost = v;
                      update("technical.plannedWorks", next);
                    }}
                  />
                </div>
              </div>

              <div className="mt-3">
                <div className="text-sm font-semibold">Rahastus (mitu võimalik)</div>
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
                  {Object.entries(w.fundingMulti || {}).map(([k, v]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!v}
                        onChange={(e) => {
                          const next = clone(data.technical.plannedWorks);
                          next[idx].fundingMulti[k] = e.target.checked;
                          update("technical.plannedWorks", next);
                        }}
                      />
                      <span>{fundingLabel(k)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-12">
                <div className="md:col-span-10">
                  <Field
                    label="Märkus"
                    value={w.note}
                    onChange={(v) => {
                      const next = clone(data.technical.plannedWorks);
                      next[idx].note = v;
                      update("technical.plannedWorks", next);
                    }}
                    placeholder="valikuline"
                  />
                </div>
                <div className="md:col-span-2 flex items-end justify-end">
                  <Btn
                    tone="ghost"
                    onClick={() => {
                      const next = (data.technical.plannedWorks || []).filter((x) => x.id !== w.id);
                      update("technical.plannedWorks", next.length ? next : makeInitial().technical.plannedWorks);
                    }}
                  >
                    Eemalda
                  </Btn>
                </div>
              </div>
            </div>
          ))}
          <Btn
            tone="ghost"
            onClick={() =>
              update("technical.plannedWorks", [
                ...(data.technical.plannedWorks || []),
                { ...makeInitial().technical.plannedWorks[0], id: uid() },
              ])
            }
          >
            + Lisa töö
          </Btn>
        </div>
      </div>

      <H2>4.3 Prioriteedid ja ohutus</H2>
      <div className="rounded-xl border p-3 space-y-2">
        {(data.technical.riskTable || []).map((r, idx) => (
          <div key={r.id} className="grid grid-cols-1 gap-2 md:grid-cols-12">
            <div className="md:col-span-4">
              <Field
                label="Süsteem"
                value={r.system}
                onChange={(v) => {
                  const next = clone(data.technical.riskTable);
                  next[idx].system = v;
                  update("technical.riskTable", next);
                }}
              />
            </div>
            <div className="md:col-span-2">
              <Select
                label="Riskitase"
                value={r.risk}
                onChange={(v) => {
                  const next = clone(data.technical.riskTable);
                  next[idx].risk = v;
                  update("technical.riskTable", next);
                }}
                options={[
                  { value: "kõrge", label: "kõrge" },
                  { value: "keskmine", label: "keskmine" },
                  { value: "madal", label: "madal" },
                ]}
              />
            </div>
            <div className="md:col-span-3">
              <Field
                label="Maksimaalne ooteaeg"
                value={r.maxWait}
                onChange={(v) => {
                  const next = clone(data.technical.riskTable);
                  next[idx].maxWait = v;
                  update("technical.riskTable", next);
                }}
                placeholder="valikuline"
              />
            </div>
            <div className="md:col-span-3">
              <Field
                label="Mõju / märkus"
                value={r.note}
                onChange={(v) => {
                  const next = clone(data.technical.riskTable);
                  next[idx].note = v;
                  update("technical.riskTable", next);
                }}
                placeholder="valikuline"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageUnits({ data, update, totalIncludedArea }) {
  return (
    <div className="space-y-6">
      <H2>5.1 Hooneosad</H2>
      <div className="rounded-xl border p-3">
        <div className="text-xs text-slate-600">
          Kui hooneosa ei lähe jaotuses arvesse, lisa põhjendus (nt kolmanda isiku ruum; kulu kandub kasutajale).
        </div>

        <div className="mt-3 space-y-2">
          {(data.units.rows || []).map((u, idx) => (
            <div key={u.id} className="grid grid-cols-1 gap-2 md:grid-cols-12">
              <div className="md:col-span-3">
                <Field
                  label="Nimetus"
                  value={u.label}
                  onChange={(v) => {
                    const next = clone(data.units.rows);
                    next[idx].label = v;
                    update("units.rows", next);
                  }}
                />
              </div>
              <div className="md:col-span-2">
                <Select
                  label="Tüüp"
                  value={u.type}
                  onChange={(v) => {
                    const next = clone(data.units.rows);
                    next[idx].type = v;
                    update("units.rows", next);
                  }}
                  options={[
                    { value: "korter", label: "korter" },
                    { value: "äripind", label: "äripind" },
                    { value: "muu", label: "muu" },
                  ]}
                />
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Pind (m²)" path={`units.rows.${idx}.area`}
                  value={u.area}
                  onChange={(v) => {
                    const next = clone(data.units.rows);
                    next[idx].area = v;
                    update("units.rows", next);
                  }}
                />
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Kaasomandi osa (valikuline)"
                  value={u.share}
                  onChange={(v) => {
                    const next = clone(data.units.rows);
                    next[idx].share = v;
                    update("units.rows", next);
                  }}
                  placeholder="valikuline"
                />
              </div>
              <div className="md:col-span-2">
                <Toggle
                  label="Jaotuses arvesse"
                  value={u.include}
                  onChange={(v) => {
                    const next = clone(data.units.rows);
                    next[idx].include = v;
                    update("units.rows", next);
                  }}
                />
              </div>
              <div className="md:col-span-1 flex items-end justify-end">
                <Btn
                  tone="ghost"
                  onClick={() => {
                    const next = (data.units.rows || []).filter((x) => x.id !== u.id);
                    update("units.rows", next.length ? next : makeInitial().units.rows);
                  }}
                >
                  ✕
                </Btn>
              </div>

              {!u.include && (
                <div className="md:col-span-12">
                  <Field
                    label="Põhjendus (kui ei lähe jaotuses arvesse)"
                    value={u.excludeReason}
                    onChange={(v) => {
                      const next = clone(data.units.rows);
                      next[idx].excludeReason = v;
                      update("units.rows", next);
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3">
          <Btn
            tone="ghost"
            onClick={() =>
              update("units.rows", [
                ...(data.units.rows || []),
                { id: uid(), label: "", type: "korter", area: "", share: "", include: true, excludeReason: "" },
              ])
            }
          >
            + Lisa hooneosa
          </Btn>
        </div>

        <Divider />
        <div className="text-sm">
          Jaotuses arvesse minev pind kokku{" "}
          <b>{round2(totalIncludedArea).toLocaleString("et-EE")} m²</b>
        </div>
      </div>

      <H2>5.2 Osakaalude arvutus</H2>
      <div className="rounded-xl bg-slate-50 p-3 text-sm">
        Osakaal arvutatakse jaotuses arvesse mineva pindala põhjal: pind / jaotuses arvesse minev pind kokku.
        Kui kaasomandi osa andmed on olemas, saab tulevikus lisada paralleelse kontrolli.
      </div>
    </div>
  );
}

function PageAdvances({ data, update, totalIncludedArea, loanDerived }) {
  const admin = num(data.incomes.adminAdvancePerM2PerMonth);
  const repair = num(data.incomes.repairFundPerM2PerMonth);
  const adminTotal = admin * totalIncludedArea;
  const repairTotal = repair * totalIncludedArea;

  return (
    <div className="space-y-6">
      <H2>6.1 Haldus ja hooldus</H2>
      <div className="rounded-xl border p-3 text-sm">
        <div>
          Kuumakse (eurot/m² kuus) <b>{eurot(admin)}</b>
        </div>
        <div>
          Kokku kuus (jaotuses) <b>{eurot(adminTotal)}</b>
        </div>
      </div>

      <H2>6.2 Remondifond</H2>
      <div className="rounded-xl border p-3 text-sm">
        <div>
          Kuumakse (eurot/m² kuus) <b>{eurot(repair)}</b>
        </div>
        <div>
          Kokku kuus (jaotuses) <b>{eurot(repairTotal)}</b>
        </div>
      </div>

      <H2>6.3 Reserv (kui kasutatakse)</H2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="Reservi kogumine kuus (eurot)"
          value={data.incomes.reservePerMonth}
          onChange={(v) => update("incomes.reservePerMonth", v)}
          placeholder="valikuline"
        />
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          Aastas <b>{eurot(num(data.incomes.reservePerMonth) * 12)}</b>
        </div>
      </div>

      <H2>Laen (mõju kuumaksele)</H2>
      <div className="rounded-xl border p-3 text-sm">
        <div>
          Laenu kuumakse kokku <b>{eurot(loanDerived.monthly)}</b>
        </div>
        <div>
          Laenu kuumakse eurot/m² <b>{eurot(loanDerived.monthlyPerM2)}</b>
        </div>
      </div>
    </div>
  );
}

function PagePayments({ payments }) {
  return (
    <div className="space-y-4">
      <H2>7. Korterite maksete tabel (kuus)</H2>
      <div className="overflow-x-auto rounded-xl border">
        <table className="min-w-[820px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="p-2">Hooneosa</th>
              <th className="p-2">Tüüp</th>
              <th className="p-2">Pind (m²)</th>
              <th className="p-2">Osakaal (%)</th>
              <th className="p-2">Haldushooldus</th>
              <th className="p-2">Remondifond</th>
              <th className="p-2">Laen</th>
              <th className="p-2">Kokku kuus</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2">
                  <div className="font-semibold">{p.label}</div>
                  {!p.include && (
                    <div className="text-xs text-slate-500">
                      Ei lähe jaotuses arvesse{p.excludeReason ? ` • ${p.excludeReason}` : ""}
                    </div>
                  )}
                </td>
                <td className="p-2">{p.type || ""}</td>
                <td className="p-2">{round2(p.area).toLocaleString("et-EE")}</td>
                <td className="p-2">
                  {p.include ? round2(p.sharePct).toLocaleString("et-EE") : ""}
                </td>
                <td className="p-2">{p.include ? eurot(p.admin) : ""}</td>
                <td className="p-2">{p.include ? eurot(p.repair) : ""}</td>
                <td className="p-2">{p.include ? eurot(p.loan) : ""}</td>
                <td className="p-2 font-semibold">{p.include ? eurot(p.totalMonthly) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PageReview({ data, update, budgetResult, incomeAnnual, runningAnnual, investmentsAnnual, checks, canPrint, onGo }) {
  const totals = [
    { label: "Tulud kokku (aastas)", value: incomeAnnual.total },
    { label: "Kulud kokku (aastas)", value: runningAnnual.total + investmentsAnnual.total + (data.loan.enabled ? num(data.loan.amount) * 0 : 0) },
    { label: "Tulemus", value: budgetResult },
  ];

  return (
    <div className="space-y-6">
      <H2>8. Ülevaatus ja vormistamine</H2>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {totals.map((t) => (
          <div key={t.label} className="rounded-2xl border bg-white p-4">
            <div className="text-xs text-slate-500">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold">{eurot(t.value)}</div>
          </div>
        ))}
      </div>

      {checks?.length ? (
        <div className="rounded-2xl border p-4">
          <div className="text-sm font-semibold">Kontrollid</div>

          {!canPrint && (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
              Mõned väljad vajavad parandamist. PDF-i genereerimine on blokeeritud, kuni punased vead on lahendatud.
            </div>
          )}

          <div className="mt-2 space-y-2 text-sm">
            {checks.length === 0 ? (
              <div className="rounded-xl bg-emerald-50 p-3 text-emerald-900">
                Kõik kontrollid on korras.
              </div>
            ) : (
              checks.map((c, i) => (
                <div
                  key={i}
                  className={
                    c.level === "error"
                      ? "rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-900"
                      : c.level === "warn"
                      ? "rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900"
                      : "rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-800"
                  }
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 text-xs font-bold">
                      {c.level === "error" ? "VIGA" : c.level === "warn" ? "HOIATUS" : "INFO"}
                    </div>
                    <div className="flex-1">
                      {c.fieldPath ? (
                        <button
                          type="button"
                          className="text-left underline underline-offset-2"
                          onClick={() => onGo?.(c.stepIndex, c.fieldPath)}
                        >
                          {c.msg}
                        </button>
                      ) : (
                        c.msg
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
          Süsteemseid hoiatusi ei leitud.
        </div>
      )}

      <div className="rounded-2xl border p-4">
        <div className="text-sm font-semibold">Vormistamise andmed</div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field
            label="Planeeritud üldkoosoleku kuupäev"
            type="date"
            value={data.finalize.plannedMeetingDate}
            onChange={(v) => update("finalize.plannedMeetingDate", v)}
          />
          <Field label="Kavandatav kehtivuse algus" path="finalize.effectiveFrom" type="date"
            value={data.finalize.effectiveFrom}
            onChange={(v) => update("finalize.effectiveFrom", v)}
          />
          <Field
            label="Koostaja / esitaja"
            value={data.finalize.preparer}
            onChange={(v) => update("finalize.preparer", v)}
            placeholder="Nt juhatuse liige / juhatuse liikmed"
          />
        </div>

        <div className="mt-3 text-xs text-slate-500">
          PDF-is vormindatakse kuupäevad kujule pp.kk.aaaa ning tühjad read jäetakse välja.
        </div>
      </div>

      <div className="rounded-2xl border bg-slate-900 p-4 text-white">
        <div className="text-sm font-semibold">Lõplik samm</div>
        <div className="mt-1 text-sm text-slate-200">
          Genereeri majanduskava PDF (sisaldab kõiki samme ja tühjad väljad jäetakse välja).
        </div>
        <div className="mt-3">
          <Btn onClick={() => window.print()}>Genereeri majanduskava PDF</Btn>
        </div>
      </div>
    </div>
  );
}


function PrintAll({
  data,
  incomeAnnual,
  runningAnnual,
  investmentsAnnual,
  budgetResult,
  loanDerived,
  payments,
  totalIncludedArea,
  needCashflow,
}) {
  // --- filter logic for print (no empties, no placeholders) ---
  const otherIncomeRows = (data.incomes.otherIncomes || []).filter(
    (r) => hasText(r.name) || hasNum(r.amountAnnual) || hasText(r.note)
  );

  const serviceRows = (data.runningCosts.services || []).filter(
    (r) => hasText(r.name || r.service) || hasNum(r.annualCost) || hasText(r.provider) || hasText(r.annualQty)
  );

  const plannedRows = (data.technical.plannedWorks || []).filter(
    (r) => hasText(r.description) || hasText(r.content) || hasNum(r.cost) || hasText(r.deadline) || anyTruthy(r.fundingMulti) || hasText(r.note)
  );

  const systemsRows = (data.technical.systems || []).filter(
    (r) => hasText(r.name) && (r.status !== "hea" || hasText(r.note))
  );

  const riskRows = (data.technical.riskTable || []).filter(
    (r) => hasText(r.system) || hasText(r.risk) || hasText(r.maxWait) || hasText(r.note)
  );

  const cashRows = (data.cashflow.rows || []).filter(
    (r) => hasText(r.month) && (hasNum(r.income) || hasNum(r.cost) || hasNum(r.loan) || hasNum(r.invest))
  );

  const sensitivityRows = (data.sensitivity.rows || []).filter(
    (r) => hasText(r.name || r.service) && hasNum(r.baseAnnual)
  );

  const unitRows = (data.units.rows || []).filter(
    (u) => hasText(u.label) || hasNum(u.area) || hasText(u.share) || hasText(u.excludeReason)
  );

  const showGeneral =
    hasText(data.general.name) ||
    hasText(data.general.regCode) ||
    hasText(data.general.address) ||
    hasText(data.general.periodStart) ||
    hasText(data.general.periodEnd) ||
    hasText(data.general.meetingDate);

  const showBuildingMin =
    hasText(data.buildingMin.apartmentsCount) ||
    hasText(data.buildingMin.businessUnitsCount) ||
    hasText(data.buildingMin.heatedAreaTotal);

  const showDistribution =
    hasText(data.distribution.base) ||
    data.distribution.areaProxyNote ||
    data.distribution.charterExceptionEnabled;

  const showBudget =
    hasNum(incomeAnnual.total) ||
    hasNum(runningAnnual.total) ||
    hasNum(investmentsAnnual.total) ||
    otherIncomeRows.length ||
    serviceRows.length ||
    plannedRows.length ||
    data.loan.enabled ||
    (needCashflow && cashRows.length) ||
    (data.sensitivity.enabled && sensitivityRows.length);

  const showTechnical = systemsRows.length || riskRows.length;

  const showUnits = unitRows.length;

  const showPayments = (payments || []).some((p) => p.include && (hasNum(p.admin) || hasNum(p.repair) || hasNum(p.loan)));

  const showConfirmation =
    hasText(data.general.meetingDate) || hasText(data.general.approvedBy) || hasText(data.general.validFrom);

  return (
    <div className="p-8 text-slate-900">
      <div className="page">
        <div className="text-2xl font-semibold">Majanduskava</div>
        {(hasText(data.general.periodStart) || hasText(data.general.periodEnd)) && (
          <div className="mt-2 text-sm text-slate-700">
            {hasText(data.general.periodStart) && <>Periood {data.general.periodStart}</>}
            {hasText(data.general.periodStart) && hasText(data.general.periodEnd) ? " kuni " : ""}
            {hasText(data.general.periodEnd) && <>{data.general.periodEnd}</>}
          </div>
        )}
      </div>

      {showGeneral && (
        <SectionPrint title="1. Üldandmed">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border p-3">
              <div className="font-semibold">Korteriühistu</div>
              {hasText(data.general.name) && <div>Nimi: {data.general.name}</div>}
              {hasText(data.general.regCode) && <div>Registrikood: {data.general.regCode}</div>}
              {hasText(data.general.address) && <div>Aadress: {data.general.address}</div>}
              {hasText(data.general.meetingDate) && <div>Üldkoosoleku kuupäev: {formatDateEt(data.general.meetingDate)}</div>}
            </div>

            {showBuildingMin && (
              <div className="rounded-lg border p-3">
                <div className="font-semibold">Ehitise põhiandmed</div>
                {hasText(data.buildingMin.apartmentsCount) && <div>Korterite arv: {data.buildingMin.apartmentsCount}</div>}
                {hasText(data.buildingMin.businessUnitsCount) && <div>Äripindade arv: {data.buildingMin.businessUnitsCount}</div>}
                {hasText(data.buildingMin.heatedAreaTotal) && <div>Köetav pind kokku: {data.buildingMin.heatedAreaTotal} m²</div>}
                {totalIncludedArea > 0 && (
                  <div className="mt-2 text-xs text-slate-500">
                    Jaotuses arvesse minev pind: {round2(totalIncludedArea).toLocaleString("et-EE")} m²
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionPrint>
      )}

      {showDistribution && (
        <SectionPrint title="2. Kohustuste jaotuse alus">
          <div className="text-sm space-y-2">
            {hasText(data.distribution.base) && (
              <div>
                Perioodiliste ettemaksete alus: <b>{distributionLabel(data.distribution.base)}</b>
              </div>
            )}

            {data.distribution.areaProxyNote && (
              <div className="text-slate-700">
                Pindala kasutamine on arvutuslik vahend proportsiooni määramiseks (mitte eraldiseisev õiguslik asendus).
              </div>
            )}

            <div className="text-slate-700">
              Tegelik tarbimine rakendub ainult teenustele (küte, vesi, individuaalne elekter, era-teenus). Remondifond, reserv ja üldhaldus jäävad põhireegli alla.
            </div>

            {data.distribution.charterExceptionEnabled && hasText(data.distribution.charterExceptionText) && (
              <div className="rounded-lg border p-2">
                <div className="font-semibold">Põhikirjajärgne erisus</div>
                <div className="whitespace-pre-wrap">{data.distribution.charterExceptionText}</div>
              </div>
            )}
          </div>
        </SectionPrint>
      )}

      {showBudget && (
        <SectionPrint title="3. Tulude ja kulude prognoos">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {(hasNum(incomeAnnual.total) || otherIncomeRows.length) && (
              <div className="rounded-lg border p-3">
                <div className="font-semibold">Tulud kokku</div>
                {hasNum(incomeAnnual.admin) && <div className="mt-1">Haldushooldus: {eurot(incomeAnnual.admin)}</div>}
                {hasNum(incomeAnnual.repair) && <div>Remondifond: {eurot(incomeAnnual.repair)}</div>}
                {hasNum(incomeAnnual.reserve) && <div>Reserv: {eurot(incomeAnnual.reserve)}</div>}
                {hasNum(incomeAnnual.other) && <div>Muud tulud: {eurot(incomeAnnual.other)}</div>}
                {hasNum(incomeAnnual.total) && <div className="mt-2 font-semibold">Kokku: {eurot(incomeAnnual.total)}</div>}
              </div>
            )}

            {(hasNum(runningAnnual.total) || hasNum(investmentsAnnual.total) || hasNum(budgetResult)) && (
              <div className="rounded-lg border p-3">
                <div className="font-semibold">Kulud kokku</div>
                {hasNum(runningAnnual.total) && <div className="mt-1">Jooksvad kulud: {eurot(runningAnnual.total)}</div>}
                {hasNum(investmentsAnnual.total) && <div>Investeeringud ja tööd: {eurot(investmentsAnnual.total)}</div>}
                {hasNum(budgetResult) && <div className="mt-2 font-semibold">Tulemus: {eurot(budgetResult)}</div>}
              </div>
            )}
          </div>

          {serviceRows.length > 0 && (
            <>
              <div className="mt-4 text-sm font-semibold">Jooksvad kulud (teenused)</div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left">Teenus</th>
                    <th className="py-1 text-left">Teenuse osutaja</th>
                    <th className="py-1 text-left">Kogus aastas</th>
                    <th className="py-1 text-left">Aastakulu</th>
                    <th className="py-1 text-left">Jaotuse alus</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceRows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-1">{hasText(r.name || r.service) ? r.service : ""}</td>
                      <td className="py-1">{hasText(r.provider) ? r.provider : ""}</td>
                      <td className="py-1">{hasText(r.annualQty) ? r.annualQty : ""}</td>
                      <td className="py-1">{hasNum(r.annualCost) ? eurot(r.annualCost) : ""}</td>
                      <td className="py-1">{hasText(r.basis) ? basisLabel(r.basis) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {plannedRows.length > 0 && (
            <>
              <div className="mt-4 text-sm font-semibold">Investeeringud ja suuremad tööd</div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left">Töö</th>
                    <th className="py-1 text-left">Prioriteet</th>
                    <th className="py-1 text-left">Tähtaeg</th>
                    <th className="py-1 text-left">Maksumus</th>
                    <th className="py-1 text-left">Rahastus</th>
                  </tr>
                </thead>
                <tbody>
                                    {plannedRows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-1">{hasText(r.description) ? r.description : ""}</td>
                      <td className="py-1"></td>
                      <td className="py-1">{hasText(r.deadline) ? formatDateEt(r.deadline) : ""}</td>
                      <td className="py-1">{hasNum(r.cost) ? eurot(r.cost) : ""}</td>
                      <td className="py-1">{fundingText(r.fundingMulti)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {data.loan.enabled && (hasNum(data.loan.amount) || hasText(data.loan.lender) || hasNum(data.loan.interestPct) || hasNum(data.loan.years)) && (
            <div className="mt-4 rounded-lg border p-3 text-sm">
              <div className="font-semibold">Laen</div>
              {hasText(data.loan.lender) && <div>Pank: {data.loan.lender}</div>}
              {hasNum(data.loan.amount) && <div>Laenusumma: {eurot(data.loan.amount)}</div>}
              {hasNum(data.loan.interestPct) && <div>Intress: {data.loan.interestPct} protsenti</div>}
              {hasNum(data.loan.years) && <div>Periood: {data.loan.years} aastat</div>}
              <div className="mt-2">
                Kuumakse kokku <b>{eurot(loanDerived.monthly)}</b>
              </div>
              <div>
                Kuumakse eurot/m² <b>{eurot(loanDerived.monthlyPerM2)}</b>
              </div>
              <div>
                Laenu kogukulu perioodil <b>{eurot(loanDerived.totalCost)}</b>
              </div>
            </div>
          )}

          {needCashflow && cashRows.length > 0 && (
            <>
              <div className="mt-4 text-sm font-semibold">Kuupõhine jaotus (rahavoog)</div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left">Kuu</th>
                    <th className="py-1 text-left">Tulud</th>
                    <th className="py-1 text-left">Kulud</th>
                    <th className="py-1 text-left">Laen</th>
                    <th className="py-1 text-left">Investeering</th>
                    <th className="py-1 text-left">Tulemus</th>
                  </tr>
                </thead>
                <tbody>
                  {cashRows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-1">{r.month}</td>
                      <td className="py-1">{hasNum(r.income) ? eurot(r.income) : ""}</td>
                      <td className="py-1">{hasNum(r.cost) ? eurot(r.cost) : ""}</td>
                      <td className="py-1">{hasNum(r.loan) ? eurot(r.loan) : ""}</td>
                      <td className="py-1">{hasNum(r.invest) ? eurot(r.invest) : ""}</td>
                      <td className="py-1">
                        <b>{eurot(num(r.income) - num(r.cost) - num(r.loan) - num(r.invest))}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {data.sensitivity.enabled && sensitivityRows.length > 0 && (
            <>
              <div className="mt-4 text-sm font-semibold">Inflatsiooni ja tundlikkuse analüüs</div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left">Teenus</th>
                    <th className="py-1 text-left">Baas (aastas)</th>
                    <th className="py-1 text-left">+3%</th>
                    <th className="py-1 text-left">+5%</th>
                  </tr>
                </thead>
                <tbody>
                  {sensitivityRows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-1">{r.service}</td>
                      <td className="py-1">{eurot(r.baseAnnual)}</td>
                      <td className="py-1">{eurot(num(r.baseAnnual) * 1.03)}</td>
                      <td className="py-1">{eurot(num(r.baseAnnual) * 1.05)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </SectionPrint>
      )}

      {showTechnical && (
        <SectionPrint title="4. Tehniline seisukord ja planeeritud tööd">
          {systemsRows.length > 0 && (
            <>
              <div className="text-sm font-semibold">Süsteemide seisukord</div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left">Süsteem</th>
                    <th className="py-1 text-left">Seisukord</th>
                    <th className="py-1 text-left">Märkused</th>
                  </tr>
                </thead>
                <tbody>
                  {systemsRows.map((s) => (
                    <tr key={s.id} className="border-b">
                      <td className="py-1">{s.name}</td>
                      <td className="py-1">{techLabel(s.status)}</td>
                      <td className="py-1">{hasText(s.note) ? s.note : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {riskRows.length > 0 && (
            <>
              <div className="mt-4 text-sm font-semibold">Prioriteedid ja ohutus</div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left">Süsteem</th>
                    <th className="py-1 text-left">Riskitase</th>
                    <th className="py-1 text-left">Maksimaalne ooteaeg</th>
                    <th className="py-1 text-left">Mõju</th>
                  </tr>
                </thead>
                <tbody>
                  {riskRows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-1">{hasText(r.system) ? r.system : ""}</td>
                      <td className="py-1">{hasText(r.risk) ? r.risk : ""}</td>
                      <td className="py-1">{hasText(r.maxWait) ? r.maxWait : ""}</td>
                      <td className="py-1">{hasText(r.note) ? r.note : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </SectionPrint>
      )}

      {showUnits && (
        <SectionPrint title="5. Hooneosad ja jaotus">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-1 text-left">Hooneosa</th>
                <th className="py-1 text-left">Tüüp</th>
                <th className="py-1 text-left">Pind (m²)</th>
                <th className="py-1 text-left">Kaasomandi osa</th>
                <th className="py-1 text-left">Jaotuses arvesse</th>
                <th className="py-1 text-left">Põhjendus</th>
              </tr>
            </thead>
            <tbody>
              {unitRows.map((u) => (
                <tr key={u.id} className="border-b">
                  <td className="py-1">{hasText(u.label) ? u.label : ""}</td>
                  <td className="py-1">{hasText(u.type) ? u.type : ""}</td>
                  <td className="py-1">{hasNum(u.area) ? round2(num(u.area)).toLocaleString("et-EE") : ""}</td>
                  <td className="py-1">{hasText(u.share) ? u.share : ""}</td>
                  <td className="py-1">{u.include ? "jah" : "ei"}</td>
                  <td className="py-1">{!u.include && hasText(u.excludeReason) ? u.excludeReason : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionPrint>
      )}

      {showPayments && (
        <SectionPrint title="6–7. Perioodilised ettemaksed ja maksete tabel">
          <div className="text-sm space-y-1">
            {hasNum(data.incomes.adminAdvancePerM2PerMonth) && (
              <div>
                Haldus ja hooldus (eurot/m² kuus): <b>{eurot(data.incomes.adminAdvancePerM2PerMonth)}</b>
              </div>
            )}
            {hasNum(data.incomes.repairFundPerM2PerMonth) && (
              <div>
                Remondifond (eurot/m² kuus): <b>{eurot(data.incomes.repairFundPerM2PerMonth)}</b>
              </div>
            )}
            {hasNum(data.incomes.reservePerMonth) && (
              <div>
                Reserv (eurot kuus): <b>{eurot(data.incomes.reservePerMonth)}</b>
              </div>
            )}
            {data.loan.enabled && hasNum(loanDerived.monthlyPerM2) && (
              <div>
                Laen (kuumakse eurot/m²): <b>{eurot(loanDerived.monthlyPerM2)}</b>
              </div>
            )}
          </div>

          <div className="mt-4 text-sm font-semibold">Kuumaksed hooneosade lõikes</div>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-1 text-left">Hooneosa</th>
                <th className="py-1 text-left">Pind (m²)</th>
                <th className="py-1 text-left">Haldushooldus</th>
                <th className="py-1 text-left">Remondifond</th>
                <th className="py-1 text-left">Laen</th>
                <th className="py-1 text-left">Kokku kuus</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                if (!p.include) return null;
                const rowHas =
                  hasNum(p.area) || hasNum(p.admin) || hasNum(p.repair) || hasNum(p.loan) || hasText(p.label);
                if (!rowHas) return null;
                return (
                  <tr key={p.id} className="border-b">
                    <td className="py-1">{hasText(p.label) ? p.label : ""}</td>
                    <td className="py-1">{hasNum(p.area) ? round2(p.area).toLocaleString("et-EE") : ""}</td>
                    <td className="py-1">{hasNum(p.admin) ? eurot(p.admin) : ""}</td>
                    <td className="py-1">{hasNum(p.repair) ? eurot(p.repair) : ""}</td>
                    <td className="py-1">{hasNum(p.loan) ? eurot(p.loan) : ""}</td>
                    <td className="py-1">
                      <b>{hasNum(p.totalMonthly) ? eurot(p.totalMonthly) : ""}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SectionPrint>
      )}

      {showConfirmation && (
        <SectionPrint title="8. Kinnitamine">
          <div className="text-sm space-y-1">
            {hasText(data.general.meetingDate) && <div>Üldkoosoleku kuupäev: {formatDateEt(data.general.meetingDate)}</div>}
            {hasText(data.general.approvedBy) && <div>Kinnitas: {data.general.approvedBy}</div>}
            {hasText(data.general.validFrom) && <div>Kehtib alates: {data.general.validFrom}</div>}
          </div>
        </SectionPrint>
      )}
    
      <SectionPrint title="8. Ülevaatus ja vormistamine">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-500">Tulud kokku (aastas)</div>
            <div className="mt-1 text-lg font-semibold">{eurot(incomeAnnual.total)}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-500">Kulud kokku (aastas)</div>
            <div className="mt-1 text-lg font-semibold">{eurot(runningAnnual.total + investmentsAnnual.total)}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-500">Tulemus</div>
            <div className="mt-1 text-lg font-semibold">{eurot(budgetResult)}</div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border p-3 text-sm space-y-1">
          {hasText(data.finalize?.plannedMeetingDate) && (
            <div>
              Esitatakse kinnitamiseks üldkoosolekule: <b>{formatDateEt(data.finalize?.plannedMeetingDate)}</b>
            </div>
          )}
          {hasText(data.finalize?.effectiveFrom) && (
            <div>
              Kavandatav kehtivuse algus: <b>{formatDateEt(data.finalize?.effectiveFrom)}</b>
            </div>
          )}
          {hasText(data.finalize?.preparer) && (
            <div>
              Koostaja / esitaja: <b>{data.finalize?.preparer}</b>
            </div>
          )}
        </div>
      </SectionPrint>
</div>
  );
}



function SectionPrint({ title, children }) {
  return (
    <div className="page mt-6">
      <div className="text-lg font-semibold">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

// ------------------------- labels -------------------------
function fundingLabel(k) {
  return (
    {
      remondifond: "Remondifond",
      reserv: "Reserv",
      laen: "Laen",
      sihtotstarbeline: "Sihtotstarbelised maksed",
      uhekordne: "Ühekordsed maksed",
      toetus: "Toetus",
    }[k] || k
  );
}

function fundingText(obj) {
  const keys = Object.entries(obj || {})
    .filter(([, v]) => !!v)
    .map(([k]) => fundingLabel(k));
  return keys.length ? keys.join(", ") : "";
}

function distributionLabel(v) {
  return (
    {
      kaasomandi: "Kaasomandi osa (põhireegel)",
      pindala_proxy: "Pindala (m²) kui arvutuslik vahend",
      kombineeritud: "Kombineeritud",
    }[v] || v
  );
}

function basisLabel(v) {
  return (
    {
      kaasomandi: "põhireegel",
      tarbimine: "tarbimine",
      muu: "muu",
    }[v] || v
  );
}

function techLabel(v) {
  return (
    {
      hea: "Hea",
      vajab_kaasajastamist: "Vajab kaasajastamist",
      vajab_remonti: "Vajab remonti",
    }[v] || v
  );
}