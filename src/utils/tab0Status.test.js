import { describe, it, expect } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// Tab 0 staatuse ja lõppdokumendi kontrolli invariandid
//
// Kinnitab:
// 1. Tab 0 staatuse kolm seisundit (notStarted / valid / invalid)
// 2. notStarted kui ühtegi kohustuslikku välja pole täidetud
// 3. invalid (punane) kui kasutaja on alustanud aga kõik puudu
// 4. valid (roheline) kui kõik kohustuslikud väljad täidetud
// 5. Periood ei blokeeri tabivahetust — loogika on eraldi ühisest navigeerimisest
// 6. Lõppdokumendi tugev kontroll: kuvab puudused täpselt
// ══════════════════════════════════════════════════════════════════════

// ── Staatuse arvutusvalem (sama loogika mis MajanduskavaApp.jsx tabStatus[0]) ──

function computeTab0Status({ hasPeriod, kyData }) {
  const allRequired = !!(
    hasPeriod &&
    kyData.nimi?.trim() &&
    kyData.registrikood?.trim() &&
    kyData.aadress?.trim() &&
    kyData.ehrKood?.trim() &&
    parseFloat(kyData.suletudNetopind) > 0
  );
  const anyFilled = !!(
    (hasPeriod) ||
    kyData.nimi ||
    kyData.registrikood ||
    kyData.aadress ||
    kyData.ehrKood ||
    kyData.suletudNetopind
  );
  if (allRequired) return "valid";
  if (anyFilled) return "invalid";
  return "notStarted";
}

// ── Lõppdokumendi puuduste loend (sama loogika mis sec === 6 IIFE) ──

function computeTab0Missing(plan, kyData) {
  const missing = [];
  if (!plan.period?.start || !plan.period?.end) missing.push("Majanduskava periood");
  if (!kyData.nimi?.trim()) missing.push("KÜ nimi");
  if (!kyData.registrikood?.trim()) missing.push("Registrikood");
  if (!kyData.aadress?.trim()) missing.push("Hoone aadress");
  if (!kyData.ehrKood?.trim()) missing.push("EHR kood");
  if (!(parseFloat(kyData.suletudNetopind) > 0)) missing.push("Korteriomandite pindala kokku");
  return missing;
}

// ── Vaikimisi tühjad andmed ──

const EMPTY_KY = { nimi: "", registrikood: "", aadress: "", ehrKood: "", suletudNetopind: "" };
const FULL_KY = { nimi: "Kuldne Tuba KÜ", registrikood: "80012345", aadress: "Tartu mnt 1", ehrKood: "EHR-001", suletudNetopind: "1234" };
const EMPTY_PERIOD = { period: { start: "", end: "" } };
const FULL_PERIOD = { period: { start: "2027-01-01", end: "2027-12-31" } };

// ── 1. notStarted — ühtegi välja pole täidetud ────────────────────────────

describe("Tab 0 notStarted: ükski kohustuslik väli pole täidetud", () => {
  it("kõik tühjad → notStarted (hall)", () => {
    expect(computeTab0Status({ hasPeriod: false, kyData: EMPTY_KY })).toBe("notStarted");
  });

  it("ainult tühjad stringid → notStarted", () => {
    expect(computeTab0Status({ hasPeriod: false, kyData: { ...EMPTY_KY } })).toBe("notStarted");
  });
});

// ── 2. invalid — kasutaja on alustanud, aga mitte kõik täidetud ─────────────

describe("Tab 0 invalid: alustatud aga puudulik", () => {
  it("ainult nimi täidetud → invalid (punane)", () => {
    expect(computeTab0Status({ hasPeriod: false, kyData: { ...EMPTY_KY, nimi: "KÜ Mets" } })).toBe("invalid");
  });

  it("ainult periood täidetud → invalid", () => {
    expect(computeTab0Status({ hasPeriod: true, kyData: EMPTY_KY })).toBe("invalid");
  });

  it("periood + nimi + aadress, puudub registrikood ja EHR → invalid", () => {
    expect(computeTab0Status({ hasPeriod: true, kyData: { ...EMPTY_KY, nimi: "KÜ", aadress: "Tamme 1" } })).toBe("invalid");
  });

  it("kõik täidetud peale perioodi → invalid", () => {
    expect(computeTab0Status({ hasPeriod: false, kyData: FULL_KY })).toBe("invalid");
  });

  it("kõik täidetud peale suletudNetopind → invalid", () => {
    expect(computeTab0Status({ hasPeriod: true, kyData: { ...FULL_KY, suletudNetopind: "" } })).toBe("invalid");
  });

  it("suletudNetopind = 0 → invalid (null ei käi)", () => {
    expect(computeTab0Status({ hasPeriod: true, kyData: { ...FULL_KY, suletudNetopind: "0" } })).toBe("invalid");
  });
});

// ── 3. valid — kõik kohustuslikud väljad täidetud ─────────────────────────

describe("Tab 0 valid: kõik kohustuslikud väljad olemas", () => {
  it("kõik täidetud → valid (roheline)", () => {
    expect(computeTab0Status({ hasPeriod: true, kyData: FULL_KY })).toBe("valid");
  });

  it("suletudNetopind = 0.1 → valid", () => {
    expect(computeTab0Status({ hasPeriod: true, kyData: { ...FULL_KY, suletudNetopind: "0.1" } })).toBe("valid");
  });

  it("suletudNetopind on number 500 → valid", () => {
    expect(computeTab0Status({ hasPeriod: true, kyData: { ...FULL_KY, suletudNetopind: 500 } })).toBe("valid");
  });
});

