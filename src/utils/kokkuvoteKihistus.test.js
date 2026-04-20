import { describe, it, expect } from "vitest";
import { computeKokkuvoteKihistus } from "./kokkuvoteKihistus";

const baseApt = {
  id: "apt1", tahis: "K1", pind: 50,
  kommunaal: 100, haldus: 50, remondifond: 40, laenumakse: 0, reserv: 10,
};

const baseInput = {
  korteriteKuumaksed: [baseApt],
  remondifondiArvutus: {},
  kopiiriondvaade: {},
  plan: {},
};

describe("computeKokkuvoteKihistus", () => {
  it("total equals sum of components", () => {
    const [r] = computeKokkuvoteKihistus(baseInput);
    expect(r.total).toBe(100 + 50 + 40 + 0 + 10);
    expect(r.total).toBe(200);
  });

  it("topMojutajad are the largest components", () => {
    const [r] = computeKokkuvoteKihistus(baseInput);
    expect(r.topMojutajad[0].key).toBe("kommunaal");
    expect(r.topMojutajad[1].key).toBe("haldus");
    expect(r.topMojutajad[2].key).toBe("remondifond");
  });

  it("zero values do not appear in components or topMojutajad", () => {
    const [r] = computeKokkuvoteKihistus(baseInput);
    expect(r.components.every(c => c.eur > 0)).toBe(true);
    expect(r.topMojutajad.every(c => c.eur > 0)).toBe(true);
    expect(r.components.find(c => c.key === "laenumakse")).toBeUndefined();
  });

  it("repeated calls with same input return identical results", () => {
    const r1 = computeKokkuvoteKihistus(baseInput);
    const r2 = computeKokkuvoteKihistus(baseInput);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("eurPerM2 is correct", () => {
    const [r] = computeKokkuvoteKihistus(baseInput);
    expect(r.eurPerM2).toBe(200 / 50);
    expect(r.eurPerM2).toBe(4.0);
  });

  it("apartment with pind = 0 does not produce NaN in eurPerM2", () => {
    const aptZero = { ...baseApt, pind: 0 };
    const [r] = computeKokkuvoteKihistus({ ...baseInput, korteriteKuumaksed: [aptZero] });
    expect(r.eurPerM2).toBe(0);
    expect(Number.isNaN(r.eurPerM2)).toBe(false);
    expect(Number.isFinite(r.eurPerM2)).toBe(true);
  });

  it("shares sum to 1.0 within floating point tolerance", () => {
    const [r] = computeKokkuvoteKihistus(baseInput);
    const sum = r.components.reduce((s, c) => s + c.share, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });
});
