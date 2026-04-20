import { describe, it, expect } from "vitest";
import {
  arvutaKuumakse, arvutaKuumakseExact,
  computeReserveMin, computeKopiiriondvaade, computeRemondifondiArvutus,
} from "./majanduskavaCalc";

// Simulate uuendaSeisukord (same as App.jsx)
function applyUuendaSeisukord(plan, id, field, value) {
  const updatedCondition = (plan.assetCondition?.items || []).map(r =>
    r.id !== id ? r : { ...r, [field]: value }
  );
  const invPatch = {};
  if (field === "eeldatavKulu") invPatch.totalCostEUR = Math.max(0, Number(value) || 0);
  if (field === "tegevusAasta") invPatch.plannedYear = Number(value) || 0;
  if (field === "ese" || field === "tegevus") {
    const rida = updatedCondition.find(r => r.id === id);
    if (rida) invPatch.name = rida.ese + (rida.tegevus ? " — " + rida.tegevus : "");
  }
  const hasInvPatch = Object.keys(invPatch).length > 0;
  const updatedInvestments = hasInvPatch
    ? { ...plan.investments, items: plan.investments.items.map(inv => inv.sourceRefId !== id ? inv : { ...inv, ...invPatch }) }
    : plan.investments;
  return { ...plan, assetCondition: { ...plan.assetCondition, items: updatedCondition }, investments: updatedInvestments };
}

// Simulate korteriteKuumaksed (same as App.jsx)
function computeKorteriteKuumaksed(apartments, totAreaM2, kopiiriondvaade) {
  const koguPind = totAreaM2;
  return apartments.map(a => {
    const pind = parseFloat(a.areaM2) || 0;
    const osa = koguPind > 0 ? pind / koguPind : 0;
    return {
      kommunaal: Math.round(kopiiriondvaade.kommunaalKokku * osa),
      haldus: Math.round(kopiiriondvaade.haldusKokku * osa),
    };
  });
}

const BASE_RF = {
  saldoAlgusRaw: "0", koguPind: 100, periodiAasta: 2026, pangaKoef: 1.15,
  kogumisViis: "eraldi", pangaMaarOverride: null, maarOverride: null,
  loans: [], loanStatus: "APPLIED", monthEq: 12,
};

// ── 1. negatiivne totalCostEUR ───────────────────────────────────────────────

describe("negatiivne investeeringu totalCostEUR", () => {
  it("remondifondi summa ei lähe negatiivseks", () => {
    const inv = {
      id: "inv-1", name: "Test", sourceType: "standalone", sourceRefId: null,
      plannedYear: 2028, totalCostEUR: -5000,
      fundingPlan: [{ source: "Remondifond", amountEUR: -3000 }],
    };
    const result = computeRemondifondiArvutus({ ...BASE_RF, investments: [inv] });
    // fundingPlan amountEUR of -3000 gets Math.round(-3000) = -3000
    // but jaakSaldo and koguda are guarded by Math.max(0, ...)
    expect(result.saldoLopp).toBeGreaterThanOrEqual(result.saldoAlgus);
  });
});

// ── 2. negatiivne laen principalEUR ──────────────────────────────────────────

describe("negatiivne laen principalEUR", () => {
  it("arvutaKuumakse tagastab 0", () => {
    expect(arvutaKuumakse(-10000, 5, 120)).toBe(0);
  });

  it("arvutaKuumakseExact tagastab 0", () => {
    expect(arvutaKuumakseExact(-10000, 5, 120)).toBe(0);
  });
});

// ── 3. termMonths = 0 ────────────────────────────────────────────────────────

describe("termMonths = 0", () => {
  it("arvutaKuumakse tagastab 0", () => {
    expect(arvutaKuumakse(10000, 5, 0)).toBe(0);
  });

  it("arvutaKuumakseExact tagastab 0", () => {
    expect(arvutaKuumakseExact(10000, 5, 0)).toBe(0);
  });
});

// ── 4. negatiivne intressimäär ───────────────────────────────────────────────

