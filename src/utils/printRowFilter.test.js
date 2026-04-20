import { describe, it, expect } from "vitest";

// Mirrors the exact print filter predicate used in MajanduskavaApp.jsx print-view.
// Same rule as gate's hasRealCost / hasRealIncome: summaInput > 0.
const isSubstantialRow = (r) => (parseFloat(r.summaInput) || 0) > 0;

describe("print kuluridade filter", () => {
  it("ainult kategooriaga, summa 0 → ei jõua printi", () => {
    expect(isSubstantialRow({ category: "Soojus", name: "", summaInput: 0 })).toBe(false);
  });

  it("ainult nimega, summa 0 → ei jõua printi", () => {
    expect(isSubstantialRow({ category: "", name: "Muu", summaInput: 0 })).toBe(false);
  });

  it("summaga → jõuab printi", () => {
    expect(isSubstantialRow({ category: "Soojus", name: "", summaInput: "12000" })).toBe(true);
  });

  it("auto-seed tühi rida → ei jõua printi", () => {
    expect(isSubstantialRow({ category: "", name: "", summaInput: 0 })).toBe(false);
  });

  it("kõik read filtreeruvad välja → tühi massiiv", () => {
    const rows = [
      { category: "Soojus", name: "", summaInput: 0 },
      { category: "", name: "", summaInput: "" },
    ];
    expect(rows.filter(isSubstantialRow)).toEqual([]);
  });
});

describe("print tuluridade filter", () => {
  it("ainult nimega, summa 0 → ei jõua printi", () => {
    expect(isSubstantialRow({ category: "Muu tulu", name: "Renditulu", summaInput: 0 })).toBe(false);
  });

  it("ainult nimega, summa tühi → ei jõua printi", () => {
    expect(isSubstantialRow({ category: "Muu tulu", name: "Renditulu", summaInput: "" })).toBe(false);
  });

  it("summaga → jõuab printi", () => {
    expect(isSubstantialRow({ category: "Muu tulu", name: "Renditulu", summaInput: "400" })).toBe(true);
  });

  it("auto-seed tühi tulurida → ei jõua printi", () => {
    expect(isSubstantialRow({ category: "Muu tulu", name: "", summaInput: "" })).toBe(false);
  });

  it("kõik tuluread filtreeruvad välja → tühi massiiv", () => {
    const rows = [
      { category: "Muu tulu", name: "Renditulu", summaInput: 0 },
      { category: "Muu tulu", name: "", summaInput: "" },
    ];
    expect(rows.filter(isSubstantialRow)).toEqual([]);
  });
});
