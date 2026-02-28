// src/services/ehrService.js
// In-ADS (Maa-amet) + EHR (Ehitisregister) API integration
// Provides address autocomplete and apartment data fetching

/** Natural sort comparison for apartment numbers (1, 2, 3, …, 10, 11) */
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
 * Search for building addresses via In-ADS gazetteer.
 * @param {string} query — user-typed address fragment
 * @returns {Promise<Array<{ address: string, adsOid: string, ehrCode: string }>>}
 */
export async function searchAddress(query) {
  const url = `https://inaadress.maaamet.ee/inaadress/gazetteer?address=${encodeURIComponent(query)}&results=10`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`In-ADS error: ${res.status}`);
  const data = await res.json();
  const addresses = data.addresses || [];
  return addresses
    .filter((a) => a.liik === "E")
    .map((a) => ({
      address: a.iplesnimi || a.pikkaadress || a.aadresstekst || "",
      adsOid: a.adsobjid || a.ads_oid || "",
      ehrCode: a.tunnus || "",
    }));
}

/**
 * Fallback: fetch building EHR code from In-ADS by ADS OID.
 * Used when searchAddress result has no `tunnus` field.
 * @param {string} adsOid
 * @returns {Promise<string>} ehrCode
 */
export async function fetchBuildingCode(adsOid) {
  const url = `https://inaadress.maaamet.ee/inaadress/gazetteer?adsobjid=${encodeURIComponent(adsOid)}&results=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`In-ADS lookup error: ${res.status}`);
  const data = await res.json();
  const addresses = data.addresses || [];
  if (!addresses.length) throw new Error("EHR code not found for ADS OID");
  return addresses[0].tunnus || "";
}

/**
 * Fetch apartment data from EHR building registry.
 * @param {string} ehrCode — building EHR code (e.g. "120726980")
 * @returns {Promise<Array<{ number: string, area: number }>>}
 */
export async function fetchApartments(ehrCode) {
  const url = `https://livekluster.ehr.ee/api/building/v2/buildingData?ehr_code=${encodeURIComponent(ehrCode)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`EHR error: ${res.status}`);
  const data = await res.json();

  const apartments = [];
  const ehitis = data?.ehpilesResult?.ehpilesResponse?.ehitis;
  if (!ehitis) return apartments;

  const kehanded = ehitis.ehitiseKehand?.kehand;
  if (!Array.isArray(kehanded)) return apartments;

  for (const kehand of kehanded) {
    const osad = kehand.ehitiseOsad?.ehitiseOsa;
    if (!Array.isArray(osad)) continue;
    for (const osa of osad) {
      if (osa.liik === "K") {
        apartments.push({
          number: osa.tahis || "",
          area: parseFloat(osa.pind) || 0,
        });
      }
    }
  }

  apartments.sort((a, b) => naturalCompare(a.number, b.number));
  return apartments;
}
