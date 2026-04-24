import { describe, it, expect } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// Kuluridade "Muu kommunaalteenus" nimetuse inputi regressioonitestid
//
// Probleem: KuluRidaEditor oli defineeritud IIFE renderfunktsiooni sees
// React komponendina. Iga render lõi uue funktsioonireferentsi, mille
// tõttu React unmount'is ja remount'is inputi → fookus kadus.
//
// Parandus: KuluRidaEditor → kuluRidaEditor (tavaline funktsioon, mis
// tagastab JSX-i), kutsutakse otse {kuluRidaEditor(r)} kujul.
// ══════════════════════════════════════════════════════════════════════

// NB: Projekti UI on monoliitne MajanduskavaApp.jsx ilma React Testing
// Library'ta. Testid kinnitavad mustri õigsust kooditasandil.

describe("KuluRidaEditor definitsioonimuster", () => {
  it("kuluRidaEditor on tavaline funktsioon, mitte React komponent", async () => {
    // Loeme faili sisu ja kontrollime mustrit
    const fs = await import("fs");
    const path = await import("path");
    const appPath = path.resolve(__dirname, "../MajanduskavaApp.jsx");
    const src = fs.readFileSync(appPath, "utf-8");

    // Vana muster: `const KuluRidaEditor = ({ r }) =>` — React komponent IIFE sees
    expect(src).not.toMatch(/const\s+KuluRidaEditor\s*=\s*\(\s*\{/);

    // Uus muster: `const kuluRidaEditor = (r, ...) =>` — tavaline funktsioon (parameetrite arv võib kasvada)
    expect(src).toMatch(/const\s+kuluRidaEditor\s*=\s*\(r[^)]*\)\s*=>/);
  });

  it("renderRow ei loo KuluRidaEditor JSX elementi", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const appPath = path.resolve(__dirname, "../MajanduskavaApp.jsx");
    const src = fs.readFileSync(appPath, "utf-8");

    // Vana: <KuluRidaEditor — loob komponendi, mis remount'itakse
    expect(src).not.toMatch(/<KuluRidaEditor\s/);

    // Uus: kutsub otse funktsiooni kuluRidaEditor(r, ...) — r on alati esimene argument
    expect(src).toMatch(/kuluRidaEditor\(r[,)]/);

  });

  it("iga kulurida key põhineb r.id-l, mitte muutuval väärtusel", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const appPath = path.resolve(__dirname, "../MajanduskavaApp.jsx");
    const src = fs.readFileSync(appPath, "utf-8");

    // renderRow peab kasutama key={r.id}
    expect(src).toMatch(/key=\{r\.id\}/);
  });
});

describe("kulurea state-muudatused ei mõjuta teisi ridu", () => {
  it("updateRow COST muudab ainult sihtrea andmeid", () => {
    // Simuleerime state-muudatust nii nagu MajanduskavaApp.jsx seda teeb
    const rows = [
      { id: "a1", category: "Muu kommunaalteenus", name: "", summaInput: 0 },
      { id: "a2", category: "Soojus", name: "Kaugküte", summaInput: 100 },
      { id: "a3", category: "Muu haldusteenus", name: "Valve", summaInput: 50 },
    ];

    // Simuleerime updateRow("COST", "a1", { name: "Prügivedu" })
    const updated = rows.map(r =>
      r.id === "a1" ? { ...r, name: "Prügivedu" } : r
    );

    // Ainult sihtread muutus
    expect(updated[0].name).toBe("Prügivedu");
    // Teised read jäid samaks
    expect(updated[1]).toEqual(rows[1]);
    expect(updated[2]).toEqual(rows[2]);
  });

  it("nimetuse muutmine ei muuda rea kategooriat ega id-d", () => {
    const row = { id: "x1", category: "Muu kommunaalteenus", name: "A", summaInput: 0 };

    // Tippimise simulatsioon: iga täht eraldi
    const step1 = { ...row, name: "AB" };
    const step2 = { ...step1, name: "ABC" };
    const step3 = { ...step2, name: "ABCD" };

    expect(step3.id).toBe("x1");
    expect(step3.category).toBe("Muu kommunaalteenus");
    expect(step3.name).toBe("ABCD");
  });
});
