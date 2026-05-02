import { describe, it, expect } from 'vitest';
import {
  detectTopic,
  hasContextAnchor,
  hasTopicMarker,
  isKrtsEra,
  isRelevant,
} from '../src/generateCandidate.js';
import type { RawCase } from '../src/types.js';

const base: Omit<RawCase, 'text' | 'era'> = {
  caseNumber: '2-23-001',
  date: '2026-01-01',
  keyword: 'majanduskava',
};

describe('detectTopic', () => {
  it('tuvastab kinnitamise', () => {
    expect(detectTopic('üldkoosolek kinnitab majanduskava')).toBe('kinnitamine');
  });
  it('tuvastab vaidlustamise enne kinnitamist', () => {
    expect(
      detectTopic('otsuse tühisus — majanduskava kehtetuks tunnistamine'),
    ).toBe('vaidlustamine');
  });
  it('tagastab null kui ühtki teemat ei esine', () => {
    expect(detectTopic('hoone tehnosüsteemide remont')).toBeNull();
  });
});

describe('isKrtsEra', () => {
  it('era-välja usaldab kui see on määratud', () => {
    expect(isKrtsEra({ ...base, text: '', era: 'KrtS' })).toBe(true);
    expect(isKrtsEra({ ...base, text: '', era: 'KOS' })).toBe(false);
  });
  it('KOS tekstipõhiselt välistatakse', () => {
    expect(
      isKrtsEra({
        ...base,
        text: 'lahend põhineb korteriomandiseadusel (KOS)',
      }),
    ).toBe(false);
  });
  it('KrtS viide lubab', () => {
    expect(
      isKrtsEra({ ...base, text: 'KrtS § 41 alusel majanduskava' }),
    ).toBe(true);
  });
});

describe('isRelevant — filterreeglid', () => {
  it('KOS/KÜS ajastu lahend filtreeritakse välja (spec #7)', () => {
    const raw: RawCase = {
      ...base,
      text: 'korteriomandiseaduse alusel majanduskava kinnitamine kirjalik hääletamine',
      era: 'KOS',
    };
    expect(isRelevant(raw)).toBe(false);
  });

  it('mitte-relevantne "majanduskava" kõrvalmaine filtreeritakse välja (spec #8)', () => {
    const raw: RawCase = {
      ...base,
      text: 'vaidlus puudutas hoone katust; majanduskava märgitud ainult kõrvalmärkusena',
    };
    expect(isRelevant(raw)).toBe(false);
  });

  it('relevantne KrtS-ajastu lahend teemaga läbib filtri', () => {
    const raw: RawCase = {
      ...base,
      text: 'KrtS § 41 alusel üldkoosolek kinnitab majanduskava',
      era: 'KrtS',
    };
    expect(isRelevant(raw)).toBe(true);
  });

  it('lahend ilma journey-teemata filtreeritakse välja', () => {
    const raw: RawCase = {
      ...base,
      text: 'vaidlus puudutas üksnes tehnosüsteemide remondiõigust',
      era: 'KrtS',
    };
    expect(isRelevant(raw)).toBe(false);
  });
});

describe('hasTopicMarker / hasContextAnchor', () => {
  it('hasTopicMarker tuvastab "majanduskava"', () => {
    expect(hasTopicMarker('korteriühistu kinnitab majanduskava')).toBe(true);
  });
  it('hasTopicMarker ei tuvasta, kui on ainult üldine teema-sõna (nt koostamine)', () => {
    expect(hasTopicMarker('lepingu koostamine ja täitmine')).toBe(false);
  });
  it('hasContextAnchor tuvastab korteriühistu', () => {
    expect(hasContextAnchor('korteriühistu üldkoosolek otsustas')).toBe(true);
  });
  it('hasContextAnchor tuvastab KrtS', () => {
    expect(hasContextAnchor('KrtS § 41 alusel hageja nõuab')).toBe(true);
  });
  it('hasContextAnchor tuvastab korteriomaniku käänded', () => {
    expect(hasContextAnchor('korteriomanike enamus hääletas')).toBe(true);
    expect(hasContextAnchor('korteriomanikule saadeti kutse')).toBe(true);
  });
  it('hasContextAnchor ei tuvasta KÜ-konteksti puudumisel', () => {
    expect(hasContextAnchor('äriühingu pankrotimenetluses tekkis vaidlus')).toBe(false);
  });
});

describe('isRelevant — kahe-astmeline filter (topic-marker + context-anchor)', () => {
  it('"majanduskava" + "korteriühistu" -> relevant (spec pos #1)', () => {
    const raw: RawCase = {
      ...base,
      text: 'korteriühistu kinnitab majanduskava KrtS alusel',
    };
    expect(isRelevant(raw)).toBe(true);
  });

  it('"kulude jaotus" + "KrtS § 40" -> relevant (spec pos #2)', () => {
    const raw: RawCase = {
      ...base,
      text: 'KrtS § 40 alusel on kulude jaotus vaidluse all',
    };
    expect(isRelevant(raw)).toBe(true);
  });

  it('"kirjalik hääletamine" + "korteriomanike üldkoosolek" -> relevant (spec pos #3)', () => {
    const raw: RawCase = {
      ...base,
      text: 'korteriomanike üldkoosolek — kirjalik hääletamine oli läbi viidud',
    };
    expect(isRelevant(raw)).toBe(true);
  });

  it('ainult "kulude jaotus" pankroti kontekstis -> false (spec neg #4)', () => {
    const raw: RawCase = {
      ...base,
      text: 'AS EVIKO pankrotimenetluses vaieldi kulude jaotus üle',
    };
    expect(isRelevant(raw)).toBe(false);
  });

  it('ainult "koostamine" ilma KÜ/KrtS ankruta -> false (spec neg #5)', () => {
    const raw: RawCase = {
      ...base,
      text: 'osanikud vaidlesid lepingu koostamine ja täitmine üle',
    };
    expect(isRelevant(raw)).toBe(false);
  });

  it('ainult "protokoll" ilma KÜ/KrtS kontekstita -> false (spec neg #6)', () => {
    const raw: RawCase = {
      ...base,
      text: 'ülekuulamise protokoll oli puudulik, kohus tühistas',
    };
    expect(isRelevant(raw)).toBe(false);
  });

  it('KOS/KÜS ajastu lahend isegi teema-markeriga -> false (spec neg #7)', () => {
    const raw: RawCase = {
      ...base,
      text: 'korteriomandiseaduse alusel korteriühistu kinnitas majanduskava',
      era: 'KOS',
    };
    expect(isRelevant(raw)).toBe(false);
  });
});
