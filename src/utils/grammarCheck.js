// src/utils/grammarCheck.js
// Automaatne tekstipuhastus — deterministlik, lokaalne, ilma väliste sõltuvusteta.

// Automaatne tekstinormaliseerimine ainult konservatiivsete reeglite piires,
// mis ei muuda tähendust. Rakendatakse vabatekstiväljade kanonilise väärtuse
// uuendamisel (hetkel onBlur).
export function autoNormalizeText(text) {
  if (typeof text !== "string") return text;
  let out = text;
  // 1) mitu sama kirjavahemärki järjest (,, .. !! ??) → üks märk
  out = out.replace(/([,.!?])\1+/g, "$1");
  // 2) tühik/tab enne koma/punkti/;/:/!/? → eemalda tühik
  //    (reavahetusi EI eemalda — need ei ole "tühik" selles mõttes)
  out = out.replace(/[ \t]+([,.;:!?])/g, "$1");
  // 3) puuduv tühik pärast koma/punkti/;/:/!/?, kui järgmine märk on täht/number
  out = out.replace(/([,.;:!?])([A-Za-zÀ-ÿ0-9])/g, "$1 $2");
  // 4) topelt tühikud/tabid → üks tühik (ainult mitte-juhtivad, et säilita indent)
  out = out.replace(/(?<=\S)[ \t]{2,}/g, " ");
  // 5) trailing whitespace iga rea lõpus ja teksti lõpus
  out = out.replace(/[ \t]+(\r?\n|$)/g, "$1");
  // 6) välja esimene sisuline täht suureks, kui see on a-zõäöü
  out = out.replace(/^(\s*)([a-zõäöü])/, (_, ws, ch) => ws + ch.toUpperCase());
  return out;
}

// Kutsub apply(norm) AINULT siis, kui normaliseeritud tulemus erineb algsest.
// Kasutuskohas tagab, et välja state'i ei uuendata ilma tegeliku muutuseta.
export function normalizeIfChanged(text, apply) {
  const norm = autoNormalizeText(text);
  if (norm !== text) apply(norm);
  return norm;
}
