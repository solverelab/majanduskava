// src/utils/printSummaryLabels.test.js
// Lukustab Kokkuvõte-sektsiooni sildid print-vaates.
// "Kulud perioodis" oli eksitav (sisaldas ka laenumakseid) ja asendati sõnaga
// "Väljaminekud perioodis". "Vahe" oli liiga lühike ja asendati sõnaga
// "Tulude ja väljaminekute vahe".

import { describe, it, expect, beforeAll } from "vitest";

const EXPECTED_SUMMARY_LABELS = [
  "Väljaminekud perioodis",
  "Tulud perioodis",
  "Tulude ja väljaminekute vahe",
  "Korteriomanike kuumaksed kokku",
];

const DEPRECATED_MISLEADING_LABELS = [
  '"Kulud perioodis"',       // vana silt, mis sisaldas tegelikult ka laenumakseid
  '"Omanike kuumakse"',      // mitmeti tõlgendatav — kas minu või kõikide oma
];

describe("Print-vaate Kokkuvõte sildid", () => {
  let src;

  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  });

  it("kasutab kasutajale arusaadavaid silte", () => {
    for (const label of EXPECTED_SUMMARY_LABELS) {
      expect(src).toContain(`"${label}"`);
    }
  });

  it("ei kasuta enam eksitavat 'Kulud perioodis' silti kokkuvõtte reas", () => {
    for (const deprecated of DEPRECATED_MISLEADING_LABELS) {
      expect(src).not.toContain(deprecated);
    }
  });
});

describe("Tab 6 Koondvaade — 30-sekundi test nähtavus", () => {
  let src;

  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  });

  it("Koondvaates kuvatakse Kavandatud investeeringud perioodis — lühike kokkuvõtterida", () => {
    // Rida tuleb enne KokkuvoteKihistus cards'e
    const line = "Kavandatud investeeringud perioodis:";
    expect(src).toContain(line);
    const idx = src.indexOf(line);
    const afterLine = src.slice(idx, idx + 400);
    // Tingimus: näidatakse ainult kui thisYearCount > 0
    const beforeLine = src.slice(Math.max(0, idx - 300), idx);
    expect(beforeLine).toMatch(/thisYearCount\s*>\s*0/);
    // Real sisaldab arvu ja kogumaksumuse summa
    expect(afterLine).toContain("Kokku ");
  });
});

describe("Print-vaate Remondifond / Reservkapital grupeerimine", () => {
  let src;

  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  });

  it("grupeerib remondifondi ja reservkapitali eraldi alamplokkidesse", () => {
    // Otsime just print-sektsiooni (peale pealkirja), mitte Tab 6 in-app kokkuvõtet
    const printIdx = src.indexOf('print-section-title">Remondifond, reservkapital ja laen');
    expect(printIdx).toBeGreaterThan(-1);
    const after = src.slice(printIdx, printIdx + 1500);
    // Alampealkirjad eraldi
    expect(after).toContain("Remondifond");
    expect(after).toContain("Reservkapital");
    // Kas "Nõutav miinimum" on kasutuses (mitte "Nõutav reserv")
    expect(after).toContain("Nõutav miinimum:");
    expect(after).toContain("Planeeritud:");
    expect(after).toContain("Määr:");
    expect(after).toContain("Laekumine perioodis:");
  });
});
