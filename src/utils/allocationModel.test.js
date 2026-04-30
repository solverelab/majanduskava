import { describe, it, expect } from "vitest";
import { normalizeCostAllocation } from "./allocationModel";

// ── 1. Uus mudel ─────────────────────────────────────────────────────────────

describe("normalizeCostAllocation — uus mudel (new_model)", () => {
  it("uus mudel loetakse eelisjärjekorras kui costAllocationBasis on olemas", () => {
    const row = {
      costAllocationBasis: "korteri_kohta",
      rateDisplayMode: "eur_per_apartment",
      legalBasis: "pohikiri",
      legalBasisDetail: "põhikiri § 5",
      allocationBasisDetail: null,
      allocationBasis: "m2", // legacy väli — peab ignoreerima
    };
    const r = normalizeCostAllocation(row);
    expect(r.migrationSource).toBe("new_model");
    expect(r.costAllocationBasis).toBe("korteri_kohta");
    expect(r.rateDisplayMode).toBe("eur_per_apartment");
    expect(r.legalBasis).toBe("pohikiri");
    expect(r.legalBasisDetail).toBe("põhikiri § 5");
  });

  it("uue mudeli puuduv rateDisplayMode → 'none'", () => {
    const row = { costAllocationBasis: "kaasomandi_osa", legalBasis: "seadus" };
    expect(normalizeCostAllocation(row).rateDisplayMode).toBe("none");
  });

  it("uue mudeli puuduv legalBasis → 'unknown'", () => {
    const row = { costAllocationBasis: "muu" };
    expect(normalizeCostAllocation(row).legalBasis).toBe("unknown");
  });

  it("uues mudelis ei kasuta legacy allocationBasis väärtust", () => {
    const row = {
      costAllocationBasis: "kaasomandi_osa",
      rateDisplayMode: "eur_per_m2",
      legalBasis: "kokkulepe",
      allocationBasis: "muu", // erinev legacy väli — ignoreeritakse
    };
    const r = normalizeCostAllocation(row);
    expect(r.costAllocationBasis).toBe("kaasomandi_osa");
    expect(r.legalBasis).toBe("kokkulepe");
    expect(r.migrationSource).toBe("new_model");
  });
});

// ── 2. Legacy m2 ─────────────────────────────────────────────────────────────

describe("normalizeCostAllocation — legacy m2", () => {
  it("legacy m2 ilma erandiväljadeta → kaasomandi_osa + eur_per_m2 + seadus + legacy_m2", () => {
    const r = normalizeCostAllocation({ allocationBasis: "m2" });
    expect(r.costAllocationBasis).toBe("kaasomandi_osa");
    expect(r.rateDisplayMode).toBe("eur_per_m2");
    expect(r.legalBasis).toBe("seadus");
    expect(r.migrationSource).toBe("legacy_m2");
  });

  it("puuduv allocationBasis (undefined) → sama mis m2", () => {
    const r = normalizeCostAllocation({ category: "Koristus" });
    expect(r.costAllocationBasis).toBe("kaasomandi_osa");
    expect(r.rateDisplayMode).toBe("eur_per_m2");
    expect(r.legalBasis).toBe("seadus");
    expect(r.migrationSource).toBe("legacy_m2");
  });

  it("legacy m2 + legalBasisBylaws → legalBasis pohikiri, mitte seadus", () => {
    const r = normalizeCostAllocation({ allocationBasis: "m2", legalBasisBylaws: true });
    expect(r.legalBasis).toBe("pohikiri");
    expect(r.migrationSource).toBe("legacy_m2");
  });

  it("legacy m2 + legalBasisSpecialAgreement → legalBasis kokkulepe", () => {
    const r = normalizeCostAllocation({ allocationBasis: "m2", legalBasisSpecialAgreement: true });
    expect(r.legalBasis).toBe("kokkulepe");
  });

  it("legacy m2 + legalBasisMuu → legalBasis muu", () => {
    const r = normalizeCostAllocation({ allocationBasis: "m2", legalBasisMuu: true });
    expect(r.legalBasis).toBe("muu");
  });

  it("legacy m2 + mitu erandivälja → legalBasis unknown", () => {
    const r = normalizeCostAllocation({
      allocationBasis: "m2",
      legalBasisBylaws: true,
      legalBasisSpecialAgreement: true,
    });
    expect(r.legalBasis).toBe("unknown");
  });

  it("legacy m2 kõik kolm erandivälja true → legalBasis unknown", () => {
    const r = normalizeCostAllocation({
      allocationBasis: "m2",
      legalBasisBylaws: true,
      legalBasisSpecialAgreement: true,
      legalBasisMuu: true,
    });
    expect(r.legalBasis).toBe("unknown");
  });
});

