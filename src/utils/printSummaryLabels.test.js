// src/utils/printSummaryLabels.test.js
// Pärast summary/print ümbertõstmist on print-vaate vana Kokkuvõte (arvud) + Fondid ja laen
// plokk eemaldatud. Sildid nagu "Väljaminekud perioodis" ei eksisteeri enam print-DOM-is.
// Keep'ime ainult deprecation-test, mis kinnitab, et vanad eksitavad sildid on eemaldatud.

import { describe, it, expect, beforeAll } from "vitest";

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

  it("ei kasuta enam eksitavaid silte", () => {
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

