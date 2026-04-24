import { describe, it, expect, beforeAll } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// Print/PDF kokkuvõtte struktuuri lukustus
//
// Kontrollib, et print vaate sektsioonid on olemas õiges järjekorras
// ja et pealkirjad ei muutu kogemata.
// ══════════════════════════════════════════════════════════════════════

// Pärast summary/print ümbertõstmist on print struktuur jagatud kahele haru:
// - printMode === "full": Kaasomandi (tingimuslik), Kavandatud tulud, Kavandatud kulud
// - printMode === "apartments": Korteriomanike kuumaksed
// Plokid 4, 5, 6 lisanduvad järgnevate slice'ide kaupa.

const FULL_MODE_SECTIONS_IN_ORDER = [
  "Kaasomandi eseme seisukord ja kavandatavad toimingud",
  "Kavandatud tulud",
  "Kavandatud kulud",
  "Korteriomanike kohustuste jaotus majandamiskulude kandmisel",
  "Kütus / soojus / vesi ja kanalisatsioon / elekter",
  "Jaluse viited",
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

  it("full-mode sektsioonid on olemas õiges järjekorras", () => {
    const positions = FULL_MODE_SECTIONS_IN_ORDER.map(title => {
      const idx = src.indexOf(`print-section-title">${title}`);
      expect(idx).toBeGreaterThan(-1);
      return idx;
    });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("Korteriomanike kuumaksed sektsioon on olemas (apartments-mode)", () => {
    expect(src).toContain('print-section-title">Korteriomanike kuumaksed');
  });

  it("Kaasomandi sektsioon renderdub alati (fallback tekst kui andmed puuduvad)", () => {
    // p1 renderdub alati — tingimuslikku peitmist enam pole
    const kaasomandIdx = src.indexOf('print-section-title">Kaasomandi eseme seisukord ja kavandatavad toimingud');
    expect(kaasomandIdx).toBeGreaterThan(-1);
    // Fallback tekst peab olema olemas (kuvatakse kui seisukorra ridu pole)
    expect(src).toContain("Kaasomandi eseme seisukorra andmed on sisestamata.");
  });

  it("print-content plokk on isPrinting tingimusega", () => {
    expect(src).toMatch(/isPrinting && \(/);
    expect(src).toContain('className="print-content"');
  });

  it("print harud on gate'itud printMode järgi", () => {
    expect(src).toContain('printMode === "full"');
    expect(src).toContain('printMode === "apartments"');
  });
});
