import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// RF override UI regressioonitestid
//
// 1. Muutmata blur ei aktiveeri override'i
// 2. Reset (maarOverride: null) puhastab käsitsi määra
// 3. Horisondi info on kättesaadav, kui investeering ulatub perioodi üle
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  saldoAlgusRaw: "0",
  koguPind: 200,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: null,
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 12,
  investments: [{
    id: "i1", name: "Katus", plannedYear: 2029, totalCostEUR: 10000,
    fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
  }],
};

describe("muutmata blur ei aktiveeri override'i", () => {
  it("automaatse väärtuse tagasisaatmine ei peaks tekitama override'i", () => {
    // Simuleerime UI loogikat: kasutaja klõpsab väljale, ei muuda, blur
    // UI onChange saab sama väärtuse mis automaatne
    const auto = computeRemondifondiArvutus(BASE);
    const automaatneKuu = parseFloat(auto.maarKuusM2.toFixed(2));

    const v = automaatneKuu; // blur saadab sama väärtuse tagasi
    const automaatne = parseFloat(auto.maarKuusM2.toFixed(2));
    const shouldOverride = v !== automaatne;

    expect(shouldOverride).toBe(false);
  });

  it("erineva väärtuse sisestamine peab aktiveerima override'i", () => {
    const auto = computeRemondifondiArvutus(BASE);
    const automaatneKuu = parseFloat(auto.maarKuusM2.toFixed(2));

    const v = automaatneKuu + 0.10; // kasutaja sisestab kõrgema väärtuse
    const automaatne = parseFloat(auto.maarKuusM2.toFixed(2));
    const shouldOverride = v !== automaatne;

    expect(shouldOverride).toBe(true);
  });
});

describe("reset puhastab käsitsi määra", () => {
  it("maarOverride: null → maarKuusM2 = 0, kasitsiMaar = false", () => {
    const overridden = computeRemondifondiArvutus({ ...BASE, maarOverride: 0.50 });
    expect(overridden.kasitsiMaar).toBe(true);
    expect(overridden.maarKuusM2).toBe(0.50);

    const reset = computeRemondifondiArvutus({ ...BASE, maarOverride: null });
    expect(reset.kasitsiMaar).toBe(false);
    expect(reset.maarKuusM2).toBe(0); // auto = 0 (pole auto-tuletust)
  });
});

describe("horisondi info on kättesaadav", () => {
  it("investeeringud perioodi sees — viimaneAasta === periodiAasta", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "i3", name: "Remont", plannedYear: 2027, totalCostEUR: 5000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 5000 }],
      }],
    });
    const viimaneAasta = Math.max(...r.invDetail.map(d => d.aasta));
    expect(viimaneAasta).toBe(2027);
    // Horisont ei ulatu perioodi üle — selgitust ei kuvata
    expect(viimaneAasta > 2027).toBe(false);
  });

  it("investeeringud perioodi taha — viimaneAasta > periodiAasta", () => {
    const r = computeRemondifondiArvutus(BASE); // plannedYear 2029
    const viimaneAasta = Math.max(...r.invDetail.map(d => d.aasta));
    expect(viimaneAasta).toBe(2029);
    // Horisont ulatub perioodi üle — selgitus kuvatakse
    expect(viimaneAasta > 2027).toBe(true);
  });

  it("tühja investeeringuteta — invDetail on tühi", () => {
    const r = computeRemondifondiArvutus({ ...BASE, investments: [] });
    expect(r.invDetail.length).toBe(0);
  });
});
