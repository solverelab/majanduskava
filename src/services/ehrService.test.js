import { describe, it, expect, vi, afterEach } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// fetchApartments — meta ja apt-taseme väljade ühiktestid
//
// EHR v2 struktuur (kontrollitud 104023768 Kalevi tn 119):
//   apartments[].area         ← ehitiseOsaPohiandmed.pind
//   apartments[].koetavPind   ← ehitiseOsaPohiandmed.koetavPind
//   meta.ehrKood              ← fetchApartments() parameeter
//   meta.ehitusaasta          ← ehitiseAndmed.esmaneKasutus
//   meta.korrusteArv          ← ehitisePohiandmed.maxKorrusteArv
//
// meta EI SISALDA suletudNetopind ega koetavPind hoone tasemel —
// need summeeritakse kutsuja poolt korterite ridadest.
// ══════════════════════════════════════════════════════════════════════

function mockFetch(body) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadFetchApartments() {
  const mod = await import("./ehrService.js?t=" + Date.now());
  return mod.fetchApartments;
}

// ── Fixture helper: päris EHR v2 struktuur ───────────────────────────

function mkEhrResponse({
  pohiandmed = {},
  andmed = {},
  apartments = [],
} = {}) {
  return {
    ehitis: {
      ehitisePohiandmed: pohiandmed,
      ehitiseAndmed: andmed,
      ehitiseKehand: {
        kehand: [
          {
            ehitisePindala: {},
            ehitiseOsad: {
              ehitiseOsa: apartments.map(({ tahis, pind, koetavPind }) => ({
                liik: "K",
                tahis,
                ehitiseOsaPohiandmed: {
                  pind: String(pind),
                  ...(koetavPind != null ? { koetavPind: String(koetavPind) } : {}),
                },
              })),
            },
          },
        ],
      },
    },
  };
}

// ── 1. ehrKood tuleb sisendparameetrist ───────────────────────────────

describe("ehrKood tuleb fetchApartments parameetrist", () => {
  it("meta.ehrKood === sisestatud kood", async () => {
    mockFetch(mkEhrResponse());
    const fetchApartments = await loadFetchApartments();
    const { meta } = await fetchApartments("104023768");
    expect(meta.ehrKood).toBe("104023768");
  });
});

// ── 2. ehitusaasta — ehitiseAndmed.esmaneKasutus ─────────────────────

describe("ehitusaasta loetakse ehitiseAndmed.esmaneKasutus", () => {
  it("esmaneKasutus on olemas → meta.ehitusaasta = väärtus", async () => {
    mockFetch(mkEhrResponse({ andmed: { esmaneKasutus: "1977" } }));
    const fetchApartments = await loadFetchApartments();
    const { meta } = await fetchApartments("104023768");
    expect(meta.ehitusaasta).toBe("1977");
  });

  it("esmaneKasutus puudub → meta.ehitusaasta = null", async () => {
    mockFetch(mkEhrResponse({ andmed: {} }));
    const fetchApartments = await loadFetchApartments();
    const { meta } = await fetchApartments("104023768");
    expect(meta.ehitusaasta).toBeNull();
  });
});

// ── 3. korrusteArv — ehitisePohiandmed.maxKorrusteArv ────────────────

describe("korrusteArv loetakse ehitisePohiandmed.maxKorrusteArv", () => {
  it("maxKorrusteArv on olemas → meta.korrusteArv = väärtus", async () => {
    mockFetch(mkEhrResponse({ pohiandmed: { maxKorrusteArv: "2" } }));
    const fetchApartments = await loadFetchApartments();
    const { meta } = await fetchApartments("104023768");
    expect(meta.korrusteArv).toBe("2");
  });

  it("maxKorrusteArv puudub → meta.korrusteArv = null", async () => {
    mockFetch(mkEhrResponse({ pohiandmed: {} }));
    const fetchApartments = await loadFetchApartments();
    const { meta } = await fetchApartments("104023768");
    expect(meta.korrusteArv).toBeNull();
  });
});

// ── 4. meta EI SISALDA hoone üldist suletudNetopind ega koetavPind ───

describe("meta ei sisalda hoone üldiseid pindade välju", () => {
  it("meta.suletudNetopind on undefined (hoone üldist ei kasutata)", async () => {
    mockFetch(mkEhrResponse({ pohiandmed: { suletud_netopind: "192.4" } }));
    const fetchApartments = await loadFetchApartments();
    const { meta } = await fetchApartments("104023768");
    expect(meta.suletudNetopind).toBeUndefined();
  });

  it("meta.koetavPind on undefined (hoone üldist ei kasutata)", async () => {
    mockFetch(mkEhrResponse({ pohiandmed: { koetavPind: "143.7" } }));
    const fetchApartments = await loadFetchApartments();
    const { meta } = await fetchApartments("104023768");
    expect(meta.koetavPind).toBeUndefined();
  });
});

