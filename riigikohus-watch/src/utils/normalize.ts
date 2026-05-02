export const normalizeText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const tokens = (s: string): string[] =>
  normalizeText(s).split(' ').filter(Boolean);
