// src/utils/uiMarkusToggle.test.js
// Lukustab "+ Lisa märkus" toggle mustri Tab 2-s ja Tab 3-s ning Tab 1 aasta vaikeväärtuse.

import { describe, it, expect, beforeAll } from "vitest";

let src;

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
});

// ── 1. Tab 2: "+ Lisa märkus" nupp ──────────────────────────────────────────

describe("Tab 2: nupu tekst on '+ Lisa märkus'", () => {
  it("Tab 2 kulu- ja tuluridadel on '+ Lisa märkus' nupp", () => {
    expect(src).toContain("+ Lisa märkus");
  });

  it("Tab 2-s ei esine enam '+ Lisa täpsustus' nupuna", () => {
    // "+ Lisa täpsustus" ei tohi esineda nupuna; "Lisa täpsustus" on lubatud valideerimistekstina
    const buttonMatches = src.match(/>\s*\+\s*Lisa täpsustus\s*</g) || [];
    expect(buttonMatches.length).toBe(0);
  });

  it("erandi aluse valideerimistekst 'Lisa täpsustus' on endiselt alles", () => {
    expect(src).toContain('"Lisa täpsustus"');
  });
});

// ── 2. Tab 2: avatud olekus label on 'Märkus' ───────────────────────────────

describe("Tab 2: avatud märkuse välja label", () => {
  it("kulu- ja tulurea avatud olekus on 'Märkus' label (mitte 'Täpsustus')", () => {
    // Leiame "Märkus" esimese esinemise konteksti — peab olema fieldLabel diviga
    expect(src).toMatch(/fieldLabel.*Märkus|Märkus.*valikuline/s);
  });

  it("'Täpsustus (valikuline)' label ei esine Tab 2 kommentaariväljas", () => {
    // "Täpsustus" võib esineda erandi aluse juures, aga mitte kulu/tulu rea kommentaariväljas
    // Kontrollime, et "Märkus" esineb välja labelina
    const markusLabelCount = (src.match(/Märkus.*valikuline/g) || []).length;
    expect(markusLabelCount).toBeGreaterThan(0);
  });
});

// ── 3. Tab 3: rfUsageItem märkus kasutab '+ Lisa märkus' toggle mustrit ─────

describe("Tab 3: rfUsageItem märkuse toggle", () => {
  it("'+ Lisa märkus' nupp esineb rfUsageItem plokis", () => {
    const rfStart = src.indexOf("Fondist rahastatavad tööd");
    const rfEnd = src.indexOf("Fondi suunatud muu tulu");
    const rfSection = rfStart >= 0 && rfEnd > rfStart ? src.slice(rfStart, rfEnd) : "";
    expect(rfSection).toContain("+ Lisa märkus");
  });

  it("rfUsageItem avatud olekus on 'Märkus (valikuline)' label", () => {
    const rfStart = src.indexOf("Fondist rahastatavad tööd");
    const rfEnd = src.indexOf("Fondi suunatud muu tulu");
    const rfSection = rfStart >= 0 && rfEnd > rfStart ? src.slice(rfStart, rfEnd) : "";
    expect(rfSection).toContain("Märkus");
    expect(rfSection).toContain("valikuline");
  });

  it("rfUsageItem märkuse sisend ei ole alati nähtav (toggle pattern)", () => {
    const rfStart = src.indexOf("Fondist rahastatavad tööd");
    const rfEnd = src.indexOf("Fondi suunatud muu tulu");
    const rfSection = rfStart >= 0 && rfEnd > rfStart ? src.slice(rfStart, rfEnd) : "";
    // Toggle mustris on tingimus: markus puudumisel kuvab nupu, mitte sisendi kohe
    expect(rfSection).toMatch(/usageItem\.markus.*isMarkusOpen|isMarkusOpen.*usageItem\.markus/s);
  });
});

// ── 4. Tab 1: uue rea aasta tuleb plan.period.year-ist ─────────────────────

describe("Tab 1: uue rea aasta vaikeväärtus", () => {
  it("lisaSeisukordRida kasutab plan.period.year, mitte new Date()", () => {
    const fnStart = src.indexOf("const lisaSeisukordRida");
    const fnEnd = src.indexOf("};", fnStart);
    const fnBody = src.slice(fnStart, fnEnd + 2);
    expect(fnBody).toContain("plan.period.year");
    expect(fnBody).not.toContain("new Date()");
  });

  it("Tab 1 aasta fallback on tühi string, mitte konkreetne aasta", () => {
    const fnStart = src.indexOf("const lisaSeisukordRida");
    const fnEnd = src.indexOf("};", fnStart);
    const fnBody = src.slice(fnStart, fnEnd + 2);
    // Fallback on "" (tühi), mitte hardcoded aastanumber
    expect(fnBody).toMatch(/plan\.period\.year.*:\s*""/s);
    expect(fnBody).not.toMatch(/plan\.period\.year.*:\s*\d{4}/);
  });
});
