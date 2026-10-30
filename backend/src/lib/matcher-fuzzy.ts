import { matchScore } from "./matcher-text";

/**
 * Paket W-ek — sınırlı Damerau-Levenshtein (bitişik harf yer değiştirmesi = 1). `max`'ı aşınca erken
 * çıkar ve `max + 1` döner. Yalnızca SUNUCUDA kullanılır (arama `/matcher/topics/search` ucundadır).
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  // Güvenlik incelemesi — yalnızca son üç satır tutulur (her aramada ~30 bin terim; GC baskısı düşük).
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      row.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length]!;
}

/** Bir sözcük, yazım hatası payıyla eşleşiyor mu (tam / önek / 1–2 harf hata). 0 = hayır. */
function wordScore(qWord: string, termWord: string): number {
  if (termWord === qWord) return 3;
  if (qWord.length >= 2 && termWord.startsWith(qWord)) return 2;
  if (qWord.length < 4) return 0;
  const max = qWord.length >= 8 ? 2 : 1;
  const d = Math.min(
    boundedEditDistance(qWord, termWord, max),
    // Yazılmakta olan sözcük: terimin aynı uzunluktaki öneki ile karşılaştır.
    termWord.length > qWord.length ? boundedEditDistance(qWord, termWord.slice(0, qWord.length), max) : max + 1
  );
  return d <= max ? 1 : 0;
}

/**
 * Yazım hatası toleranslı arama puanı (0 = eşleşme yok). Önce `matchScore` (tam > önek > içerir),
 * yoksa sözcük bazında: sorgunun HER sözcüğü terimin bir sözcüğüyle (tam/önek/1–2 harf hata) eşleşmeli.
 * `query` ve `term` katlanmış olmalı.
 */
export function fuzzyMatchScore(foldedQuery: string, foldedTerm: string): number {
  const strict = matchScore(foldedQuery, foldedTerm);
  if (strict) return strict * 10;
  if (!foldedQuery || !foldedTerm || foldedQuery.length < 3) return 0;
  const qWords = foldedQuery.split(" ").filter(Boolean);
  const tWords = foldedTerm.split(" ").filter(Boolean);
  let total = 0;
  for (const qWord of qWords) {
    const best = Math.max(0, ...tWords.map((tWord) => wordScore(qWord, tWord)));
    if (best === 0) return 0;
    total += best;
  }
  // 1..9 arası: hatasız sözcük eşleşmeleri hatalılardan önde.
  return Math.min(9, Math.round((total / qWords.length) * 3));
}
