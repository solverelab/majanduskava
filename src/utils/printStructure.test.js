import { describe, it, expect, beforeAll } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// Print/PDF kokkuvõtte struktuuri lukustus
//
// Kontrollib, et print vaate sektsioonid on olemas õiges järjekorras
// ja et pealkirjad ei muutu kogemata.
// ══════════════════════════════════════════════════════════════════════

const EXPECTED_SECTIONS = [
  "Üldandmed",
  "Kaasomandi eseme seisukord ja kavandatavad toimingud",
  "Muud investeeringud",
  "Kavandatud kulud",
  "Kavandatud tulud",
  "Remondifond, reservkapital ja laen",
  "Korteriomanike kuumaksed",
  "Kokkuvõte",
];

describe("print/PDF sektsioonide struktuur", () => {
  let src;

  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(
      path.resolve(__dirname, "../MajanduskavaApp.jsx"),
      "utf-8"
    );
  });

  it("kõik 8 sektsiooni on olemas print-section-title klassiga", () => {
    for (const title of EXPECTED_SECTIONS) {
      const pattern = `print-section-title">${title}`;
      expect(src).toContain(pattern);
    }
  });

  it("sektsioonid on õiges järjekorras", () => {
    const positions = EXPECTED_SECTIONS.map(title => {
      const idx = src.indexOf(`print-section-title">${title}`);
      expect(idx).toBeGreaterThan(-1);
      return idx;
    });

    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("alati-nähtavad sektsioonid ei ole tingimuslikus plokis", () => {
    // Need sektsioonid peavad alati renderduma (ilma && tingimuseta)
    const alwaysVisible = [
      "Üldandmed",
      "Kavandatud kulud",
      "Kavandatud tulud",
      "Remondifond, reservkapital ja laen",
      "Korteriomanike kuumaksed",
      "Kokkuvõte",
    ];

    for (const title of alwaysVisible) {
      const idx = src.indexOf(`print-section-title">${title}`);
      // Otsime tagasi lähima <div — see peab olema <div className="print-section">
      // mitte tingimusliku && sees
      const before = src.lastIndexOf("<div", idx);
      const line = src.substring(before, idx);
      expect(line).toContain('className="print-section"');
    }
  });

  it("tingimuslikud sektsioonid on korrektse tingimusega", () => {
    // Kaasomandi eseme seisukord ja kavandatavad toimingud: nähtav ainult kui seisukord on olemas
    const kaasomandIdx = src.indexOf('print-section-title">Kaasomandi eseme seisukord ja kavandatavad toimingud');
    const beforeKaasomand = src.substring(Math.max(0, kaasomandIdx - 200), kaasomandIdx);
    expect(beforeKaasomand).toMatch(/seisukord.*&&/);

    // Muud investeeringud: nähtav ainult kui standalone investeeringud on olemas
    const muudIdx = src.indexOf('print-section-title">Muud investeeringud');
    const beforeMuud = src.substring(Math.max(0, muudIdx - 200), muudIdx);
    expect(beforeMuud).toMatch(/standalone.*&&|investments.*&&/);
  });

  it("print-content plokk on isPrinting tingimusega", () => {
    expect(src).toMatch(/isPrinting && \(/);
    expect(src).toContain('className="print-content"');
  });
});