describe("negatiivne intressimäär", () => {
  it("arvutaKuumakse käsitleb negatiivset intressi kui 0%", () => {
    const withNeg = arvutaKuumakse(10000, -5, 120);
    const withZero = arvutaKuumakse(10000, 0, 120);
    expect(withNeg).toBe(withZero);
  });

  it("arvutaKuumakseExact käsitleb negatiivset intressi kui 0%", () => {
    const withNeg = arvutaKuumakseExact(10000, -5, 120);
    const withZero = arvutaKuumakseExact(10000, 0, 120);
    expect(withNeg).toBe(withZero);
  });
});

// ── 5. korteri areaM2 <= 0 ───────────────────────────────────────────────────

describe("korteri areaM2 <= 0", () => {
  it("korteriteKuumaksed annab kommunaal=0, haldus=0", () => {
    const kv = computeKopiiriondvaade(
      [{ category: "Soojus", summaInput: "1200" }], [], [], 12, "APPLIED"
    );
    const apartments = [
      { id: "a1", areaM2: 0 },
      { id: "a2", areaM2: 50 },
    ];
    const km = computeKorteriteKuumaksed(apartments, 50, kv);
    expect(km[0].kommunaal).toBe(0);
    expect(km[0].haldus).toBe(0);
    expect(km[1].kommunaal).toBe(kv.kommunaalKokku); // gets 100%
  });

  it("koguPind = 0 annab kõigile 0", () => {
    const kv = computeKopiiriondvaade(
      [{ category: "Soojus", summaInput: "1200" }], [], [], 12, "APPLIED"
    );
    const km = computeKorteriteKuumaksed([{ id: "a1", areaM2: 0 }], 0, kv);
    expect(km[0].kommunaal).toBe(0);
    expect(km[0].haldus).toBe(0);
  });
});

// ── 6. negatiivne summaInput kulu/tuluridades ────────────────────────────────

describe("negatiivne summaInput kulu/tuluridades", () => {
  it("negatiivne kulusumma käsitletakse kui 0", () => {
    const kv = computeKopiiriondvaade(
      [{ category: "Soojus", summaInput: "-500" }], [], [], 12, "APPLIED"
    );
    expect(kv.kommunaalKokku).toBe(0);
    expect(kv.kuludKokku).toBe(0);
  });

  it("negatiivne tulusumma käsitletakse kui 0", () => {
    const kv = computeKopiiriondvaade(
      [], [{ summaInput: "-200", arvutus: "kuus" }], [], 12, "APPLIED"
    );
    expect(kv.muudTuludKokku).toBe(0);
  });
});

// ── 7. computeReserveMin negatiivne ──────────────────────────────────────────

describe("computeReserveMin negatiivse sisendiga", () => {
  it("negatiivne costRow ei anna negatiivset reservi miinimumi", () => {
    const r = computeReserveMin([{ summaInput: "-1200" }], 12);
    expect(r.noutavMiinimum).toBe(0);
    expect(r.aastaKulud).toBe(0);
  });
});

// ── 8. uuendaSeisukord negatiivne eeldatavKulu ──────────────────────────────

describe("uuendaSeisukord negatiivne eeldatavKulu", () => {
  it("investeeringu totalCostEUR ei saa negatiivset väärtust", () => {
    const plan = {
      assetCondition: { items: [{ id: "r1", ese: "Katus", tegevus: "Remont", tegevusAasta: "2028", eeldatavKulu: 50000 }] },
      investments: { items: [{ id: "inv-1", sourceType: "condition_item", sourceRefId: "r1", name: "Katus", totalCostEUR: 50000, fundingPlan: [] }] },
    };

    const r1 = applyUuendaSeisukord(plan, "r1", "eeldatavKulu", -500);
    expect(r1.investments.items[0].totalCostEUR).toBe(0);

    const r2 = applyUuendaSeisukord(r1, "r1", "eeldatavKulu", -500);
    expect(r2.investments.items[0].totalCostEUR).toBe(0);
    expect(r2.investments.items.length).toBe(1); // no duplicates
  });
});
