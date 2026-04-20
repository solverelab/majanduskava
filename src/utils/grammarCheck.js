// src/utils/grammarCheck.js
// Grammatika-ettepanekute UI-kiht. Canonical tekst JÄÄB ainsaks tõeks.
// See moodul ei muuda plaani state'i — tagastab ainult ettepanekuid
// ning väline kutsuja otsustab, kas ja millist ettepanekut rakendada.
//
// @typedef {Object} GrammarSuggestion
// @property {number} offset              // 0-põhine positsioon stringis
// @property {number} length              // asendatava lõigu pikkus
// @property {string} message             // lühike kirjeldus kasutajale
// @property {string[]} replacements      // võimalikud asendused
//
// @typedef {Object} GrammarCheckState
// @property {'idle'|'checking'|'done'|'error'} status
// @property {string} checkedText         // tekst, mille peal kontroll tehti
// @property {GrammarSuggestion[]} suggestions

// Stabiilne võti grammar-state-i map-is (scope + rea id + välja nimi).
export function grammarStateKey(scope, id, field) {
  return `${scope}:${id}:${field}`;
}

// Automaatne tekstinormaliseerimine ainult konservatiivsete reeglite piires,
// mis ei muuda tähendust. Rakendatakse vabatekstiväljade kanonilise väärtuse
// uuendamisel (hetkel onBlur). Ei tee suurtähe-, trükivigade ega sõnastuse
// parandusi — need käivad endiselt kasutaja kinnitusega suggestion'i kaudu.
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
  // 4) topelt tühikud/tabid → üks tühik
  out = out.replace(/[ \t]{2,}/g, " ");
  // 5) trailing whitespace iga rea lõpus ja teksti lõpus
  out = out.replace(/[ \t]+(\r?\n|$)/g, "$1");
  return out;
}

// Kutsub apply(norm) AINULT siis, kui normaliseeritud tulemus erineb algsest.
// Kasutuskohas tagab, et välja state'i ei uuendata ilma tegeliku muutuseta.
export function normalizeIfChanged(text, apply) {
  const norm = autoNormalizeText(text);
  if (norm !== text) apply(norm);
  return norm;
}

// Rakendab ühe ettepaneku: asendab [offset, offset+length) ala valitud
// asendusega. Tagastab uue stringi; KANOONILIST state'i ei muuda.
// Kutsuja (UI handler) peab seda stringi kirjutama kasutaja kinnitusel
// õigesse plaani välja läbi olemasoleva update-handleri.
export function applyGrammarSuggestion(text, suggestion, replacement) {
  if (typeof text !== "string") return text;
  if (!suggestion || typeof suggestion.offset !== "number" || typeof suggestion.length !== "number") return text;
  if (suggestion.offset < 0 || suggestion.offset > text.length) return text;
  const end = Math.min(text.length, suggestion.offset + Math.max(0, suggestion.length));
  return text.slice(0, suggestion.offset) + String(replacement ?? "") + text.slice(end);
}
