// src/utils/grammarCheck.test.js
import { describe, it, expect } from "vitest";
import { autoNormalizeText, normalizeIfChanged } from "./grammarCheck";

describe("autoNormalizeText — automaatne konservatiivne parandus", () => {
  it("topelt tühikud → üks tühik (mitte-juhtivad)", () => {
    expect(autoNormalizeText("foo  bar")).toBe("Foo bar");
    expect(autoNormalizeText("a    b    c")).toBe("A b c");
  });

  it("trailing whitespace eemaldus (lõpus ja iga rea lõpus)", () => {
    expect(autoNormalizeText("foo   ")).toBe("Foo");
    expect(autoNormalizeText("foo\t\t")).toBe("Foo");
    expect(autoNormalizeText("rida 1  \nrida 2  ")).toBe("Rida 1\nrida 2");
  });

  it("tühik enne koma/punkti/;/:/!/? eemaldus", () => {
    expect(autoNormalizeText("foo ,")).toBe("Foo,");
    expect(autoNormalizeText("foo .")).toBe("Foo.");
    expect(autoNormalizeText("foo ;")).toBe("Foo;");
    expect(autoNormalizeText("foo :")).toBe("Foo:");
    expect(autoNormalizeText("foo !")).toBe("Foo!");
    expect(autoNormalizeText("foo ?")).toBe("Foo?");
    expect(autoNormalizeText("Hello , world")).toBe("Hello, world");
  });

  it("puuduv tühik pärast koma/punkti/;/:/!/? lisatakse, kui järgmine on täht/number", () => {
    expect(autoNormalizeText("foo,bar")).toBe("Foo, bar");
    expect(autoNormalizeText("foo.bar")).toBe("Foo. bar");
    expect(autoNormalizeText("foo;bar")).toBe("Foo; bar");
    expect(autoNormalizeText("foo:bar")).toBe("Foo: bar");
    expect(autoNormalizeText("foo!bar")).toBe("Foo! bar");
    expect(autoNormalizeText("foo?bar")).toBe("Foo? bar");
    expect(autoNormalizeText("foo,5")).toBe("Foo, 5");
    expect(autoNormalizeText("Lorem.Ipsum.Dolor")).toBe("Lorem. Ipsum. Dolor");
    expect(autoNormalizeText("ärä,öäe")).toBe("Ärä, öäe"); // eesti tähti toetab
  });

  it(".. / !! / ?? / ,, → üks märk", () => {
    expect(autoNormalizeText("foo..")).toBe("Foo.");
    expect(autoNormalizeText("foo...")).toBe("Foo.");
    expect(autoNormalizeText("foo!!")).toBe("Foo!");
    expect(autoNormalizeText("foo??")).toBe("Foo?");
    expect(autoNormalizeText("foo,,")).toBe("Foo,");
  });

  it("ei muuda stringe, kus parandust vaja ei ole", () => {
    expect(autoNormalizeText("")).toBe("");
    expect(autoNormalizeText("A")).toBe("A");
    expect(autoNormalizeText("Tere.")).toBe("Tere.");
    expect(autoNormalizeText("Lorem ipsum, dolor sit amet.")).toBe("Lorem ipsum, dolor sit amet.");
    expect(autoNormalizeText("Kas see töötab?")).toBe("Kas see töötab?");
    expect(autoNormalizeText("Rida 1\nrida 2")).toBe("Rida 1\nrida 2");
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

  it("esimene sisuline täht suureks — lihtne väiketäht alguses", () => {
    expect(autoNormalizeText("tere maailm")).toBe("Tere maailm");
  });

  it("esimene sisuline täht suureks — alguses tühikud + väiketäht", () => {
    expect(autoNormalizeText("   tere maailm")).toBe("   Tere maailm");
  });

  it("esimene sisuline täht suureks — juba suur algustäht → muutus puudub", () => {
    expect(autoNormalizeText("Ära tee midagi")).toBe("Ära tee midagi");
  });

  it("esimene sisuline täht suureks — algab numbriga → muutus puudub", () => {
    expect(autoNormalizeText("123 abc")).toBe("123 abc");
  });

  it("esimene sisuline täht suureks — algab kirjavahemärgiga → muutus puudub", () => {
    expect(autoNormalizeText("- tere")).toBe("- tere");
  });

  it("esimene sisuline täht suureks — tühi string → muutus puudub", () => {
    expect(autoNormalizeText("")).toBe("");
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
