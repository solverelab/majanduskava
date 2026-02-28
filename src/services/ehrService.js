// src/services/ehrService.js
// In-ADS (Maa-amet) + EHR (Ehitisregister) API liides
// Aadressi autocomplete ja korterite m² andmete laadimine

/** Loomulik sortimine korteri numbritele (1, 2, 3, …, 10, 11 — mitte 1, 10, 11, 2) */
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const partsA = String(a).match(re) || [];
  const partsB = String(b).match(re) || [];
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    if (i >= partsA.length) return -1;
    if (i >= partsB.length) return 1;
    const na = Number(partsA[i]);
    const nb = Number(partsB[i]);
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else {
      const cmp = partsA[i].localeCompare(partsB[i]);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

/**
 * Aadressi otsing (autocomplete) — In-ADS gazetteer
 * Filtreerib ainult hooned (liik === "E")
 * @param {string} query — kasutaja sisestatud aadressifragment
 * @returns {Promise<Array<{ address: string, adsOid: string, adsCode: string }>>}
 */
export async function searchAddress(query) {
  const url = `https://inaadress.maaamet.ee/inaadress/gazetteer?address=${encodeURIComponent(query)}&results=10`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`In-ADS viga: ${res.status}`);
    const data = await res.json();
    const addresses = data.addresses || [];
    return addresses
      .filter((a) => a.liik === "E")
      .map((a) => ({
        address: a.ipikkaadress || a.pikkaadress || a.aadresstekst || "",
        adsOid: a.ads_oid || "",
        adsCode: a.tunnus || "",
      }));
  } catch (err) {
    throw new Error(`Aadressi otsing ebaõnnestus: ${err.message}`);
  }
}

/**
 * Hoone EHR koodi leidmine — In-ADS tunnus → EHR kood
 * Fallback juhul kui searchAddress tulemusel puudub tunnus
 * @param {string} adsOid — ADS objekti ID
 * @returns {Promise<string>} ehrCode
 */
export async function fetchBuildingCode(adsOid) {
  const url = `https://inaadress.maaamet.ee/inaadress/gazetteer?adsobjid=${encodeURIComponent(adsOid)}&results=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`In-ADS päring ebaõnnestus: ${res.status}`);
    const data = await res.json();
    const addresses = data.addresses || [];
    if (!addresses.length) throw new Error("EHR koodi ei leitud");
    return addresses[0].tunnus || "";
  } catch (err) {
    throw new Error(`EHR koodi päring ebaõnnestus: ${err.message}`);
  }
}

/**
 * Korterite andmed — EHR ehitisregistri buildingData
 * @param {string} ehrCode — hoone EHR kood (nt "120726980")
 * @returns {Promise<Array<{ number: string, area: number }>>}
 * Sorteeritud loomuliku sortimise järgi (1, 2, 3, …, 10, 11)
 */
export async function fetchApartments(ehrCode) {
  const url = `https://livekluster.ehr.ee/api/building/v2/buildingData?ehr_code=${encodeURIComponent(ehrCode)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`EHR viga: ${res.status}`);
    const data = await res.json();

    const apartments = [];
    // EHR v2 vastus: ehitis on otse top-level, mitte ehpilesResult sees
    const ehitis = data?.ehitis;
    if (!ehitis) return apartments;

    const kehanded = ehitis.ehitiseKehand?.kehand;
    if (!Array.isArray(kehanded)) return apartments;

    for (const kehand of kehanded) {
      const osad = kehand.ehitiseOsad?.ehitiseOsa;
      if (!Array.isArray(osad)) continue;
      for (const osa of osad) {
        if (osa.liik === "K" && osa.tahis) {
          // pind asub ehitiseOsaPohiandmed sees
          const pind = osa.ehitiseOsaPohiandmed?.pind;
          apartments.push({
            number: osa.tahis,
            area: parseFloat(pind) || 0,
          });
        }
      }
    }

    apartments.sort((a, b) => naturalCompare(a.number, b.number));
    return apartments;
  } catch (err) {
    throw new Error(`Korterite päring ebaõnnestus: ${err.message}`);
  }
}
