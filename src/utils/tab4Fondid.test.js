// src/utils/tab4Fondid.test.js
// Lukustab Fondid tabi (sec === 4) Reservkapitali UI loogika.

import { describe, it, expect, beforeAll } from "vitest";

let src;

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
});

// ── 1. Kasutamine perioodis ei ole vaikimisi nähtav ───────────────────────────

describe("Reservkapital: kasutamine perioodis on peidetud vaikimisi", () => {
  it("'Kasutamine perioodis' ei esine üksiku väljana Reservkapitali plokis", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    // Standalone label "Kasutamine perioodis" ei tohi olla - ainult erandploki toggle
    expect(sec4Block).not.toContain('"Kasutamine perioodis"');
    expect(sec4Block).not.toContain(">Kasutamine perioodis<");
  });

  it("Toggle 'Kas reservkapitalist kasutatakse perioodis raha?' on Fondid plokis", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("Kas reservkapitalist kasutatakse perioodis raha?");
  });

  it("toggle kasutab usesReserveDuringPeriod boolean't", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("usesReserveDuringPeriod");
  });

  it("kasutuse inputväli on tingimusliku renderduse sees (usesReserveDuringPeriod)", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    // 'Reservkapitalist kasutatav summa perioodis' tuleb pärast usesReserveDuringPeriod tingimust
    const toggleIdx = sec4Block.indexOf("usesReserveDuringPeriod");
    const inputLabelIdx = sec4Block.indexOf("Reservkapitalist kasutatav summa perioodis");
    expect(inputLabelIdx).toBeGreaterThan(toggleIdx);
  });
});

// ── 2. resKap state ───────────────────────────────────────────────────────────

describe("resKap state: usesReserveDuringPeriod väli", () => {
  it("resKap useState algväärtus sisaldab usesReserveDuringPeriod: false", () => {
    const initIdx = src.indexOf("const [resKap, setResKap] = useState({");
    const initEnd = src.indexOf("});", initIdx);
    const initBlock = src.slice(initIdx, initEnd);
    expect(initBlock).toContain("usesReserveDuringPeriod: false");
  });

  it("faili laadimise migratsioon seab usesReserveDuringPeriod", () => {
    const loadIdx = src.indexOf("if (data.resKap) {");
    const loadEnd = src.indexOf("}", loadIdx + 10);
    const loadBlock = src.slice(loadIdx, loadEnd + 200);
    expect(loadBlock).toContain("usesReserveDuringPeriod");
    // auto-open: kui kasutamine > 0
    expect(loadBlock).toContain("parseFloat(loadedKasutamine) > 0");
  });

  it("clearSection(4) lähtestab usesReserveDuringPeriod false-ks", () => {
    const csIdx = src.indexOf("const clearSection = (tabIdx) => {");
    const csEnd = src.indexOf("const clearBtn = ", csIdx);
    const csBlock = src.slice(csIdx, csEnd);
    const haru4Idx = csBlock.indexOf("tabIdx === 4");
    const haru4Block = csBlock.slice(haru4Idx, haru4Idx + 400);
    expect(haru4Block).toContain("usesReserveDuringPeriod: false");
  });
});

// ── 3. Arvutusloogika ─────────────────────────────────────────────────────────

describe("Reservkapital: rkKasutamine arvutatakse toggle järgi", () => {
  it("rkKasutamine = 0 kui usesReserveDuringPeriod on false", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    // usesReserveDuringPeriod tingimus peab olema enne rkKasutamine kasutamist
    expect(sec4Block).toContain("resKap.usesReserveDuringPeriod ? (parseFloat(resKap.kasutamine) || 0) : 0");
  });

  it("rkSaldoLopp = rkSaldoAlgus + rkKogumine - rkKasutamine", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("rkSaldoAlgus + rkKogumine - rkKasutamine");
  });

  it("nõutav miinimum = 1/12 aastakuludest (reserveMin.noutavMiinimum)", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("reserveMin.noutavMiinimum");
    expect(sec4Block).toContain("1/12 aastakuludest");
  });

  it("puudu = max(0, noutavMinimum - rkSaldoLopp)", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("Math.max(0, noutavMinimum - rkSaldoLopp)");
  });

  it("soovituslikKogumine = max(0, noutavMinimum + rkKasutamine - rkSaldoAlgus)", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("Math.max(0, noutavMinimum + rkKasutamine - rkSaldoAlgus)");
  });
});

// ── 4. Miinimumi kontroll ─────────────────────────────────────────────────────

describe("Reservkapital: miinimumi kontroll UI", () => {
  it("'Nõutav miinimum on täidetud.' kuvatakse kui vastab", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("Nõutav miinimum on täidetud.");
  });

  it("hoiatus 'prognoositav lõppsaldo jääb alla' kuvatakse kui ei vasta", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("prognoositav lõppsaldo jääb alla nõutava miinimumi");
  });

  it("'Puudu nõutava miinimumini:' on hoiatusplokis", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("Puudu nõutava miinimumini:");
  });

  it("soovituslik minimaalne kogumine kuvatakse hoiatusplokis", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("Soovituslik minimaalne kogumine perioodis:");
  });
});

// ── 5. Prognoositav lõppsaldo on kokkuvõttevaade ─────────────────────────────

describe("Reservkapital: Prognoositav lõppsaldo nimetus", () => {
  it("kokkuvõtte sektsioon kasutab nimetust 'Prognoositav lõppsaldo'", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("Prognoositav lõppsaldo");
  });

  it("planeeritud kogumine perioodis on endiselt kasutaja sisend (mitte readonly)", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    // EuroInput kasutamine plannedEUR jaoks peaks olema olemas
    expect(sec4Block).toContain("funds.reserve, plannedEUR");
  });
});

// ── 6. Remondifond ja computePlan jäid muutmata ───────────────────────────────

describe("Remondifond ja computePlan: puutumata", () => {
  it("computePlan.js ei sisalda settledPostHoc ega resKap viiteid", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const cpSrc = fs.readFileSync(path.resolve(__dirname, "../engine/computePlan.js"), "utf-8");
    expect(cpSrc).not.toContain("resKap");
    expect(cpSrc).not.toContain("usesReserveDuringPeriod");
  });

  it("remondifondiArvutus IIFE on sec === 4 plokis muutmata (saldoLopp on olemas)", () => {
    const sec4Idx = src.indexOf("sec === 4 && (");
    const sec4End = src.indexOf("sec === 5 && (", sec4Idx);
    const sec4Block = src.slice(sec4Idx, sec4End);
    expect(sec4Block).toContain("remondifondiArvutus");
    expect(sec4Block).toContain("ra.saldoLopp");
  });
});
