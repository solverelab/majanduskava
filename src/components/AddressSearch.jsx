import { useState, useRef, useEffect, useCallback } from "react";
import { searchAddress, fetchBuildingCode, fetchApartments } from "../services/ehrService";

// Paleti väärtused (sama muster nagu TracePanel.jsx)
const N = {
  surface: "#ffffff",
  border: "#e0ddd8",
  text: "#2c2825",
  sub: "#5c554d",
  dim: "#9b9389",
  muted: "#f7f6f4",
};

const fieldLabel = { fontSize: 13, fontWeight: 500, color: N.sub, marginBottom: 4 };
const inputStyle = {
  padding: "8px 10px",
  border: `1px solid ${N.border}`,
  borderRadius: 6,
  fontSize: 15,
  background: N.surface,
  color: N.text,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

/**
 * Aadressi autocomplete komponent koos EHR korterite laadimisega.
 *
 * Props:
 *   value        — praegune aadressi string
 *   onChange(addr) — sünkroniseerib vanema state'i
 *   onApartmentsLoaded([{number, area}]) — callback korterite laadimise järel
 */
export function AddressSearch({ value, onChange, onApartmentsLoaded, onAddressSelected }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  // Väljaspool klõps sulgeb dropdown'i
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleInput = useCallback(
    (e) => {
      const val = e.target.value;
      onChange(val);
      setError("");

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (val.trim().length < 3) {
        setResults([]);
        setOpen(false);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        try {
          const hits = await searchAddress(val.trim());
          setResults(hits);
          setOpen(hits.length > 0);
        } catch {
          setResults([]);
          setOpen(false);
        }
      }, 300);
    },
    [onChange],
  );

  const handleSelect = useCallback(
    async (item) => {
      onChange(item.address);
      if (onAddressSelected) onAddressSelected(item.address);
      setOpen(false);
      setResults([]);
      setLoading(true);
      setError("");

      try {
        let code = item.adsCode;
        if (!code && item.adsOid) {
          code = await fetchBuildingCode(item.adsOid);
        }
        if (!code) {
          setError("EHR koodi ei leitud. Sisesta korterid käsitsi.");
          setLoading(false);
          return;
        }

        const apts = await fetchApartments(code);
        if (apts.length === 0) {
          setError("Korterite andmeid ei leitud. Sisesta käsitsi.");
        } else {
          onApartmentsLoaded(apts);
        }
      } catch {
        setError("Korterite andmeid ei leitud. Sisesta käsitsi.");
      } finally {
        setLoading(false);
      }
    },
    [onChange, onApartmentsLoaded, onAddressSelected],
  );

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div style={fieldLabel}>Hoone aadress</div>
      <input
        type="text"
        placeholder="nt Tamme 5, Tartu"
        value={value}
        onChange={handleInput}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        style={inputStyle}
      />

      {/* Autocomplete valikud */}
      {open && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 100,
            background: N.surface,
            border: `1px solid ${N.border}`,
            borderRadius: 6,
            marginTop: 2,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {results.map((item, i) => (
            <div
              key={item.adsOid || i}
              onClick={() => handleSelect(item)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: 14,
                color: N.text,
                borderBottom: i < results.length - 1 ? `1px solid ${N.muted}` : "none",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = N.muted; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {item.address}
            </div>
          ))}
        </div>
      )}

      {/* Laadimisindikaator */}
      {loading && (
        <div style={{ fontSize: 13, color: N.dim, marginTop: 4 }}>
          Laadin korterite andmeid...
        </div>
      )}

      {/* Veateade */}
      {error && (
        <div style={{ fontSize: 13, color: "#991b1b", marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