// ── 5. apartments[].koetavPind — apt tasemelt ─────────────────────────

describe("apartments[].koetavPind loetakse ehitiseOsaPohiandmed.koetavPind", () => {
  it("apt koetavPind on olemas → apartments[].koetavPind = number", async () => {
    mockFetch(mkEhrResponse({
      apartments: [{ tahis: "1", pind: "52.3", koetavPind: "17.3" }],
    }));
    const fetchApartments = await loadFetchApartments();
    const { apartments } = await fetchApartments("104023768");
    expect(apartments[0].koetavPind).toBe(17.3);
  });

  it("apt koetavPind puudub → apartments[].koetavPind = null", async () => {
    mockFetch(mkEhrResponse({
      apartments: [{ tahis: "1", pind: "52.3" }],
    }));
    const fetchApartments = await loadFetchApartments();
    const { apartments } = await fetchApartments("104023768");
    expect(apartments[0].koetavPind).toBeNull();
  });

  it("mitme korteri koetavPind on summeeritav", async () => {
    mockFetch(mkEhrResponse({
      apartments: [
        { tahis: "1", pind: "52.3", koetavPind: "17.3" },
        { tahis: "2", pind: "48.7", koetavPind: "17.2" },
        { tahis: "3", pind: "61.0", koetavPind: "35.1" },
      ],
    }));
    const fetchApartments = await loadFetchApartments();
    const { apartments } = await fetchApartments("104023768");
    const koetavSum = apartments.reduce((s, a) => s + (a.koetavPind || 0), 0);
    expect(Math.round(koetavSum * 10) / 10).toBe(69.6); // 17.3 + 17.2 + 35.1
  });
});

// ── 6. apartments.area ja tühi ehitis ────────────────────────────────

describe("apartments array ekstraheerimine", () => {
  it("3 korteri rida → apartments.length = 3, area ja koetavPind korrektne", async () => {
    mockFetch(mkEhrResponse({
      apartments: [
        { tahis: "1", pind: "52.3", koetavPind: "17.3" },
        { tahis: "2", pind: "48.7", koetavPind: "17.2" },
        { tahis: "3", pind: "61.0", koetavPind: "35.1" },
      ],
    }));
    const fetchApartments = await loadFetchApartments();
    const { apartments } = await fetchApartments("104023768");
    expect(apartments).toHaveLength(3);
    expect(apartments[0]).toEqual({ number: "1", area: 52.3, koetavPind: 17.3 });
  });

  it("ehitis: null → apartments = [], meta.ehrKood säilib", async () => {
    mockFetch({ ehitis: null });
    const fetchApartments = await loadFetchApartments();
    const { apartments, meta } = await fetchApartments("104023768");
    expect(apartments).toHaveLength(0);
    expect(meta.ehrKood).toBe("104023768");
  });
});

// ── 7. Realistlik fixture — Kalevi tn 119 struktuuriga ───────────────

describe("realistlik EHR vastus (Kalevi tn 119 struktuur)", () => {
  it("kõik väljad täituvad; suletudNetopind ja koetavPind tulevad apt tasemelt", async () => {
    mockFetch(mkEhrResponse({
      pohiandmed: { maxKorrusteArv: "2" },
      andmed: { esmaneKasutus: "1977" },
      apartments: [
        { tahis: "1", pind: "52.3", koetavPind: "17.3" },
        { tahis: "2", pind: "48.7", koetavPind: "17.2" },
      ],
    }));
    const fetchApartments = await loadFetchApartments();
    const { apartments, meta } = await fetchApartments("104023768");

    // meta: ainult hoone üldandmed
    expect(meta.ehrKood).toBe("104023768");
    expect(meta.ehitusaasta).toBe("1977");
    expect(meta.korrusteArv).toBe("2");
    expect(meta.suletudNetopind).toBeUndefined();
    expect(meta.koetavPind).toBeUndefined();

    // pindade summad tulevad apt ridadest, mitte meta-st
    const areaSum = apartments.reduce((s, a) => s + a.area, 0);
    const koetavSum = apartments.reduce((s, a) => s + (a.koetavPind || 0), 0);
    expect(Math.round(areaSum * 10) / 10).toBe(101.0);  // 52.3 + 48.7
    expect(Math.round(koetavSum * 10) / 10).toBe(34.5); // 17.3 + 17.2
  });
});
