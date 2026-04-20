import { describe, it, expect } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// Korteri detailrida ei tohi näidata eksitavat arvutuskäiku
//
// Vana muster: `kommunaalKokku × osa% = summa` eeldas, et kõik
// kuluread jagunevad m² järgi. Kuna jaotusalus võib olla "korter",
// ei pea see valem enam paika. Eemaldatud, kuvab ainult tulemusi.
// ══════════════════════════════════════════════════════════════════════

describe("korteri detailrida ei sisalda eksitavat valemit", () => {
  it("MajanduskavaApp.jsx ei sisalda vana osa% valemit detailreas", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../MajanduskavaApp.jsx"),
      "utf-8"
    );

    // Vana muster: kommunaalKokku × osa%
    expect(src).not.toMatch(/kommunaalKokku\).*×.*osa\s*\*/);
    expect(src).not.toMatch(/haldusKokku\).*×.*osa\s*\*/);

    // Protsendi valem km.osa * 100 ei tohi esineda detailreas
    // (see esineb endiselt tfoot'is jm kohtades, aga mitte isOpen plokis)
    const isOpenBlock = src.match(/\{isOpen && \([\s\S]*?\n\s*\)\}/);
    expect(isOpenBlock).toBeTruthy();
    expect(isOpenBlock[0]).not.toMatch(/km\.osa\s*\*\s*100/);
    expect(isOpenBlock[0]).not.toMatch(/×/);
  });
});