// ── 3. Legacy apartment / korter ─────────────────────────────────────────────

describe("normalizeCostAllocation — legacy apartment/korter", () => {
  it("legacy apartment ilma erandialuseta → legalBasis unknown", () => {
    const r = normalizeCostAllocation({ allocationBasis: "apartment" });
    expect(r.costAllocationBasis).toBe("korteri_kohta");
    expect(r.rateDisplayMode).toBe("eur_per_apartment");
    expect(r.legalBasis).toBe("unknown");
    expect(r.migrationSource).toBe("legacy_apartment");
  });

  it("legacy apartment + legalBasisSeadus true → legalBasis unknown (vastuolu)", () => {
    const r = normalizeCostAllocation({ allocationBasis: "apartment", legalBasisSeadus: true });
    expect(r.legalBasis).toBe("unknown");
  });

  it("legacy apartment + legalBasisSeadus true + legalBasisBylaws true → legalBasis unknown (legalBasisSeadus domineerib)", () => {
    const r = normalizeCostAllocation({
      allocationBasis: "apartment",
      legalBasisSeadus: true,
      legalBasisBylaws: true,
    });
    expect(r.legalBasis).toBe("unknown");
  });

  it("legacy apartment + legalBasisBylaws true (ilma seaduseta) → legalBasis pohikiri", () => {
    const r = normalizeCostAllocation({
      allocationBasis: "apartment",
      legalBasisSeadus: false,
      legalBasisBylaws: true,
    });
    expect(r.legalBasis).toBe("pohikiri");
  });

  it("legacy apartment + legalBasisSpecialAgreement → legalBasis kokkulepe", () => {
    const r = normalizeCostAllocation({
      allocationBasis: "apartment",
      legalBasisSpecialAgreement: true,
    });
    expect(r.legalBasis).toBe("kokkulepe");
  });

  it("legacy 'korter' käsitletakse nagu 'apartment'", () => {
    const r = normalizeCostAllocation({ allocationBasis: "korter", legalBasisBylaws: true });
    expect(r.costAllocationBasis).toBe("korteri_kohta");
    expect(r.migrationSource).toBe("legacy_apartment");
    expect(r.legalBasis).toBe("pohikiri");
  });
});

// ── 4. Legacy muu / other ────────────────────────────────────────────────────

describe("normalizeCostAllocation — legacy muu/other", () => {
  it("legacy muu ilma erandialuseta → legalBasis unknown", () => {
    const r = normalizeCostAllocation({ allocationBasis: "muu" });
    expect(r.costAllocationBasis).toBe("muu");
    expect(r.rateDisplayMode).toBe("total_only");
    expect(r.legalBasis).toBe("unknown");
    expect(r.migrationSource).toBe("legacy_muu");
  });

  it("legacy muu + legalBasisMuu → legalBasis muu", () => {
    const r = normalizeCostAllocation({ allocationBasis: "muu", legalBasisMuu: true });
    expect(r.legalBasis).toBe("muu");
  });

  it("legacy muu + legalBasisBylaws → legalBasis pohikiri", () => {
    const r = normalizeCostAllocation({ allocationBasis: "muu", legalBasisBylaws: true });
    expect(r.legalBasis).toBe("pohikiri");
  });

  it("legacy 'other' käsitletakse nagu 'muu'", () => {
    const r = normalizeCostAllocation({ allocationBasis: "other", legalBasisSpecialAgreement: true });
    expect(r.costAllocationBasis).toBe("muu");
    expect(r.migrationSource).toBe("legacy_muu");
    expect(r.legalBasis).toBe("kokkulepe");
  });
});

// ── 5. Tundmatu allocationBasis ───────────────────────────────────────────────

describe("normalizeCostAllocation — tundmatu allocationBasis", () => {
  it("tundmatu väärtus → migrationSource legacy_unknown", () => {
    const r = normalizeCostAllocation({ allocationBasis: "tarbimise_järgi" });
    expect(r.costAllocationBasis).toBe("muu");
    expect(r.rateDisplayMode).toBe("total_only");
    expect(r.legalBasis).toBe("unknown");
    expect(r.migrationSource).toBe("legacy_unknown");
  });

  it("tundmatu väärtus + legalBasisDetail säilib", () => {
    const r = normalizeCostAllocation({
      allocationBasis: "xyzzy",
      legalBasisTaepsustus: "mingi tekst",
    });
    expect(r.legalBasisDetail).toBe("mingi tekst");
    expect(r.migrationSource).toBe("legacy_unknown");
  });
});

