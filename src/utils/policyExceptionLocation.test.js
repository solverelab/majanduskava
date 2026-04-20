// src/utils/policyExceptionLocation.test.js
// Lukustab jaotusaluse erandi UI paigutuse — fondide tabis ei ole enam eraldi
// "Jaotusaluse erandid" plokki; erand elab vastava üksuse juures.

import { describe, it, expect, beforeAll } from "vitest";

describe("Jaotusaluse erandi UI paigutus", () => {
  let src;
  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  });

  it("eraldi 'Jaotusaluse erandid' sektsioon on eemaldatud", () => {
    expect(src).not.toContain("Jaotusaluse erandid");
  });

  it("helper renderPolicyException on defineeritud", () => {
    expect(src).toContain("const renderPolicyException");
  });

  it("renderPolicyException kutsutakse remondifondile, reservkapitalile ja maintenance'ile", () => {
    expect(src).toContain('renderPolicyException("remondifond")');
    expect(src).toContain('renderPolicyException("reserve")');
    expect(src).toContain('renderPolicyException("maintenance")');
  });

  it("maintenance-erand on seotud ainult HALDUSTEENUSED kuluridadega", () => {
    expect(src).toMatch(/HALDUSTEENUSED\.includes\(r\.category\)\s*&&\s*renderPolicyException\("maintenance"\)/);
  });

  it("aluse silt on 'Alus', mitte 'Õiguslik alus' uues editoris", () => {
    // renderPolicyException-i sees peab 'Alus' olema + "Õiguslik alus" vaid ajaloolistes kuvatekstides summary-read jaoks
    const editorStart = src.indexOf("const renderPolicyException");
    expect(editorStart).toBeGreaterThan(-1);
    const editorBody = src.slice(editorStart, editorStart + 3000);
    expect(editorBody).toContain(">Alus<");
    // Editori sees ei ole silti "Õiguslik alus"
    expect(editorBody).not.toContain(">Õiguslik alus<");
  });

  it("aluse valikud on 'Põhikiri' ja 'Erikokkulepe' suure algustähega", () => {
    const editorStart = src.indexOf("const renderPolicyException");
    const editorBody = src.slice(editorStart, editorStart + 3000);
    expect(editorBody).toContain('<option value="pohikiri">Põhikiri</option>');
    expect(editorBody).toContain('<option value="erikokkulepe">Erikokkulepe</option>');
  });

  it("selgitusväli kasutab silti 'Selgitus (valikuline)'", () => {
    const editorStart = src.indexOf("const renderPolicyException");
    const editorBody = src.slice(editorStart, editorStart + 3000);
    expect(editorBody).toContain("Selgitus (valikuline)");
    expect(editorBody).not.toContain("Viide / märkus");
  });

  it("placeholder ei sisalda § 12 viidet", () => {
    const editorStart = src.indexOf("const renderPolicyException");
    const editorBody = src.slice(editorStart, editorStart + 3000);
    expect(editorBody).not.toMatch(/§\s*12/);
    expect(editorBody).toContain('placeholder="Kirjelda lühidalt erandi alust"');
  });

  it("eemaldatud on eksitav 'Erand rakendub pärast õigusliku aluse määramist' tekst", () => {
    expect(src).not.toContain("Erand rakendub pärast õigusliku aluse määramist");
  });

  it("toggle ON kirjutab AINULT overrideBasis — ei prefill'i legalBasis'i state'i (arithmetic ei liigu)", () => {
    const editorStart = src.indexOf("const renderPolicyException");
    const editorBody = src.slice(editorStart, editorStart + 3000);
    // Peab sisaldama ON-patch'i ainult overrideBasis-ga
    expect(editorBody).toMatch(/patch\(\{\s*overrideBasis:\s*"korter"\s*\}\)/);
    // Ei tohi sisaldada legalBasis prefilli samal real
    expect(editorBody).not.toMatch(/overrideBasis:\s*"korter"\s*,\s*legalBasis:\s*"pohikiri"/);
  });

  it("select näitab vaikimisi 'Põhikiri' esimese valikuna, aga state väärtus jääb null-iks kuni tegeliku valikuni", () => {
    const editorStart = src.indexOf("const renderPolicyException");
    const editorBody = src.slice(editorStart, editorStart + 3000);
    // Controlled select kuvab "pohikiri" kui state on null
    expect(editorBody).toMatch(/value=\{policy\.legalBasis\s*\|\|\s*"pohikiri"\}/);
    // Esimese option'ina on Põhikiri
    const selectStart = editorBody.indexOf("<select");
    const selectBody = editorBody.slice(selectStart, selectStart + 500);
    const pohikiriIdx = selectBody.indexOf('value="pohikiri"');
    const erikokkuleppeIdx = selectBody.indexOf('value="erikokkulepe"');
    expect(pohikiriIdx).toBeGreaterThan(-1);
    expect(erikokkuleppeIdx).toBeGreaterThan(pohikiriIdx);
  });
});
