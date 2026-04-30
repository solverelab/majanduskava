// src/utils/tab2TuluSuunamine.test.js
// Lukustab normalizeIncomeAllocations loogika ja Tab 2 sihtotstarbelise suunamise UI.

import { describe, it, expect, beforeAll } from "vitest";
import { normalizeIncomeAllocations } from "./majanduskavaCalc";

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

// ── 1. normalizeIncomeAllocations: üldine tulu ───────────────────────────────

describe("normalizeIncomeAllocations: general row", () => {
  it("general + tühi incomeAllocations → allocations: [], isValid: true", () => {
    const norm = normalizeIncomeAllocations({ summaInput: "1000", incomeAllocation: "general", incomeAllocations: [] });
    expect(norm.allocations).toHaveLength(0);
    expect(norm.isValid).toBe(true);
    expect(norm.errors).toHaveLength(0);
    expect(norm.totalAllocated).toBe(0);
    expect(norm.unallocatedAmount).toBe(1000);
  });

  it("pole incomeAllocation välja + pole incomeUse → tühjad allokeeringud, kehtiv", () => {
    const norm = normalizeIncomeAllocations({ summaInput: "500" });
    expect(norm.allocations).toHaveLength(0);
    expect(norm.isValid).toBe(true);
  });
});

// ── 2. normalizeIncomeAllocations: targeted, valideerimine ───────────────────

describe("normalizeIncomeAllocations: targeted row valideerimine", () => {
  it("targeted ilma allokeeringuteta → isValid false, 'Vähemalt üks suunamine'", () => {
    const norm = normalizeIncomeAllocations({ summaInput: "1000", incomeAllocation: "targeted", incomeAllocations: [] });
    expect(norm.isValid).toBe(false);
    expect(norm.errors[0]).toContain("Vähemalt üks");
  });

  it("targeted + summa võrdub → isValid true", () => {
    const norm = normalizeIncomeAllocations({
      summaInput: "1000", incomeAllocation: "targeted",
      incomeAllocations: [{ id: "a", target: "repairFund", amount: "1000", note: "" }],
    });
    expect(norm.isValid).toBe(true);
    expect(norm.totalAllocated).toBe(1000);
    expect(norm.unallocatedAmount).toBe(0);
  });

  it("targeted + summa ei võrdu → isValid false, 'kokku andma'", () => {
    const norm = normalizeIncomeAllocations({
      summaInput: "1000", incomeAllocation: "targeted",
      incomeAllocations: [{ id: "a", target: "repairFund", amount: "700", note: "" }],
    });
    expect(norm.isValid).toBe(false);
    expect(norm.errors.some(e => e.includes("kokku andma"))).toBe(true);
  });

  it("targeted + suunamine ilma sihtkohata → viga", () => {
    const norm = normalizeIncomeAllocations({
      summaInput: "1000", incomeAllocation: "targeted",
      incomeAllocations: [{ id: "a", target: "", amount: "1000", note: "" }],
    });
    expect(norm.isValid).toBe(false);
    expect(norm.errors.some(e => e.includes("sihtkoht"))).toBe(true);
  });

  it("mitu allokeeringut summeritakse", () => {
    const norm = normalizeIncomeAllocations({
      summaInput: "1000", incomeAllocation: "targeted",
      incomeAllocations: [
        { id: "a", target: "repairFund", amount: "600", note: "" },
        { id: "b", target: "reserve", amount: "400", note: "" },
      ],
    });
    expect(norm.isValid).toBe(true);
    expect(norm.totalAllocated).toBe(1000);
  });
});

// ── 3. normalizeIncomeAllocations: legacy fallback ───────────────────────────

describe("normalizeIncomeAllocations: legacy andmemudel", () => {
  it("legacy incomeUse=fund + targetFund → alloc id='__legacy__'", () => {
    const norm = normalizeIncomeAllocations({
      summaInput: "1500", incomeUse: "fund", targetFund: "repairFund", fundDirectedAmount: "",
    });
    expect(norm.allocations).toHaveLength(1);
    expect(norm.allocations[0].id).toBe("__legacy__");
    expect(norm.allocations[0].target).toBe("repairFund");
    expect(norm.allocations[0].amount).toBe(1500);
    expect(norm.isValid).toBe(true);
  });

  it("legacy osaline suunamine (fundDirectedAmount) → suunatud osa", () => {
    const norm = normalizeIncomeAllocations({
      summaInput: "1500", incomeUse: "fund", targetFund: "repairFund", fundDirectedAmount: "600",
    });
    expect(norm.allocations[0].amount).toBe(600);
    expect(norm.totalAllocated).toBe(600);
  });

  it("legacy fundDirectedAmount on capped tulurea summaga", () => {
    const norm = normalizeIncomeAllocations({
      summaInput: "500", incomeUse: "fund", targetFund: "repairFund", fundDirectedAmount: "9999",
    });
    expect(norm.allocations[0].amount).toBe(500);
  });

  it("legacy incomeUse=fund ilma targetFundita → tühjad allokeeringud", () => {
    const norm = normalizeIncomeAllocations({
      summaInput: "1000", incomeUse: "fund", targetFund: null, fundDirectedAmount: "",
    });
    expect(norm.allocations).toHaveLength(0);
    expect(norm.isValid).toBe(true);
  });
});

// ── 4. Tab 2 UI: uus mudel ───────────────────────────────────────────────────

describe("Tab 2 UI: tulu sisestusväljad", () => {
  it("'Kategooria' label on tulurea renderduses — asendas 'Kasutamine' dropdowni", () => {
    expect(incomeSection).toContain(">Kategooria<");
  });

  it("'Kasutamine' dropdown-i pole tulureal", () => {
    expect(incomeSection).not.toContain(">Kasutamine<");
    expect(incomeSection).not.toContain("Kasutatakse üldkulude katteks");
    expect(incomeSection).not.toContain("Suunatakse remondifondi");
    expect(incomeSection).not.toContain("Suunatakse reservkapitali");
  });

  it("addRow INCOME sisaldab incomeAllocation: 'general' vaikeväärtust", () => {
    const addRowStart = src.indexOf("const addRow =");
    const addRowEnd = src.indexOf("const updateRow =", addRowStart);
    const addRowSection = src.slice(addRowStart, addRowEnd);
    expect(addRowSection).toContain('incomeAllocation: "general"');
    expect(addRowSection).toContain("incomeAllocations: []");
  });
});
