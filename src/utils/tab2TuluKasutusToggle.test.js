// src/utils/tab2TuluKasutusToggle.test.js
// Lukustab "Kasutamine" välja käitumise Tab 2 tuluridadel.
// Uues UI-s on "Kasutamine" alati nähtav — tingimuslikku showTuluSuunamine plokki pole.

import { describe, it, expect, beforeAll } from "vitest";

let src;
let incomeSection;

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  // Kasuta UI-spetsiifilist ankrut — isMarkusOpenR on ainult tulude UI map-is
  const start = src.indexOf("isMarkusOpenR = !!r.note");
  const end = src.indexOf("+ Lisa tulu", start);
  incomeSection = start >= 0 && end > start ? src.slice(start, end) : "";
});

describe("Tab 2: tulurea kategooria ja kasutamine väljad", () => {
  it("'Kategooria' label on tulurea renderduses — asendas 'Kasutamine' dropdowni", () => {
    expect(incomeSection).toContain(">Kategooria<");
  });

  it("tingimuslikku showTuluSuunamine muutujat pole", () => {
    expect(incomeSection).not.toContain("showTuluSuunamine");
  });

  it("'Kasutamine' dropdown-i pole tulureal — Kategooria select asendab seda", () => {
    expect(incomeSection).not.toContain(">Kasutamine<");
    expect(incomeSection).not.toContain("Kasutatakse üldkulude katteks");
  });

  it("incomeAllocations sync kasutab .length > 0 — ka mitme allokeeringuga read toimivad", () => {
    expect(incomeSection).toContain("(r.incomeAllocations || []).length > 0");
  });

  it("'Kasutatakse üldkulude katteks' dropdown-valikut pole tulureal", () => {
    expect(incomeSection).not.toContain(">Kasutamine<");
    expect(incomeSection).not.toContain("Suunatakse remondifondi");
    expect(incomeSection).not.toContain("Suunatakse reservkapitali");
  });
});
