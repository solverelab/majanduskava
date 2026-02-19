import { useState, useMemo } from "react";

// ─── Default data ────────────────────────────────────────────────────────────
const DEFAULT_BUILDING = {
  nimi: "",
  registrikood: "",
  aadress: "",
  majandusaasta: new Date().getFullYear().toString(),
  ehitusaasta: "",
  korruselisus: "",
  koguPind_m2: "",
  kaasomandiOsadeKoguarv: "",
};

const DEFAULT_COST_ITEMS = [
  { id: "B1",  kategooria: "jooksev", nimetus: "Soojusenergia (küttekulud)",                          kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B2",  kategooria: "jooksev", nimetus: "Elekter (üldkasutatavad ruumid)",                     kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B3",  kategooria: "jooksev", nimetus: "Vesi ja kanalisatsioon",                              kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B4",  kategooria: "jooksev", nimetus: "Gaas (kui kohaldub)",                                 kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B5",  kategooria: "jooksev", nimetus: "Prügivedu ja jäätmekäitlus",                          kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B6",  kategooria: "jooksev", nimetus: "Korstnapühkimine ja seadmete hooldus",                kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B7",  kategooria: "jooksev", nimetus: "Liftihooldus",                                        kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B8",  kategooria: "jooksev", nimetus: "Tulekustutite ja -signalisatsiooni hooldus",          kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B9",  kategooria: "jooksev", nimetus: "Lumekoristus ja heakord",                             kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B10", kategooria: "jooksev", nimetus: "Haljastus ja territooriumi hooldus",                  kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B11", kategooria: "jooksev", nimetus: "Kindlustus (hoonekindlustus, vastutuskindlustus)",    kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B12", kategooria: "jooksev", nimetus: "Valitseja- või halduslepingu tasu",                   kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B13", kategooria: "jooksev", nimetus: "Raamatupidamisteenus",                                kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B14", kategooria: "jooksev", nimetus: "Pangakulud ja tehingutasud",                          kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B15", kategooria: "jooksev", nimetus: "Juriidilised ja notariteenused",                      kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "B16", kategooria: "jooksev", nimetus: "Muud jooksvad kulud",                                 kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "C1",  kategooria: "remont",  nimetus: "Planeeritud remondifondist finantseeritavad tööd",    kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "C2",  kategooria: "remont",  nimetus: "Laenuteeninduse põhiosa tagasimaksed",                kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "C3",  kategooria: "remont",  nimetus: "Laenuteeninduse intressimaksed",                      kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
  { id: "C4",  kategooria: "remont",  nimetus: "Muud investeeringud / erakorralised kulud",           kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
];

const DEFAULT_UNIT = (nr) => ({
  id: crypto.randomUUID(),
  nr,
  nimi: "",
  kaasomandiOsaLugeja: "",
  kaasomandiOsaNimetaja: "",
  m2: "",
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
const n = (v) => parseFloat(v) || 0;
const eur = (v) => v.toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => (v * 100).toFixed(2) + " %";

// ─── Validation ──────────────────────────────────────────────────────────────
function validate(building, units, costItems) {
  const errors = [];

  if (!building.nimi.trim()) errors.push("Korteriühistu nimi on täitmata.");
  if (!building.majandusaasta.trim()) errors.push("Majandusaasta on täitmata.");
  if (!n(building.kaasomandiOsadeKoguarv)) errors.push("Kaasomandi osade koguarv (nimetaja) on täitmata.");

  if (units.length === 0) errors.push("Lisa vähemalt üks korteriomand.");

  const nimetaja = n(building.kaasomandiOsadeKoguarv);
  const osadeSumma = units.reduce((s, u) => s + n(u.kaasomandiOsaLugeja), 0);
  if (nimetaja > 0 && Math.abs(osadeSumma - nimetaja) > 0.01) {
    errors.push(
      `Kaasomandi osade lugejate summa (${osadeSumma}) ei võrdu nimetajaga (${nimetaja}).`
    );
  }

  const usesM2 = costItems.some((c) => c.jaotusmeetod === "m2");
  if (usesM2) {
    const missingM2 = units.filter((u) => !n(u.m2));
    if (missingM2.length > 0)
      errors.push(`m²-põhine jaotus on valitud, kuid ${missingM2.length} korteriomandil puudub m².`);
    if (!n(building.koguPind_m2))
      errors.push("m²-põhine jaotus on valitud, kuid hoone kogu üldpind (m²) on täitmata.");
    const m2Sum = units.reduce((s, u) => s + n(u.m2), 0);
    const totalM2 = n(building.koguPind_m2);
    if (totalM2 > 0 && Math.abs(m2Sum - totalM2) > 0.5)
      errors.push(`Korterite m² summa (${m2Sum.toFixed(1)}) erineb hoone kogupinnast (${totalM2}).`);
  }

  const unitsMissingName = units.filter((u) => !u.nimi.trim());
  if (unitsMissingName.length > 0)
    errors.push(`${unitsMissingName.length} korteriomandil puudub nimi/number.`);

  const unitsMissingOsa = units.filter((u) => !n(u.kaasomandiOsaLugeja) || !n(u.kaasomandiOsaNimetaja));
  if (unitsMissingOsa.length > 0)
    errors.push(`${unitsMissingOsa.length} korteriomandil puudub kaasomandi osa (lugeja/nimetaja).`);

  return errors;
}

// ─── Distribution calc ────────────────────────────────────────────────────────
function calcDistribution(units, costItems, building) {
  const nimetaja = n(building.kaasomandiOsadeKoguarv);
  const totalM2 = units.reduce((s, u) => s + n(u.m2), 0);
  const activeCosts = costItems.filter((c) => n(c.kavandatav_eur) > 0);
  const totalYear = activeCosts.reduce((s, c) => s + n(c.kavandatav_eur), 0);

  return units.map((unit) => {
    const osa = nimetaja > 0 ? n(unit.kaasomandiOsaLugeja) / nimetaja : 0;
    const m2share = totalM2 > 0 ? n(unit.m2) / totalM2 : 0;

    let yearTotal = 0;
    const breakdown = activeCosts.map((cost) => {
      const share = cost.jaotusmeetod === "m2" ? m2share : osa;
      const amount = n(cost.kavandatav_eur) * share;
      yearTotal += amount;
      return { ...cost, amount };
    });

    return {
      unit,
      osa,
      yearTotal,
      monthTotal: yearTotal / 12,
      breakdown,
    };
  });
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function Input({ label, value, onChange, placeholder, type = "text", className = "" }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-xs font-semibold tracking-widest uppercase text-slate-400">{label}</label>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors font-mono"
      />
    </div>
  );
}

function ErrorBanner({ errors }) {
  if (!errors.length) return null;
  return (
    <div className="bg-red-950 border border-red-700 rounded-lg p-4 mb-6">
      <p className="text-red-400 font-semibold text-xs tracking-widest uppercase mb-2">⚠ Vead / puuduvad andmed</p>
      <ul className="space-y-1">
        {errors.map((e, i) => (
          <li key={i} className="text-red-300 text-sm flex gap-2">
            <span className="text-red-600 shrink-0">→</span> {e}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Badge({ children, color = "sky" }) {
  const cls = {
    sky:   "bg-sky-900/60 text-sky-300 border-sky-700",
    amber: "bg-amber-900/60 text-amber-300 border-amber-700",
    slate: "bg-slate-800 text-slate-400 border-slate-700",
    green: "bg-green-900/60 text-green-300 border-green-700",
  }[color] || "bg-slate-800 text-slate-300 border-slate-700";
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${cls}`}>{children}</span>
  );
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "uldinfo",  label: "1. Üldinfo" },
  { id: "korterid", label: "2. Korterid" },
  { id: "kulud",    label: "3. Kulud" },
  { id: "jaotus",   label: "4. Jaotus" },
];

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function MajanduskavaApp() {
  const [tab, setTab] = useState("uldinfo");
  const [building, setBuilding] = useState(DEFAULT_BUILDING);
  const [units, setUnits] = useState([DEFAULT_UNIT(1)]);
  const [costItems, setCostItems] = useState(DEFAULT_COST_ITEMS);

  const setB = (key) => (val) => setBuilding((b) => ({ ...b, [key]: val }));

  const errors = useMemo(() => validate(building, units, costItems), [building, units, costItems]);
  const distribution = useMemo(() => calcDistribution(units, costItems, building), [units, costItems, building]);

  const totalYear = costItems.reduce((s, c) => s + n(c.kavandatav_eur), 0);
  const totalJooksev = costItems.filter((c) => c.kategooria === "jooksev").reduce((s, c) => s + n(c.kavandatav_eur), 0);
  const totalRemont = costItems.filter((c) => c.kategooria === "remont").reduce((s, c) => s + n(c.kavandatav_eur), 0);

  // Units CRUD
  const addUnit = () =>
    setUnits((u) => [...u, DEFAULT_UNIT(u.length + 1)]);
  const removeUnit = (id) =>
    setUnits((u) => u.filter((x) => x.id !== id).map((x, i) => ({ ...x, nr: i + 1 })));
  const updateUnit = (id, key, val) =>
    setUnits((u) => u.map((x) => (x.id === id ? { ...x, [key]: val } : x)));

  // Cost items
  const updateCost = (id, key, val) =>
    setCostItems((c) => c.map((x) => (x.id === id ? { ...x, [key]: val } : x)));
  const addCost = (kategooria) =>
    setCostItems((c) => [
      ...c,
      { id: crypto.randomUUID(), kategooria, nimetus: "", kavandatav_eur: "", jaotusmeetod: "kaasomandiOsa" },
    ]);
  const removeCost = (id) =>
    setCostItems((c) => c.filter((x) => x.id !== id));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "'DM Mono', 'Courier New', monospace" }}>
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-950/95 sticky top-0 z-10 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs tracking-widest uppercase text-slate-500 mb-1">KrtS § 41 lg 1</p>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">Korteriühistu Majanduskava</h1>
            {building.nimi && <p className="text-sky-400 text-sm mt-0.5">{building.nimi} · {building.majandusaasta}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-slate-600 mb-1">Kulud kokku / aastas</p>
            <p className="text-2xl font-bold text-sky-400 tabular-nums">{eur(totalYear)} €</p>
            <p className="text-xs text-slate-500">{eur(totalYear / 12)} € / kuu</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-6 flex gap-1 pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-xs font-semibold tracking-widest uppercase border-b-2 transition-all ${
                tab === t.id
                  ? "border-sky-400 text-sky-400"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
          {errors.length > 0 && (
            <span className="ml-auto self-center text-xs font-mono text-red-400 bg-red-950 px-2 py-1 rounded border border-red-800">
              {errors.length} viga
            </span>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* ── TAB 1: Üldinfo ── */}
        {tab === "uldinfo" && (
          <div className="space-y-8">
            <section>
              <h2 className="section-title">A. Korteriühistu andmed</h2>
              <div className="card grid grid-cols-2 gap-4">
                <Input label="Korteriühistu nimi" value={building.nimi} onChange={setB("nimi")} placeholder="nt Liiva 5 KÜ" className="col-span-2" />
                <Input label="Registrikood" value={building.registrikood} onChange={setB("registrikood")} placeholder="80000000" />
                <Input label="Aadress" value={building.aadress} onChange={setB("aadress")} placeholder="Liiva tn 5, Tallinn" />
                <Input label="Juhatuse liige" value={building.juhatuseliige || ""} onChange={setB("juhatuseliige")} placeholder="Nimi, telefon" className="col-span-2" />
              </div>
            </section>

            <section>
              <h2 className="section-title">B. Majandusaasta</h2>
              <div className="card grid grid-cols-2 gap-4">
                <Input label="Majandusaasta" value={building.majandusaasta} onChange={setB("majandusaasta")} placeholder="2025" />
                <Input label="Periood" value={building.periood || ""} onChange={setB("periood")} placeholder="01.01.2025 – 31.12.2025" />
              </div>
            </section>

            <section>
              <h2 className="section-title">C. Korteriomandite ülevaade</h2>
              <div className="card grid grid-cols-2 gap-4">
                <Input label="Ehitusaasta" value={building.ehitusaasta} onChange={setB("ehitusaasta")} placeholder="1975" />
                <Input label="Korruselisus" value={building.korruselisus} onChange={setB("korruselisus")} placeholder="5" />
                <Input label="Korteriomandite arv kokku" value={building.korteriomandikeArv || ""} onChange={setB("korteriomandikeArv")} placeholder="24" />
                <Input label="Kaasomandi osade koguarv (nimetaja)" value={building.kaasomandiOsadeKoguarv} onChange={setB("kaasomandiOsadeKoguarv")} placeholder="10000" />
                <Input label="Korterite koguüldpind (m²)" value={building.koguPind_m2} onChange={setB("koguPind_m2")} placeholder="1200" className="col-span-2" />
              </div>
            </section>
          </div>
        )}

        {/* ── TAB 2: Korterid ── */}
        {tab === "korterid" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-100">Korteriomandite nimekiri</h2>
                <p className="text-xs text-slate-500 mt-1">Kaasomandi osa määrab maksekohustuse proportsioonid (KrtS § 40 lg 1)</p>
              </div>
              <button onClick={addUnit} className="btn-primary">+ Lisa korter</button>
            </div>

            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Kortereid" value={units.length} />
              <StatCard label="Osade summa" value={`${units.reduce((s, u) => s + n(u.kaasomandiOsaLugeja), 0)} / ${n(building.kaasomandiOsadeKoguarv) || "?"}`} />
              <StatCard label="m² summa" value={`${units.reduce((s, u) => s + n(u.m2), 0).toFixed(1)} / ${n(building.koguPind_m2) || "?"}`} />
            </div>

            {/* Units table */}
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="th">Nr</th>
                    <th className="th">Korteriomand / omanik</th>
                    <th className="th">Kaasomandi osa</th>
                    <th className="th">Osakaal</th>
                    <th className="th">m²</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => {
                    const nimetaja = n(building.kaasomandiOsadeKoguarv);
                    const osa = nimetaja > 0 ? n(unit.kaasomandiOsaLugeja) / nimetaja : null;
                    return (
                      <tr key={unit.id} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                        <td className="td text-slate-500 w-10">{unit.nr}</td>
                        <td className="td">
                          <input
                            value={unit.nimi}
                            onChange={(e) => updateUnit(unit.id, "nimi", e.target.value)}
                            placeholder={`Korter ${unit.nr}`}
                            className="inline-input w-full"
                          />
                        </td>
                        <td className="td">
                          <div className="flex items-center gap-1">
                            <input
                              value={unit.kaasomandiOsaLugeja}
                              onChange={(e) => updateUnit(unit.id, "kaasomandiOsaLugeja", e.target.value)}
                              placeholder="lugeja"
                              className="inline-input w-20 text-right"
                            />
                            <span className="text-slate-600">/</span>
                            <input
                              value={unit.kaasomandiOsaNimetaja}
                              onChange={(e) => updateUnit(unit.id, "kaasomandiOsaNimetaja", e.target.value)}
                              placeholder={building.kaasomandiOsadeKoguarv || "nimetaja"}
                              className="inline-input w-20"
                            />
                          </div>
                        </td>
                        <td className="td tabular-nums text-slate-400 text-xs">
                          {osa !== null && n(unit.kaasomandiOsaLugeja) > 0 ? pct(osa) : "—"}
                        </td>
                        <td className="td">
                          <input
                            value={unit.m2}
                            onChange={(e) => updateUnit(unit.id, "m2", e.target.value)}
                            placeholder="0.0"
                            className="inline-input w-20 text-right"
                          />
                        </td>
                        <td className="td">
                          <button onClick={() => removeUnit(unit.id)} className="text-slate-700 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 3: Kulud ── */}
        {tab === "kulud" && (
          <div className="space-y-8">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Jooksvad kulud" value={`${eur(totalJooksev)} €`} />
              <StatCard label="Remondi- ja investeerimiskulud" value={`${eur(totalRemont)} €`} />
              <StatCard label="Kulud kokku" value={`${eur(totalYear)} €`} accent />
            </div>

            {["jooksev", "remont"].map((kat) => {
              const label = kat === "jooksev" ? "B. Jooksvad majandamiskulud" : "C. Remondi- ja investeerimiskulud";
              const items = costItems.filter((c) => c.kategooria === kat);
              const katTotal = items.reduce((s, c) => s + n(c.kavandatav_eur), 0);
              return (
                <section key={kat}>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="section-title mb-0">{label}</h2>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono text-slate-300">{eur(katTotal)} €</span>
                      <button onClick={() => addCost(kat)} className="btn-secondary text-xs">+ Lisa kirje</button>
                    </div>
                  </div>
                  <div className="card overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="th">Kulurida</th>
                          <th className="th w-36">Summa aastas (€)</th>
                          <th className="th w-40">Jaotus</th>
                          <th className="th w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((cost) => (
                          <tr key={cost.id} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                            <td className="td">
                              <input
                                value={cost.nimetus}
                                onChange={(e) => updateCost(cost.id, "nimetus", e.target.value)}
                                placeholder="Kulurida"
                                className="inline-input w-full"
                              />
                            </td>
                            <td className="td">
                              <input
                                type="number"
                                value={cost.kavandatav_eur}
                                onChange={(e) => updateCost(cost.id, "kavandatav_eur", e.target.value)}
                                placeholder="0.00"
                                className="inline-input w-full text-right tabular-nums"
                              />
                            </td>
                            <td className="td">
                              <select
                                value={cost.jaotusmeetod}
                                onChange={(e) => updateCost(cost.id, "jaotusmeetod", e.target.value)}
                                className="inline-input w-full text-xs"
                              >
                                <option value="kaasomandiOsa">Kaasomandi osa</option>
                                <option value="m2">Üldpind (m²)</option>
                              </select>
                            </td>
                            <td className="td">
                              <button onClick={() => removeCost(cost.id)} className="text-slate-700 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* ── TAB 4: Jaotus ── */}
        {tab === "jaotus" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-100">Korteriomanike kohustuste jaotus</h2>
              <p className="text-xs text-slate-500 mt-1">KrtS § 41 lg 1 p 3 · § 40 lg 1</p>
            </div>

            <ErrorBanner errors={errors} />

            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Kulud kokku / aastas" value={`${eur(totalYear)} €`} accent />
              <StatCard label="Kulud kokku / kuus" value={`${eur(totalYear / 12)} €`} />
              <StatCard label="Kortereid" value={units.length} />
            </div>

            {errors.length === 0 && totalYear > 0 && distribution.length > 0 && (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="th">Nr</th>
                      <th className="th">Korteriomand</th>
                      <th className="th">Kaasomandi osa</th>
                      <th className="th">Osakaal</th>
                      <th className="th text-right">Aasta (€)</th>
                      <th className="th text-right">Kuu (€)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distribution.map(({ unit, osa, yearTotal, monthTotal }) => (
                      <tr key={unit.id} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                        <td className="td text-slate-500">{unit.nr}</td>
                        <td className="td font-medium text-slate-200">{unit.nimi || `Korter ${unit.nr}`}</td>
                        <td className="td text-slate-400 text-xs tabular-nums">
                          {n(unit.kaasomandiOsaLugeja)}/{n(unit.kaasomandiOsaNimetaja) || n(building.kaasomandiOsadeKoguarv)}
                        </td>
                        <td className="td">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 bg-slate-800 rounded-full w-16 overflow-hidden">
                              <div className="h-full bg-sky-500 rounded-full" style={{ width: `${Math.min(osa * 100 * 5, 100)}%` }} />
                            </div>
                            <span className="text-xs text-slate-400 tabular-nums">{pct(osa)}</span>
                          </div>
                        </td>
                        <td className="td text-right tabular-nums text-slate-200 font-mono">{eur(yearTotal)}</td>
                        <td className="td text-right tabular-nums text-sky-400 font-mono font-bold">{eur(monthTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-600">
                      <td colSpan={4} className="td text-slate-400 font-semibold">KOKKU</td>
                      <td className="td text-right tabular-nums text-slate-200 font-bold font-mono">{eur(distribution.reduce((s, d) => s + d.yearTotal, 0))}</td>
                      <td className="td text-right tabular-nums text-sky-400 font-bold font-mono">{eur(distribution.reduce((s, d) => s + d.monthTotal, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Per-unit breakdown detail */}
            {errors.length === 0 && totalYear > 0 && distribution.length > 0 && (
              <details className="card group">
                <summary className="cursor-pointer text-xs font-semibold tracking-widest uppercase text-slate-400 hover:text-slate-200 transition-colors select-none">
                  ▸ Kulukirjete detailjaotus korteriomandi kohta
                </summary>
                <div className="mt-4 space-y-4">
                  {distribution.map(({ unit, breakdown, yearTotal }) => (
                    <div key={unit.id}>
                      <p className="text-xs font-semibold text-slate-300 mb-2">
                        {unit.nimi || `Korter ${unit.nr}`}
                        <span className="text-slate-500 ml-2 font-mono">{eur(yearTotal)} € / aastas</span>
                      </p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                        {breakdown.map((b) => (
                          <div key={b.id} className="flex justify-between text-xs py-0.5 border-b border-slate-800">
                            <span className="text-slate-400 truncate pr-2">{b.nimetus}</span>
                            <span className="text-slate-300 tabular-nums font-mono shrink-0">
                              {eur(b.amount)} €
                              <Badge color={b.jaotusmeetod === "m2" ? "amber" : "slate"} >
                                {b.jaotusmeetod === "m2" ? "m²" : "osa"}
                              </Badge>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {totalYear === 0 && (
              <div className="card text-center py-12">
                <p className="text-slate-500 text-sm">Lisa kulud vahekaardil <button onClick={() => setTab("kulud")} className="text-sky-400 underline">3. Kulud</button>, et jaotust näha.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inline styles via style tag trick */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        .section-title { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; margin-bottom: 0.75rem; }
        .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 0.75rem; padding: 1.25rem; }
        .btn-primary { background: #0ea5e9; color: #fff; font-size: 0.75rem; font-weight: 600; padding: 0.4rem 0.9rem; border-radius: 0.4rem; border: none; cursor: pointer; letter-spacing: 0.05em; transition: background 0.15s; }
        .btn-primary:hover { background: #38bdf8; }
        .btn-secondary { background: transparent; color: #94a3b8; font-size: 0.7rem; font-weight: 600; padding: 0.3rem 0.7rem; border-radius: 0.3rem; border: 1px solid #334155; cursor: pointer; letter-spacing: 0.05em; transition: all 0.15s; }
        .btn-secondary:hover { border-color: #64748b; color: #e2e8f0; }
        .inline-input { background: transparent; border: none; border-bottom: 1px solid #1e293b; color: #e2e8f0; font-size: 0.8rem; padding: 0.2rem 0.3rem; font-family: inherit; outline: none; transition: border-color 0.15s; }
        .inline-input:focus { border-bottom-color: #0ea5e9; }
        .inline-input::placeholder { color: #334155; }
        .th { text-align: left; padding: 0.6rem 0.75rem; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #475569; white-space: nowrap; }
        .td { padding: 0.55rem 0.75rem; color: #cbd5e1; vertical-align: middle; }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ? "bg-sky-950/40 border-sky-800" : "bg-slate-900 border-slate-800"}`}>
      <p className="text-xs tracking-widest uppercase text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold font-mono tabular-nums ${accent ? "text-sky-400" : "text-slate-200"}`}>{value}</p>
    </div>
  );
}
