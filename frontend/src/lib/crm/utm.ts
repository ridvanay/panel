/** UTM değerleri küçük harf, boşluk yerine tire — raporlarda aynı kampanyanın bölünmesini önler. */
export function normalizeUtm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]/gu, "")
    .slice(0, 100);
}

export function buildUtmUrl(base: string, params: { source: string; medium: string; campaign: string; term: string; content: string }): string | null {
  try {
    const url = new URL(base);
    const entries: [string, string][] = [
      ["utm_source", params.source],
      ["utm_medium", params.medium],
      ["utm_campaign", params.campaign],
      ["utm_term", params.term],
      ["utm_content", params.content],
    ];
    for (const [key, value] of entries) {
      const v = normalizeUtm(value);
      if (v) url.searchParams.set(key, v);
      else url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}
