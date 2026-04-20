// src/utils/grammarCheck.test.js
import { describe, it, expect } from "vitest";
import { applyGrammarSuggestion, grammarStateKey, autoNormalizeText, normalizeIfChanged } from "./grammarCheck";

describe("grammarStateKey", () => {
  it("tagastab stabiilse stringi-võtme scope+id+field alusel", () => {
    expect(grammarStateKey("cost", "r1", "selgitus")).toBe("cost:r1:selgitus");
    expect(grammarStateKey("condition", "s1", "puudused")).toBe("condition:s1:puudused");
  });
});

describe("autoNormalizeText — automaatne konservatiivne parandus", () => {
  it("topelt tühikud → üks tühik", () => {
    expect(autoNormalizeText("foo  bar")).toBe("foo bar");
    expect(autoNormalizeText("a    b    c")).toBe("a b c");
  });

  it("trailing whitespace eemaldus (lõpus ja iga rea lõpus)", () => {
    expect(autoNormalizeText("foo   ")).toBe("foo");
    expect(autoNormalizeText("foo\t\t")).toBe("foo");
    expect(autoNormalizeText("rida 1  \nrida 2  ")).toBe("rida 1\nrida 2");
  });

  it("tühik enne koma/punkti/;/:/!/? eemaldus", () => {
    expect(autoNormalizeText("foo ,")).toBe("foo,");
    expect(autoNormalizeText("foo .")).toBe("foo.");
    expect(autoNormalizeText("foo ;")).toBe("foo;");
    expect(autoNormalizeText("foo :")).toBe("foo:");
    expect(autoNormalizeText("foo !")).toBe("foo!");
    expect(autoNormalizeText("foo ?")).toBe("foo?");
    expect(autoNormalizeText("Hello , world")).toBe("Hello, world");
  });

  it("puuduv tühik pärast koma/punkti/;/:/!/? lisatakse, kui järgmine on täht/number", () => {
    expect(autoNormalizeText("foo,bar")).toBe("foo, bar");
    expect(autoNormalizeText("foo.bar")).toBe("foo. bar");
    expect(autoNormalizeText("foo;bar")).toBe("foo; bar");
    expect(autoNormalizeText("foo:bar")).toBe("foo: bar");
    expect(autoNormalizeText("foo!bar")).toBe("foo! bar");
    expect(autoNormalizeText("foo?bar")).toBe("foo? bar");
    expect(autoNormalizeText("foo,5")).toBe("foo, 5");
    expect(autoNormalizeText("Lorem.Ipsum.Dolor")).toBe("Lorem. Ipsum. Dolor");
    expect(autoNormalizeText("ärä,öäe")).toBe("ärä, öäe"); // eesti tähti toetab
  });

  it(".. / !! / ?? / ,, → üks märk", () => {
    expect(autoNormalizeText("foo..")).toBe("foo.");
    expect(autoNormalizeText("foo...")).toBe("foo.");
    expect(autoNormalizeText("foo!!")).toBe("foo!");
    expect(autoNormalizeText("foo??")).toBe("foo?");
    expect(autoNormalizeText("foo,,")).toBe("foo,");
  });

  it("ei muuda stringe, kus parandust vaja ei ole", () => {
    expect(autoNormalizeText("")).toBe("");
    expect(autoNormalizeText("a")).toBe("a");
    expect(autoNormalizeText("Tere.")).toBe("Tere.");
    expect(autoNormalizeText("Lorem ipsum, dolor sit amet.")).toBe("Lorem ipsum, dolor sit amet.");
    expect(autoNormalizeText("Kas see töötab?")).toBe("Kas see töötab?");
    expect(autoNormalizeText("rida 1\nrida 2")).toBe("rida 1\nrida 2");
  });

  it("ei muuda lause alguse tähte (teadlikult väljas)", () => {
    expect(autoNormalizeText("see on väiketähega algus.")).toBe("see on väiketähega algus.");
  });

  it("ei puuduta mitte-string sisendit", () => {
    expect(autoNormalizeText(undefined)).toBe(undefined);
    expect(autoNormalizeText(null)).toBe(null);
    expect(autoNormalizeText(42)).toBe(42);
  });

  it("kombineeritud reeglid ühel käigul", () => {
    expect(autoNormalizeText("Tere  ,maailm..  Uus  lause !"))
      .toBe("Tere, maailm. Uus lause!");
  });
});