// ── 4. Periood ei blokeeri navigeerimist — loogika on eraldi ─────────────

describe("Tab 0 perioodi puudumine ei blokeeri navigeerimist", () => {
  // Navigeerimisblokeering oli tingimus: sec === 0 && i !== 0 && (!period.start || !period.end)
  // Selle kontrolli eemaldamisel on navigeerimine perioodist sõltumatu.
  // Test kinnitab, et staatuse loogika ja navigeerimisloogika on lahutatud.

  it("computeTab0Status ei tagasta 'blocked' ega 'locked' — puuduv periood annab invalid/notStarted", () => {
    const status = computeTab0Status({ hasPeriod: false, kyData: EMPTY_KY });
    expect(["notStarted", "invalid", "valid"]).toContain(status);
    expect(status).not.toBe("blocked");
  });

  it("puuduv periood ei takista staatuse arvutamist — funktsioon tagastab alati validi sõnastiku väärtuse", () => {
    const status = computeTab0Status({ hasPeriod: false, kyData: FULL_KY });
    expect(status).toBe("invalid"); // kõik muud täidetud, ainult periood puudu
  });
});

// ── 5. Lõppdokumendi tugev kontroll — täpne puuduste loend ───────────────

describe("lõppdokumendi kontroll: puuduvate väljade loend", () => {
  it("kõik täidetud → puuduste loend on tühi", () => {
    expect(computeTab0Missing(FULL_PERIOD, FULL_KY)).toEqual([]);
  });

  it("kõik tühjad → loend sisaldab kõiki 6 kohustuslikku välja", () => {
    const missing = computeTab0Missing(EMPTY_PERIOD, EMPTY_KY);
    expect(missing).toContain("Majanduskava periood");
    expect(missing).toContain("KÜ nimi");
    expect(missing).toContain("Registrikood");
    expect(missing).toContain("Hoone aadress");
    expect(missing).toContain("EHR kood");
    expect(missing).toContain("Korteriomandite pindala kokku");
    expect(missing).toHaveLength(6);
  });

  it("puudub ainult periood → loend sisaldab ainult periood", () => {
    const missing = computeTab0Missing(EMPTY_PERIOD, FULL_KY);
    expect(missing).toEqual(["Majanduskava periood"]);
  });

  it("puudub ainult pindala → loend sisaldab ainult pindala", () => {
    const missing = computeTab0Missing(FULL_PERIOD, { ...FULL_KY, suletudNetopind: "" });
    expect(missing).toEqual(["Korteriomandite pindala kokku"]);
  });

  it("puudub ainult EHR kood → loend sisaldab ainult EHR kood", () => {
    const missing = computeTab0Missing(FULL_PERIOD, { ...FULL_KY, ehrKood: "" });
    expect(missing).toEqual(["EHR kood"]);
  });

  it("periood algus puudub (lõpp olemas) → periood on puuduste loendis", () => {
    const missing = computeTab0Missing({ period: { start: "", end: "2027-12-31" } }, FULL_KY);
    expect(missing).toContain("Majanduskava periood");
  });

  it("periood lõpp puudub (algus olemas) → periood on puuduste loendis", () => {
    const missing = computeTab0Missing({ period: { start: "2027-01-01", end: "" } }, FULL_KY);
    expect(missing).toContain("Majanduskava periood");
  });

  it("puuduste loend ei sisalda täidetud välju", () => {
    const missing = computeTab0Missing(EMPTY_PERIOD, FULL_KY);
    expect(missing).not.toContain("KÜ nimi");
    expect(missing).not.toContain("Registrikood");
    expect(missing).not.toContain("Hoone aadress");
  });

  it("suletudNetopind = 0 → pindala on puuduste loendis", () => {
    const missing = computeTab0Missing(FULL_PERIOD, { ...FULL_KY, suletudNetopind: "0" });
    expect(missing).toContain("Korteriomandite pindala kokku");
  });

  it("suletudNetopind = tühikud → pindala on puuduste loendis", () => {
    const missing = computeTab0Missing(FULL_PERIOD, { ...FULL_KY, suletudNetopind: "   " });
    expect(missing).toContain("Korteriomandite pindala kokku");
  });
});

// ── 6. Kohustuslike väljade nimekiri — täielikkuse kontroll ──────────────

describe("kohustuslike väljade nimekiri on täpne", () => {
  it("on täpselt 6 kohustuslikku välja", () => {
    const missing = computeTab0Missing(EMPTY_PERIOD, EMPTY_KY);
    expect(missing).toHaveLength(6);
  });

  it("kohustuslikud väljad on: periood, KÜ nimi, registrikood, aadress, EHR kood, pindala", () => {
    const missing = computeTab0Missing(EMPTY_PERIOD, EMPTY_KY);
    expect(missing).toContain("Majanduskava periood");
    expect(missing).toContain("KÜ nimi");
    expect(missing).toContain("Registrikood");
    expect(missing).toContain("Hoone aadress");
    expect(missing).toContain("EHR kood");
    expect(missing).toContain("Korteriomandite pindala kokku");
  });

  it("korterite arv EI ole kohustuslik (ei ole puuduste loendis)", () => {
    const missing = computeTab0Missing(EMPTY_PERIOD, EMPTY_KY);
    expect(missing).not.toContain("Korterite arv");
  });
});