// ── 6. Detailiväljad säilivad eraldi ──────────────────────────────────────────

describe("normalizeCostAllocation — detailiväljad", () => {
  it("legalBasisTaepsustus → legalBasisDetail (mitte allocationBasisDetail)", () => {
    const r = normalizeCostAllocation({
      allocationBasis: "m2",
      legalBasisTaepsustus: "põhikiri § 5",
      allocationBasisMuuKirjeldus: "kuidas jaotatakse",
    });
    expect(r.legalBasisDetail).toBe("põhikiri § 5");
    expect(r.allocationBasisDetail).toBe("kuidas jaotatakse");
    expect(r.legalBasisDetail).not.toBe(r.allocationBasisDetail);
  });

  it("allocationBasisMuuKirjeldus → allocationBasisDetail (mitte legalBasisDetail)", () => {
    const r = normalizeCostAllocation({
      allocationBasis: "muu",
      allocationBasisMuuKirjeldus: "jaotuse kirjeldus",
    });
    expect(r.allocationBasisDetail).toBe("jaotuse kirjeldus");
    expect(r.legalBasisDetail).toBeNull();
  });

  it("mõlemad detailid puuduvad → mõlemad null", () => {
    const r = normalizeCostAllocation({ allocationBasis: "m2" });
    expect(r.legalBasisDetail).toBeNull();
    expect(r.allocationBasisDetail).toBeNull();
  });

  it("legalBasisDetail ja allocationBasisDetail on alati eraldi väljad", () => {
    const r = normalizeCostAllocation({
      allocationBasis: "muu",
      legalBasisTaepsustus: "A",
      allocationBasisMuuKirjeldus: "B",
    });
    expect(r.legalBasisDetail).toBe("A");
    expect(r.allocationBasisDetail).toBe("B");
  });
});

// ── 7. rateDisplayMode ei mõjuta costAllocationBasis ─────────────────────────

describe("normalizeCostAllocation — rateDisplayMode isolatsioon", () => {
  it("rateDisplayMode väärtus ei muuda costAllocationBasis väärtust", () => {
    const r1 = normalizeCostAllocation({ allocationBasis: "m2" });
    const r2 = normalizeCostAllocation({ allocationBasis: "apartment" });
    const r3 = normalizeCostAllocation({ allocationBasis: "muu" });
    // rateDisplayMode erineb
    expect(r1.rateDisplayMode).toBe("eur_per_m2");
    expect(r2.rateDisplayMode).toBe("eur_per_apartment");
    expect(r3.rateDisplayMode).toBe("total_only");
    // costAllocationBasis on sõltumatu
    expect(r1.costAllocationBasis).toBe("kaasomandi_osa");
    expect(r2.costAllocationBasis).toBe("korteri_kohta");
    expect(r3.costAllocationBasis).toBe("muu");
    // ristamine ei toimi
    expect(r1.costAllocationBasis).not.toBe(r2.costAllocationBasis);
    expect(r1.costAllocationBasis).not.toBe(r3.costAllocationBasis);
  });
});

// ── 8. Turvaline fallback puuduva rea korral ─────────────────────────────────

describe("normalizeCostAllocation — turvaline fallback", () => {
  it("null row ei crashi ja annab turvalise fallbacki", () => {
    expect(() => normalizeCostAllocation(null)).not.toThrow();
    const r = normalizeCostAllocation(null);
    expect(r.costAllocationBasis).toBeDefined();
    expect(r.migrationSource).toBeDefined();
  });

  it("undefined row ei crashi", () => {
    expect(() => normalizeCostAllocation(undefined)).not.toThrow();
    const r = normalizeCostAllocation(undefined);
    expect(r.costAllocationBasis).toBe("kaasomandi_osa");
  });

  it("tühi objekt {} → legacy_m2 fallback", () => {
    const r = normalizeCostAllocation({});
    expect(r.migrationSource).toBe("legacy_m2");
    expect(r.costAllocationBasis).toBe("kaasomandi_osa");
    expect(r.legalBasis).toBe("seadus");
  });

  it("tagastatav objekt sisaldab alati kõiki 6 välja", () => {
    const r = normalizeCostAllocation({});
    const keys = Object.keys(r).sort();
    expect(keys).toEqual([
      "allocationBasisDetail",
      "costAllocationBasis",
      "legalBasis",
      "legalBasisDetail",
      "migrationSource",
      "rateDisplayMode",
    ]);
  });
});
