// src/utils/rfSihttaseToggle.test.js
// Lukustab Tab 3 Remondifondi sihttaseme toggle-mustri UI loogika.

import { describe, it, expect, beforeAll } from "vitest";

let src;
let rfBlock;

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  const start = src.indexOf("{/* ── Pealkirja rida (ühtne teiste tabidega) ── */}");
  const end = src.indexOf(">Rahastamine</div>", start);
  rfBlock = start >= 0 && end > start ? src.slice(start, end) : "";
});

// ── 1. Prognoositav lõppsaldo on alati nähtav ────────────────────────────────

describe("Prognoositav lõppsaldo: alati nähtav", () => {
  it("'Prognoositav remondifondi saldo perioodi lõpus' on alati renderdatav (pole toggle taga)", () => {
    // H3_STYLE pealkiri on tingimusteta kuvamisel
    const h3Idx = rfBlock.indexOf("H3_STYLE");
    const prognoositavIdx = rfBlock.indexOf("Prognoositav remondifondi saldo perioodi lõpus");
    expect(prognoositavIdx).toBeGreaterThan(-1);
    // Pealkiri peab tulema enne sihttaseme toggle-i
    const sihttaseIdx = rfBlock.indexOf("Soovin määrata lõppsaldo sihttaseme");
    expect(prognoositavIdx).toBeLessThan(sihttaseIdx);
  });

  it("valemirida '= Prognoositav remondifondi saldo perioodi lõpus' on kokkuvõttes", () => {
    expect(rfBlock).toContain("= Prognoositav remondifondi saldo perioodi lõpus");
  });
});

// ── 2. Soovitud lõppsaldo on vaikimisi peidetud ───────────────────────────────

describe("Soovitud lõppsaldo: vaikimisi peidus", () => {
  it("'Soovin määrata lõppsaldo sihttaseme' nupp on olemas", () => {
    expect(rfBlock).toContain("Soovin määrata lõppsaldo sihttaseme");
  });

  it("toggle on !(hasSoovitud || isSihttaseOpen) tingimuse taga", () => {
    expect(rfBlock).toContain("hasSoovitud || isSihttaseOpen");
  });

  it("isSihttaseOpen state on kasutuses — setIsSihttaseOpen kutsutakse nupul", () => {
    expect(rfBlock).toContain("setIsSihttaseOpen(true)");
  });

  it("soovitud väli on vana 'Soovitud saldo perioodi lõpus' label-ita — asendati uuega", () => {
    // Vana label ei tohi enam esineda UI-s (ainult uus)
    expect(rfBlock).not.toContain('"Soovitud saldo perioodi lõpus"');
    expect(rfBlock).not.toContain(">Soovitud saldo perioodi lõpus<");
  });
});

// ── 3. Label muutus ───────────────────────────────────────────────────────────

describe("Sihttaseme label", () => {
  it("uus label on 'Soovitud minimaalne lõppsaldo perioodi lõpus'", () => {
    expect(rfBlock).toContain("Soovitud minimaalne lõppsaldo perioodi lõpus");
  });

  it("olemasoleva sihttaseme väärtusega plokk avaneb automaatselt — hasSoovitud on tingimuses", () => {
    // hasSoovitud || isSihttaseOpen: kui hasSoovitud = true, avaneb ilma klikita
    const toggleCond = rfBlock.indexOf("hasSoovitud || isSihttaseOpen");
    expect(toggleCond).toBeGreaterThan(-1);
    const condSnippet = rfBlock.slice(toggleCond, toggleCond + 50);
    expect(condSnippet).toContain("hasSoovitud");
  });
});

// ── 4. Puudujääk/ülejääk ja soovituslik — ainult sihttaseme olemasolul ───────

describe("Puudujääk/ülejääk ja soovituslik määr: ainult hasSoovitud korral", () => {
  it("sihttaseme puudumisel ei kuvata puudujääki/ülejääki — hasSoovitud kaitseb", () => {
    // Puudujääk/ülejääk on hasSoovitud && (...) taga — otsime laiema aknaga
    const puudujaaIdx = rfBlock.indexOf("Puudujääk soovitud saldoni");
    const puudujaaCtx = rfBlock.slice(Math.max(0, puudujaaIdx - 500), puudujaaIdx);
    expect(puudujaaCtx).toContain("hasSoovitud");
  });

  it("sihttaseme puudumisel ei kuvata soovituslikku määra — hasSoovitud kaitseb", () => {
    // soovituslikMaar arvutatakse ainult kui hasSoovitud && diff < 0
    expect(rfBlock).toContain("hasSoovitud && diff < 0");
  });

  it("sihttaseme olemasolul kuvatakse puudujääk või ülejääk — tekstid on koodis", () => {
    expect(rfBlock).toContain("Puudujääk soovitud saldoni");
    expect(rfBlock).toContain("Ülejääk soovitud saldost");
  });
});

// ── 5. Soovituslik määr ei kirjuta kasutaja sisendit üle ─────────────────────

describe("Soovituslik määr: readonly, ei kirjuta maarOverride üle", () => {
  it("soovituslikMaar on lokaalne muutuja — setRemondifond puudub arvutuse plokist", () => {
    const calcIdx = rfBlock.indexOf("soovituslikMaar = neededLaekumine");
    expect(calcIdx).toBeGreaterThan(-1);
    const calcBlock = rfBlock.slice(Math.max(0, calcIdx - 200), calcIdx + 500);
    expect(calcBlock).not.toContain("setRemondifond");
    expect(calcBlock).not.toContain("maarOverride:");
  });

  it("soovituslik määr kuvatakse tekstina (monospace), mitte sisendväljana", () => {
    const soovituslikIdx = rfBlock.lastIndexOf("Soovituslik uus makse määr");
    const displayCtx = rfBlock.slice(Math.max(0, soovituslikIdx - 100), soovituslikIdx + 200);
    expect(displayCtx).not.toContain("<input");
    expect(displayCtx).toContain("monospace");
  });
});