describe("normalizeIfChanged — kutsub apply'i AINULT siis, kui väärtus on tegelikult muutunud", () => {
  it("muutumata tekst → apply ei käivitu, tagastab sama teksti", () => {
    let calls = 0;
    const out = normalizeIfChanged("Tere.", () => { calls++; });
    expect(calls).toBe(0);
    expect(out).toBe("Tere.");
  });

  it("tühi string → apply ei käivitu, tagastab tühja stringi", () => {
    let calls = 0;
    const out = normalizeIfChanged("", () => { calls++; });
    expect(calls).toBe(0);
    expect(out).toBe("");
  });

  it("muudetud tekst → apply käivitub täpselt üks kord normaliseeritud väärtusega", () => {
    let last = null;
    let calls = 0;
    const out = normalizeIfChanged("Tere  .", (v) => { calls++; last = v; });
    expect(calls).toBe(1);
    expect(last).toBe("Tere.");
    expect(out).toBe("Tere.");
  });

  it("mitte-string sisend → apply ei käivitu (reegel rakendub ainult stringidele)", () => {
    let calls = 0;
    expect(normalizeIfChanged(undefined, () => { calls++; })).toBe(undefined);
    expect(normalizeIfChanged(null, () => { calls++; })).toBe(null);
    expect(normalizeIfChanged(42, () => { calls++; })).toBe(42);
    expect(calls).toBe(0);
  });

  it("apply kutsutakse ainult siis, kui päriselt erineb — idempotentne teksti korral", () => {
    let calls = 0;
    normalizeIfChanged("Tere, maailm.", () => { calls++; });
    normalizeIfChanged("Tere, maailm.", () => { calls++; });
    normalizeIfChanged("Tere, maailm.", () => { calls++; });
    expect(calls).toBe(0);
  });
});

describe("applyGrammarSuggestion", () => {
  it("asendab [offset, offset+length) valitud asendusega", () => {
    const out = applyGrammarSuggestion("vanna tuba", { offset: 0, length: 5, message: "", replacements: ["vann"] }, "vann");
    expect(out).toBe("vann tuba");
  });

  it("tagastab algse teksti, kui suggestion on vigane", () => {
    expect(applyGrammarSuggestion("abc", null, "x")).toBe("abc");
    expect(applyGrammarSuggestion("abc", {}, "x")).toBe("abc");
  });

  it("tagastab algse teksti, kui offset on vahemikust väljas", () => {
    expect(applyGrammarSuggestion("abc", { offset: -1, length: 1, replacements: [] }, "x")).toBe("abc");
    expect(applyGrammarSuggestion("abc", { offset: 99, length: 1, replacements: [] }, "x")).toBe("abc");
  });

  it("piirab asenduse lõppu stringi pikkusega (kaitse üle lõpu)", () => {
    const out = applyGrammarSuggestion("abc", { offset: 2, length: 10, replacements: ["ZZ"] }, "ZZ");
    expect(out).toBe("abZZ");
  });

  it("ei kirjuta kanoonilist sisendit — funktsioon on puhas", () => {
    const input = "algne tekst";
    applyGrammarSuggestion(input, { offset: 0, length: 5, replacements: [] }, "uus");
    expect(input).toBe("algne tekst");
  });

  it("tühja asenduse korral tagastab ilma ala eemaldamisega", () => {
    const out = applyGrammarSuggestion("aaa bbb ccc", { offset: 4, length: 3, replacements: [""] }, "");
    expect(out).toBe("aaa  ccc");
  });
});
