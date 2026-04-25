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
  "Ülevaade kaasomandi eseme seisukorrast ja kavandatavatest toimingutest",
  "Korteriühistu kavandatavad tulud ja kulud",
  "Korteriomanike kohustuste jaotus majandamiskulude kandmisel",
  "Reservkapitali ja remondifondi tehtavate maksete suurus",
  "Kütuse, soojuse, vee- ja kanalisatsiooniteenuse ning elektri prognoositav kogus ja maksumus",
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
    const kaasomandIdx = src.indexOf('print-section-title">Ülevaade kaasomandi eseme seisukorrast ja kavandatavatest toimingutest');
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

  it("p4 waterfall renderdub alati — ei ole hasRf-tingimusega peidetud", () => {
    const p4Title = 'print-section-title">Reservkapitali ja remondifondi tehtavate maksete suurus';
    const p4Idx = src.indexOf(p4Title);
    expect(p4Idx).toBeGreaterThan(-1);
    const p4Region = src.slice(p4Idx, p4Idx + 2000);
    // Kõik waterfall read peavad olema tingimusteta
    expect(p4Region).toContain("Saldo perioodi alguses");
    expect(p4Region).toContain("Laekumine perioodis");
    expect(p4Region).toContain("Saldo perioodi lõpus");
    // hasRf ei tohi olla waterfall-i ees
    expect(p4Region).not.toMatch(/hasRf \? \(\s*<>/);
  });

  it("p2 kommunaalteenused on aggregeeritud, mitte detailsed (p5 ei dubleeru)", () => {
    // p2 näitab kommunaalteenuseid ühe kokkuvõtliku reana
    expect(src).toContain("Kommunaalteenused kokku");
    // Redirect-viide p5-sse peab olema olemas
    expect(src).toContain("Detailne kogus ja maksumus on esitatud kommunaalteenuste prognoosi plokis");
  });

  it("p4 ei näita automaatset RF hinnangusilti", () => {
    const p4Title = 'print-section-title">Reservkapitali ja remondifondi tehtavate maksete suurus';
    const p4Idx = src.indexOf(p4Title);
    const p4Region = src.slice(p4Idx, p4Idx + 2000);
    expect(p4Region).not.toContain("vajalik määr");
    expect(p4Region).not.toContain("soovituslik");
    expect(p4Region).not.toContain("maarSoovituslik");
  });
});
