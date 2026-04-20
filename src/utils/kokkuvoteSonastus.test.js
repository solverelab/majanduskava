import { describe, it, expect, beforeAll } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// Tab 6 kokkuvõtte tulude sõnastus — automaatsed katteread eristatud
// ══════════════════════════════════════════════════════════════════════

describe("Tab 6 tulude ploki sõnastus", () => {
  let src;

  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(
      path.resolve(__dirname, "../MajanduskavaApp.jsx"),
      "utf-8"
    );
  });

  it("Kommunaalmaksed on märgitud 'Arvutatud kulude põhjal'", () => {
    expect(src).toContain("Arvutatud kulude põhjal · </span>Kommunaalmaksed");
  });

  it("Haldustasu on märgitud 'Arvutatud kulude põhjal'", () => {
    expect(src).toContain("Arvutatud kulude põhjal · </span>Haldustasu");
  });

  it("Muu tulu ei ole märgitud 'Arvutatud kulude põhjal'", () => {
    // "Muu tulu" ei tohi olla arvutatud prefiksiga
    expect(src).not.toMatch(/Arvutatud kulude põhjal.*Muu tulu/);
  });
});
