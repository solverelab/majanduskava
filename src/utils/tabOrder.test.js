// src/utils/tabOrder.test.js
// Lukustab UI tabide järjekorra ja clearSection indeksi sidumise.

import { describe, it, expect, beforeAll } from "vitest";

let src;

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
});

// ── 1. SECS massiivi järjekord ────────────────────────────────────────────────

describe("SECS tabide järjekord", () => {
  it("SECS massiiv sisaldab kõiki 7 tabi", () => {
    expect(src).toContain('"Üldandmed"');
    expect(src).toContain('"Seisukord ja plaan"');
    expect(src).toContain('"Tulud ja kulud"');
    expect(src).toContain('"Kommunaalid"');
    expect(src).toContain('"Fondid"');
    expect(src).toContain('"Kohustuste jaotus"');
    expect(src).toContain('"Majanduskava"');
  });

  it("Kommunaalid (index 3) tuleb enne Fondid (index 4) SECS massiivias", () => {
    const secsStart = src.indexOf('const SECS = [');
    const secsEnd = src.indexOf('];', secsStart);
    const secsBlock = src.slice(secsStart, secsEnd);
    const kommunaalidIdx = secsBlock.indexOf('"Kommunaalid"');
    const fondidIdx = secsBlock.indexOf('"Fondid"');
    expect(kommunaalidIdx).toBeGreaterThan(-1);
    expect(fondidIdx).toBeGreaterThan(-1);
    expect(kommunaalidIdx).toBeLessThan(fondidIdx);
  });

  it("Fondid tuleb pärast Kommunaalid ja enne Kohustuste jaotus", () => {
    const secsStart = src.indexOf('const SECS = [');
    const secsEnd = src.indexOf('];', secsStart);
    const secsBlock = src.slice(secsStart, secsEnd);
    const fondidIdx = secsBlock.indexOf('"Fondid"');
    const kohustIdx = secsBlock.indexOf('"Kohustuste jaotus"');
    expect(fondidIdx).toBeLessThan(kohustIdx);
  });
});

// ── 2. sec === X sisu plokid vastavad tabidele ────────────────────────────────

describe("sec === X sisu plokid", () => {
  it("sec === 3 renderdab Kommunaalid sisu", () => {
    const sec3Idx = src.indexOf('sec === 3 && (() => {');
    expect(sec3Idx).toBeGreaterThan(-1);
    const sec3Block = src.slice(sec3Idx, sec3Idx + 500);
    expect(sec3Block).toContain('kommunaalRead');
  });

  it("sec === 4 renderdab Fondid sisu", () => {
    const sec4Idx = src.indexOf('sec === 4 && (');
    expect(sec4Idx).toBeGreaterThan(-1);
    const sec4Block = src.slice(sec4Idx, sec4Idx + 500);
    // Fondid tab has clearBtn(4) and Rahastamine heading
    expect(sec4Block).toContain('clearBtn(4)');
  });

  it("Kommunaalid plokis pole clearBtn", () => {
    const sec3Start = src.indexOf('sec === 3 && (() => {');
    const sec3End = src.indexOf('sec === 4 && (', sec3Start);
    const sec3Block = src.slice(sec3Start, sec3End);
    expect(sec3Block).not.toContain('clearBtn(3)');
  });
});

// ── 3. tabStatus indeksite sidumine ──────────────────────────────────────────

describe("tabStatus indeksid", () => {
  it("tabStatus index 3 on Kommunaalid staatus (kommunaalRows.some)", () => {
    const tsStart = src.indexOf('const tabStatus = [');
    const tsEnd = src.indexOf('];', tsStart);
    const tsBlock = src.slice(tsStart, tsEnd);
    // kommunaalRows.some must appear before hasFondidData in tabStatus
    const kommunaalStatusIdx = tsBlock.indexOf('kommunaalRows.some');
    const fondidStatusIdx = tsBlock.indexOf('hasFondidData');
    expect(kommunaalStatusIdx).toBeGreaterThan(-1);
    expect(fondidStatusIdx).toBeGreaterThan(-1);
    expect(kommunaalStatusIdx).toBeLessThan(fondidStatusIdx);
  });
});

// ── 4. clearSection(4) kustutab Fondid andmed ────────────────────────────────

describe("clearSection indeks Fondid andmete kustutamiseks", () => {
  it("clearSection tabIdx === 4 haru on olemas ja kustutab RF/reservkapitali", () => {
    const csStart = src.indexOf('const clearSection = (tabIdx) => {');
    const csEnd = src.indexOf('const clearBtn = ', csStart);
    const csBlock = src.slice(csStart, csEnd);
    expect(csBlock).toContain('tabIdx === 4');
    const haru4Idx = csBlock.indexOf('tabIdx === 4');
    const haru4Block = csBlock.slice(haru4Idx, haru4Idx + 300);
    expect(haru4Block).toContain('setRemondifond');
    expect(haru4Block).toContain('setResKap');
  });

  it("clearBtn(4) on Fondid (sec === 4) plokis", () => {
    const sec4Idx = src.indexOf('sec === 4 && (');
    const sec4Block = src.slice(sec4Idx, sec4Idx + 200);
    expect(sec4Block).toContain('clearBtn(4)');
  });

  it("clearSection-il puudub tabIdx === 3 haru — Kommunaalid on osa Tab 2 andmetest", () => {
    const csStart = src.indexOf('const clearSection = (tabIdx) => {');
    const csEnd = src.indexOf('const clearBtn = ', csStart);
    const csBlock = src.slice(csStart, csEnd);
    expect(csBlock).not.toContain('tabIdx === 3');
  });
});

// ── 5. Print järjekord ei sõltu UI tab järjekorrast ──────────────────────────

describe("Print/lõppdokument: KrtS § 41 järjekord muutumatu", () => {
  const PRINT_SECTIONS = [
    "Ülevaade kaasomandi eseme seisukorrast ja kavandatavatest toimingutest",
    "Korteriühistu kavandatavad tulud ja kulud",
    "Korteriomanike kohustuste jaotus majandamiskulude kandmisel",
    "Reservkapitali ja remondifondi tehtavate maksete suurus",
    "Kütuse, soojuse, vee- ja kanalisatsiooniteenuse ning elektri prognoositav kogus ja maksumus",
  ];

  it("print sektsioonid on olemas ja järjestuses", () => {
    const positions = PRINT_SECTIONS.map(title => src.indexOf(`print-section-title">${title}`));
    positions.forEach(p => expect(p).toBeGreaterThan(-1));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("UI kommunaalid (sec === 3) on print p5-s (viimane enne footnotes)", () => {
    const p5Idx = src.indexOf('print-section-title">Kütuse, soojuse');
    const p4Idx = src.indexOf('print-section-title">Reservkapitali ja remondifondi');
    // p5 (kommunaalid) tuleb print struktuuris pärast p4 (fondid)
    expect(p5Idx).toBeGreaterThan(p4Idx);
  });
});
